import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PhotoCategory, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { WatermarkService } from './watermark.service';
import {
  AdminPhotoQueryDto,
  PublicPhotoQueryDto,
  UpdateWatermarkDto,
  WatermarkLogoDto,
} from './dto/photo.dto';

type UploadFile = {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer?: Buffer;
};

type WatermarkLogo = { order: number; path: string; filename?: string };

const PHOTO_LOG_RETENTION_DAYS = 90;

@Injectable()
export class PhotosService {
  constructor(
    private prisma: PrismaService,
    private watermark: WatermarkService,
  ) {}

  // ---------------------------------------------------------------------------
  // Filesystem helpers
  // ---------------------------------------------------------------------------

  private uploadsRoot() {
    return join(process.cwd(), 'uploads');
  }

  /** Absolute path for an uploads-relative path, guarded against traversal. */
  private absolute(relPath: string) {
    const safe = normalize(relPath).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
    return join(this.uploadsRoot(), safe);
  }

  private writeRelative(relPath: string, buffer: Buffer) {
    const abs = this.absolute(relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, buffer);
  }

  private removeRelative(relPath?: string | null) {
    if (!relPath) return;
    const abs = this.absolute(relPath);
    if (existsSync(abs)) {
      try {
        rmSync(abs, { force: true });
      } catch {
        /* best-effort */
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tournaments (selectors / tabs)
  // ---------------------------------------------------------------------------

  /** Tournaments a photographer may upload to (any non-archived edition). */
  async listUploadableTournaments() {
    return this.prisma.tournament.findMany({
      where: { isArchived: false },
      select: { id: true, name: true, edition: true, startDate: true, endDate: true, status: true },
      orderBy: [{ startDate: 'desc' }, { edition: 'desc' }],
    });
  }

  /** Tournaments that have at least one (non-deleted) public photo. */
  async listTournamentsWithPhotos() {
    const grouped = await this.prisma.photo.groupBy({
      by: ['tournamentId'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    if (grouped.length === 0) return [];
    const counts = new Map(grouped.map((g) => [g.tournamentId, g._count._all]));
    const tournaments = await this.prisma.tournament.findMany({
      where: { id: { in: grouped.map((g) => g.tournamentId) } },
      select: { id: true, name: true, edition: true, startDate: true, endDate: true },
      orderBy: [{ startDate: 'desc' }, { edition: 'desc' }],
    });
    return tournaments.map((t) => ({ ...t, photoCount: counts.get(t.id) ?? 0 }));
  }

  // ---------------------------------------------------------------------------
  // Upload + watermark
  // ---------------------------------------------------------------------------

  private async loadLogoBuffers(tournamentId: string): Promise<Buffer[]> {
    const config = await this.prisma.tournamentWatermark.findUnique({
      where: { tournamentId },
    });
    if (!config) return [];
    const logos = this.parseLogos(config.logos);
    const buffers: Buffer[] = [];
    for (const logo of logos) {
      const abs = this.absolute(logo.path);
      if (existsSync(abs)) {
        buffers.push(readFileSync(abs));
      }
    }
    return buffers;
  }

  async uploadPhotos(
    tournamentId: string,
    category: PhotoCategory,
    files: UploadFile[],
    uploaderId: string,
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');
    if (!files?.length) throw new BadRequestException('请至少上传一张图片');

    const logos = await this.loadLogoBuffers(tournamentId);

    // Bound concurrency so several large images don't blow up memory.
    // p-limit@3 is CommonJS; the dynamic import exposes it on `.default`.
    const { default: pLimit } = await import('p-limit');
    const limit = pLimit(3);

    const failed: Array<{ name: string; reason: string }> = [];
    let uploaded = 0;

    await Promise.all(
      files.map((file) =>
        limit(async () => {
          const name = file.originalname || 'unknown';
          try {
            if (!file.buffer) throw new Error('空文件');
            const uuid = randomUUID();
            const isPng = (file.mimetype || '').includes('png');
            const origExt = isPng ? '.png' : '.jpg';

            const originalPath = `photos/${tournamentId}/original/${uuid}${origExt}`;
            const watermarkPath = `photos/${tournamentId}/watermark/${uuid}.jpg`;
            const thumbPath = `photos/${tournamentId}/thumb/${uuid}.jpg`;

            const { width, height } = await this.watermark.dimensions(file.buffer);
            const watermarked = await this.watermark.applyWatermark(file.buffer, logos);
            const thumb = await this.watermark.generateThumbnail(watermarked);

            this.writeRelative(originalPath, file.buffer);
            this.writeRelative(watermarkPath, watermarked);
            this.writeRelative(thumbPath, thumb);

            await this.prisma.photo.create({
              data: {
                tournamentId,
                uploaderId,
                category,
                originalPath,
                watermarkPath,
                thumbPath,
                fileSize: file.size ?? file.buffer.length,
                width,
                height,
              },
            });
            uploaded += 1;
          } catch (error) {
            failed.push({
              name,
              reason: error instanceof Error ? error.message : '处理失败',
            });
          }
        }),
      ),
    );

    return { uploaded, failed };
  }

  // ---------------------------------------------------------------------------
  // Public gallery
  // ---------------------------------------------------------------------------

  private url(relPath: string) {
    return `/api/uploads/${relPath}`;
  }

  async listPublicPhotos(query: PublicPhotoQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const where: Prisma.PhotoWhereInput = {
      tournamentId: query.tournamentId,
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.photo.count({ where }),
      this.prisma.photo.findMany({
        where,
        orderBy: { uploadedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          category: true,
          watermarkPath: true,
          thumbPath: true,
          width: true,
          height: true,
          uploadedAt: true,
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => ({
        id: r.id,
        category: r.category,
        url: this.url(r.watermarkPath),
        thumbUrl: this.url(r.thumbPath),
        width: r.width,
        height: r.height,
        uploadedAt: r.uploadedAt,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Watermark config (admin)
  // ---------------------------------------------------------------------------

  private parseLogos(value: Prisma.JsonValue | null | undefined): WatermarkLogo[] {
    if (!Array.isArray(value)) return [];
    return (value as unknown as WatermarkLogo[])
      .filter((l) => l && typeof l.path === 'string')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async getWatermark(tournamentId: string) {
    const config = await this.prisma.tournamentWatermark.findUnique({
      where: { tournamentId },
    });
    const logos = this.parseLogos(config?.logos);
    return {
      tournamentId,
      logos: logos.map((l) => ({ ...l, url: this.url(l.path) })),
      updatedAt: config?.updatedAt ?? null,
    };
  }

  async updateWatermark(tournamentId: string, dto: UpdateWatermarkDto) {
    await this.assertTournamentExists(tournamentId);
    const logos = dto.logos
      .slice(0, 5)
      .map((l, i) => ({ order: i + 1, path: l.path, filename: l.filename }));
    const data = { logos: logos as unknown as Prisma.InputJsonValue };
    await this.prisma.tournamentWatermark.upsert({
      where: { tournamentId },
      create: { tournamentId, ...data },
      update: data,
    });
    return this.getWatermark(tournamentId);
  }

  async addWatermarkLogo(tournamentId: string, file: UploadFile) {
    await this.assertTournamentExists(tournamentId);
    if (!file?.buffer) throw new BadRequestException('请上传有效的 PNG 文件');
    if (!(file.mimetype || '').includes('png')) {
      throw new BadRequestException('Logo 必须为 PNG 格式');
    }
    const config = await this.prisma.tournamentWatermark.findUnique({
      where: { tournamentId },
    });
    const logos = this.parseLogos(config?.logos);
    if (logos.length >= 5) throw new BadRequestException('最多只能添加 5 个 Logo');

    const uuid = randomUUID();
    const path = `photos/${tournamentId}/logos/${uuid}.png`;
    this.writeRelative(path, file.buffer);

    const next = [...logos, { order: logos.length + 1, path, filename: file.originalname }].map(
      (l, i) => ({ order: i + 1, path: l.path, filename: l.filename }),
    );
    const data = { logos: next as unknown as Prisma.InputJsonValue };
    await this.prisma.tournamentWatermark.upsert({
      where: { tournamentId },
      create: { tournamentId, ...data },
      update: data,
    });
    return this.getWatermark(tournamentId);
  }

  async deleteWatermarkLogo(tournamentId: string, path: string) {
    const config = await this.prisma.tournamentWatermark.findUnique({
      where: { tournamentId },
    });
    if (!config) throw new NotFoundException('水印配置不存在');
    const logos = this.parseLogos(config.logos);
    const target = logos.find((l) => l.path === path);
    if (!target) throw new NotFoundException('Logo 不存在');

    this.removeRelative(target.path);
    const next = logos
      .filter((l) => l.path !== path)
      .map((l, i) => ({ order: i + 1, path: l.path, filename: l.filename }));
    await this.prisma.tournamentWatermark.update({
      where: { tournamentId },
      data: { logos: next as unknown as Prisma.InputJsonValue },
    });
    return this.getWatermark(tournamentId);
  }

  // ---------------------------------------------------------------------------
  // Admin photo management
  // ---------------------------------------------------------------------------

  async adminListPhotos(query: AdminPhotoQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const where: Prisma.PhotoWhereInput = {
      tournamentId: query.tournamentId,
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
      ...(query.uploaderId ? { uploaderId: query.uploaderId } : {}),
      ...(query.from || query.to
        ? {
            uploadedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.photo.count({ where }),
      this.prisma.photo.findMany({
        where,
        orderBy: { uploadedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          category: true,
          watermarkPath: true,
          thumbPath: true,
          fileSize: true,
          width: true,
          height: true,
          uploadedAt: true,
          uploader: { select: { id: true, username: true } },
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => ({
        id: r.id,
        category: r.category,
        url: this.url(r.watermarkPath),
        thumbUrl: this.url(r.thumbPath),
        originalUrl: `/api/admin/photos/${r.id}/original`,
        fileSize: r.fileSize,
        width: r.width,
        height: r.height,
        uploadedAt: r.uploadedAt,
        uploader: r.uploader ? { id: r.uploader.id, username: r.uploader.username } : null,
      })),
    };
  }

  /** Returns the on-disk absolute path of the original; records a view log. */
  async getOriginal(
    photoId: string,
    operator: { id: string; username?: string | null },
  ) {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
    if (!photo || photo.deletedAt) throw new NotFoundException('图片不存在');
    const abs = this.absolute(photo.originalPath);
    if (!existsSync(abs)) throw new NotFoundException('原图文件丢失');

    await this.log(photo.tournamentId, operator, 'VIEW_ORIGINAL', photo.id, {
      originalPath: photo.originalPath,
    });

    const filename = photo.originalPath.split('/').pop() || `${photo.id}.jpg`;
    return { absolutePath: abs, filename };
  }

  async deletePhoto(
    photoId: string,
    operator: { id: string; username?: string | null },
  ) {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
    if (!photo || photo.deletedAt) throw new NotFoundException('图片不存在');
    this.hardRemoveFiles(photo);
    await this.prisma.photo.update({
      where: { id: photoId },
      data: { deletedAt: new Date() },
    });
    await this.log(photo.tournamentId, operator, 'DELETE_PHOTO', photo.id, {
      category: photo.category,
    });
    return { success: true };
  }

  async deletePhotos(
    ids: string[],
    operator: { id: string; username?: string | null },
  ) {
    const photos = await this.prisma.photo.findMany({
      where: { id: { in: ids }, deletedAt: null },
    });
    for (const photo of photos) this.hardRemoveFiles(photo);
    if (photos.length) {
      await this.prisma.photo.updateMany({
        where: { id: { in: photos.map((p) => p.id) } },
        data: { deletedAt: new Date() },
      });
      const byTournament = new Map<string, number>();
      photos.forEach((p) =>
        byTournament.set(p.tournamentId, (byTournament.get(p.tournamentId) ?? 0) + 1),
      );
      for (const [tournamentId, count] of byTournament) {
        await this.log(tournamentId, operator, 'BATCH_DELETE', null, { count });
      }
    }
    return { deleted: photos.length };
  }

  async deleteTournamentPhotos(
    tournamentId: string,
    confirmName: string,
    operator: { id: string; username?: string | null },
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { name: true },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');
    if ((confirmName ?? '').trim() !== tournament.name) {
      throw new BadRequestException('赛事名称不匹配,删除已取消');
    }

    const photos = await this.prisma.photo.findMany({
      where: { tournamentId, deletedAt: null },
    });
    for (const photo of photos) this.hardRemoveFiles(photo);
    if (photos.length) {
      await this.prisma.photo.updateMany({
        where: { id: { in: photos.map((p) => p.id) } },
        data: { deletedAt: new Date() },
      });
    }
    await this.log(tournamentId, operator, 'DELETE_TOURNAMENT_PHOTOS', null, {
      count: photos.length,
    });
    return { deleted: photos.length };
  }

  async listLogs(tournamentId: string) {
    const since = new Date(Date.now() - PHOTO_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const logs = await this.prisma.photoOperationLog.findMany({
      where: { tournamentId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return logs.map((l) => ({
      id: l.id,
      photoId: l.photoId,
      action: l.action,
      operator: l.operatorNameSnapshot,
      detail: l.detail,
      createdAt: l.createdAt,
    }));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private hardRemoveFiles(photo: {
    originalPath: string;
    watermarkPath: string;
    thumbPath: string;
  }) {
    this.removeRelative(photo.originalPath);
    this.removeRelative(photo.watermarkPath);
    this.removeRelative(photo.thumbPath);
  }

  private async assertTournamentExists(tournamentId: string) {
    const exists = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('赛事不存在');
  }

  private async log(
    tournamentId: string,
    operator: { id: string; username?: string | null },
    action: string,
    photoId: string | null,
    detail?: Prisma.InputJsonValue,
  ) {
    try {
      await this.prisma.photoOperationLog.create({
        data: {
          tournamentId,
          photoId: photoId ?? undefined,
          operatorId: operator.id,
          operatorNameSnapshot: operator.username ?? null,
          action,
          detail: detail ?? undefined,
        },
      });
    } catch {
      /* logging must never break the operation */
    }
  }
}
