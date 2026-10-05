import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { type PhotoActivity, Role, TournamentApprovalStatus } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { AuthActor } from '../auth/admin-scope';
import { ImageModerationService } from '../image-moderation/image-moderation.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePhotoActivityDto } from './dto/photo-activity.dto';

type CoverFile = { buffer?: Buffer; mimetype?: string; size?: number };
type ActivityRow = PhotoActivity & {
  submittedBy?: { id: string; username: string | null } | null;
  approvedBy?: { id: string; username: string | null } | null;
  _count?: { photos: number };
};

@Injectable()
export class PhotoActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ImageModerationService,
  ) {}

  async list(actor: AuthActor) {
    const rows = await this.prisma.photoActivity.findMany({
      where: actor.role === Role.ROOT ? {} : { submittedById: actor.id },
      include: {
        submittedBy: { select: { id: true, username: true } },
        approvedBy: { select: { id: true, username: true } },
        _count: { select: { photos: { where: { deletedAt: null } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.serialize(row));
  }

  async get(id: string, actor: AuthActor) {
    const row = await this.requireManageable(id, actor);
    const photoCount = await this.prisma.photo.count({ where: { activityId: id, deletedAt: null } });
    return this.serialize({ ...row, _count: { photos: photoCount } });
  }

  async create(dto: CreatePhotoActivityDto, cover: CoverFile | undefined, actor: AuthActor) {
    if (!cover?.buffer) throw new BadRequestException('请设置活动封面');
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('请输入活动名称');
    const { startAt, endAt } = this.parseDates(dto);
    const coverImageUrl = await this.saveCover(cover);
    try {
      const approved = actor.role === Role.ROOT;
      const row = await this.prisma.photoActivity.create({
        data: {
          title,
          coverImageUrl,
          dateMode: dto.dateMode,
          startAt,
          endAt,
          submittedById: actor.id,
          approvalStatus: approved ? TournamentApprovalStatus.APPROVED : TournamentApprovalStatus.PENDING,
          approvedById: approved ? actor.id : null,
          approvedAt: approved ? new Date() : null,
        },
        include: { submittedBy: { select: { id: true, username: true } }, approvedBy: { select: { id: true, username: true } } },
      });
      return this.serialize(row);
    } catch (error) {
      this.removeCover(coverImageUrl);
      throw error;
    }
  }

  async update(id: string, dto: CreatePhotoActivityDto, cover: CoverFile | undefined, actor: AuthActor) {
    const current = await this.requireManageable(id, actor);
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('请输入活动名称');
    const { startAt, endAt } = this.parseDates(dto);
    const nextCover = cover?.buffer ? await this.saveCover(cover) : current.coverImageUrl;
    const needsReview = actor.role !== Role.ROOT;
    try {
      const row = await this.prisma.photoActivity.update({
        where: { id },
        data: {
          title,
          coverImageUrl: nextCover,
          dateMode: dto.dateMode,
          startAt,
          endAt,
          ...(needsReview ? {
            approvalStatus: TournamentApprovalStatus.PENDING,
            approvedById: null,
            approvedAt: null,
            rejectReason: null,
          } : {}),
        },
        include: { submittedBy: { select: { id: true, username: true } }, approvedBy: { select: { id: true, username: true } } },
      });
      if (cover?.buffer && current.coverImageUrl !== nextCover) this.removeCover(current.coverImageUrl);
      return this.serialize(row);
    } catch (error) {
      if (cover?.buffer && nextCover !== current.coverImageUrl) this.removeCover(nextCover);
      throw error;
    }
  }

  async approve(id: string, actor: AuthActor) {
    this.assertRoot(actor);
    await this.requireExists(id);
    return this.prisma.photoActivity.update({
      where: { id },
      data: { approvalStatus: TournamentApprovalStatus.APPROVED, approvedById: actor.id, approvedAt: new Date(), rejectReason: null },
    });
  }

  async reject(id: string, reason: string, actor: AuthActor) {
    this.assertRoot(actor);
    await this.requireExists(id);
    const value = reason.trim();
    if (!value) throw new BadRequestException('请填写驳回原因');
    return this.prisma.photoActivity.update({
      where: { id },
      data: { approvalStatus: TournamentApprovalStatus.REJECTED, approvedById: actor.id, approvedAt: new Date(), rejectReason: value },
    });
  }

  async createPhotoAccess(id: string, actor: AuthActor) {
    const activity = await this.requireManageable(id, actor);
    if (activity.approvalStatus !== TournamentApprovalStatus.APPROVED) {
      throw new BadRequestException('活动审核通过后才能生成图片二维码');
    }
    const photoAccessToken = activity.photoAccessToken ?? randomBytes(24).toString('base64url');
    if (!activity.photoAccessToken) {
      await this.prisma.photoActivity.update({ where: { id }, data: { photoAccessToken } });
    }
    return { accessToken: photoAccessToken, path: `/photos/${photoAccessToken}` };
  }

  async requireManageable(id: string, actor: AuthActor) {
    const row = await this.requireExists(id);
    if (actor.role !== Role.ROOT && row.submittedById !== actor.id) {
      throw new NotFoundException('活动不存在或不属于你');
    }
    return row;
  }

  private requireExists(id: string) {
    return this.prisma.photoActivity.findUnique({ where: { id } }).then((row) => {
      if (!row) throw new NotFoundException('活动不存在');
      return row;
    });
  }

  private assertRoot(actor: AuthActor) {
    if (actor.role !== Role.ROOT) throw new ForbiddenException('仅超级管理员可以审核活动');
  }

  private parseDates(dto: CreatePhotoActivityDto) {
    const startAt = new Date(dto.startAt);
    const endAt = dto.dateMode === 'RANGE' && dto.endAt ? new Date(dto.endAt) : null;
    if (Number.isNaN(startAt.getTime()) || (endAt && Number.isNaN(endAt.getTime()))) {
      throw new BadRequestException('活动日期格式不正确');
    }
    startAt.setMilliseconds(0);
    endAt?.setMilliseconds(0);
    if (endAt && endAt < startAt) throw new BadRequestException('结束时间不能早于开始时间');
    return { startAt, endAt };
  }

  private async saveCover(file: CoverFile) {
    if (!file.buffer || !/^image\/(?!svg\+xml$)/.test(file.mimetype ?? '')) {
      throw new BadRequestException('封面必须是有效图片');
    }
    if ((file.size ?? file.buffer.length) > 15 * 1024 * 1024) {
      throw new BadRequestException('封面不能超过 15MB');
    }
    await this.moderation.assertAllowed(file.buffer);
    let output: Buffer;
    try {
      output = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 80_000_000 })
        .rotate().webp({ quality: 88 }).toBuffer();
    } catch {
      throw new BadRequestException('封面图片无法解析');
    }
    const filename = `activity-${randomUUID()}.webp`;
    const dir = join(process.cwd(), 'uploads', 'covers');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), output);
    return `/api/uploads/covers/${filename}`;
  }

  private removeCover(url?: string | null) {
    const filename = url?.match(/^\/api\/uploads\/covers\/([^/]+)$/)?.[1];
    if (!filename) return;
    const path = join(process.cwd(), 'uploads', 'covers', filename);
    if (existsSync(path)) rmSync(path, { force: true });
  }

  private serialize(row: ActivityRow) {
    const { _count, ...activity } = row;
    return { ...activity, photoCount: _count?.photos ?? 0, photoAccessEnabled: !!row.photoAccessToken };
  }
}
