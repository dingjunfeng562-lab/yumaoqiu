import { AuthActor, tournamentScope } from '../auth/admin-scope';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PhotoCategory, Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { ImageModerationService } from '../image-moderation/image-moderation.service';
import { signedPhotoPreviewUrl } from './photo-file-access';
import { WatermarkService, WATERMARK_POSITIONS, WatermarkPosition, TEXT_FONT_OPTIONS, TextFontType } from './watermark.service';

const DEFAULT_LOGO_HEIGHT_PERCENT = WatermarkService.DEFAULT_LOGO_HEIGHT_PERCENT;
const MIN_LOGO_HEIGHT_PERCENT = WatermarkService.MIN_LOGO_HEIGHT_PERCENT;
const MAX_LOGO_HEIGHT_PERCENT = WatermarkService.MAX_LOGO_HEIGHT_PERCENT;
const DEFAULT_LOGO_GAP_PERCENT = WatermarkService.DEFAULT_LOGO_GAP_PERCENT;
const MIN_LOGO_GAP_PERCENT = WatermarkService.MIN_LOGO_GAP_PERCENT;
const MAX_LOGO_GAP_PERCENT = WatermarkService.MAX_LOGO_GAP_PERCENT;
const DEFAULT_WATERMARK_POSITION = WatermarkService.DEFAULT_POSITION;
const DEFAULT_TEXT_COLOR = WatermarkService.DEFAULT_TEXT_COLOR;
const DEFAULT_TEXT_SIZE_PERCENT = WatermarkService.DEFAULT_TEXT_SIZE_PERCENT;
const DEFAULT_TEXT_FONT = WatermarkService.DEFAULT_TEXT_FONT;
const MIN_TEXT_SIZE_PERCENT = WatermarkService.MIN_TEXT_SIZE_PERCENT;
const MAX_TEXT_SIZE_PERCENT = WatermarkService.MAX_TEXT_SIZE_PERCENT;
const MAX_TEXT_LENGTH = WatermarkService.MAX_TEXT_LENGTH;
import {
  AdminPhotoQueryDto,
  PublicPhotoQueryDto,
  PublicPhotoSort,
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
type ProcessedUpload = {
  idx: number;
  name: string;
  originalPath: string;
  fullPath: string;
  thumbnailPath: string;
  fileSize: number;
  width: number;
  height: number;
};

const MAX_UPLOAD_FILES = 100;
const MAX_UPLOAD_FILE_SIZE = 15 * 1024 * 1024;
const PHOTO_MIME_RE = /^image\/(?!svg\+xml$).+/;
const PHOTO_LOG_RETENTION_DAYS = 90;

/** Chinese labels used in download filenames: 赛事名-分类-序号.ext */
const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
  PLAYER: '选手照',
  MATCH: '现场照',
  AWARD: '颁奖照',
};

@Injectable()
export class PhotosService {
  constructor(
    private prisma: PrismaService,
    private watermark: WatermarkService,
    private moderation: ImageModerationService,
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

  private removeProcessedUploadFiles(upload: {
    originalPath: string;
    fullPath: string;
    thumbnailPath: string;
  }) {
    this.removeRelative(upload.originalPath);
    this.removeRelative(upload.fullPath);
    this.removeRelative(upload.thumbnailPath);
  }

  private originalImageExtension(format?: string) {
    switch (format) {
      case 'jpeg':
        return '.jpg';
      case 'png':
        return '.png';
      case 'webp':
        return '.webp';
      case 'gif':
        return '.gif';
      case 'avif':
        return '.avif';
      case 'heif':
        return '.heic';
      case 'tiff':
        return '.tif';
      default:
        return '.jpg';
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
  async listTournamentsWithPhotos(actor?: AuthActor) {
    const grouped = await this.prisma.photo.groupBy({
      by: ['tournamentId'],
      where: { deletedAt: null, tournament: tournamentScope(actor) },
      _count: { _all: true },
      _sum: { viewCount: true, downloadCount: true },
    });
    if (grouped.length === 0) return [];
    const counts = new Map(
      grouped.map((g) => [
        g.tournamentId,
        {
          count: g._count._all,
          viewCount: g._sum.viewCount ?? 0,
          downloadCount: g._sum.downloadCount ?? 0,
        },
      ]),
    );
    const tournamentIds = grouped.map((group) => group.tournamentId).filter((id): id is string => !!id);
    const tournaments = await this.prisma.tournament.findMany({
      where: { id: { in: tournamentIds } },
      select: { id: true, name: true, edition: true, startDate: true, endDate: true },
      orderBy: [{ startDate: 'desc' }, { edition: 'desc' }],
    });
    return tournaments.map((t) => ({
      ...t,
      photoCount: counts.get(t.id)?.count ?? 0,
      viewCount: counts.get(t.id)?.viewCount ?? 0,
      downloadCount: counts.get(t.id)?.downloadCount ?? 0,
    }));
  }

  // ---------------------------------------------------------------------------
  // Upload + watermark
  // ---------------------------------------------------------------------------

  private async loadLogoConfig(tournamentId: string): Promise<{
    buffers: Buffer[];
    logoHeightPercent: number;
    logoGapPercent: number;
    position: WatermarkPosition;
    portraitPosition: WatermarkPosition;
    text: string | null;
    textColor: string;
    textSizePercent: number;
    textFont: TextFontType;
    textPosition: WatermarkPosition;
    textPortraitPosition: WatermarkPosition;
  }> {
    const config = await this.prisma.tournamentWatermark.findUnique({
      where: { tournamentId },
    });
    if (!config) {
      return {
        buffers: [],
        logoHeightPercent: DEFAULT_LOGO_HEIGHT_PERCENT,
        logoGapPercent: DEFAULT_LOGO_GAP_PERCENT,
        position: DEFAULT_WATERMARK_POSITION,
        portraitPosition: DEFAULT_WATERMARK_POSITION,
        text: null,
        textColor: DEFAULT_TEXT_COLOR,
        textSizePercent: DEFAULT_TEXT_SIZE_PERCENT,
        textFont: DEFAULT_TEXT_FONT,
        textPosition: DEFAULT_WATERMARK_POSITION,
        textPortraitPosition: DEFAULT_WATERMARK_POSITION,
      };
    }
    const logos = this.parseLogos(config.logos);
    const buffers: Buffer[] = [];
    for (const logo of logos) {
      const abs = this.absolute(logo.path);
      if (existsSync(abs)) {
        buffers.push(readFileSync(abs));
      }
    }
    return {
      buffers,
      logoHeightPercent: config.logoHeightPercent ?? DEFAULT_LOGO_HEIGHT_PERCENT,
      logoGapPercent: config.logoGapPercent ?? DEFAULT_LOGO_GAP_PERCENT,
      position: this.normalizePosition(config.position),
      portraitPosition: this.normalizePosition(config.portraitPosition ?? config.position),
      text: config.text?.trim() ? config.text.trim() : null,
      textColor: config.textColor ?? DEFAULT_TEXT_COLOR,
      textSizePercent: config.textSizePercent ?? DEFAULT_TEXT_SIZE_PERCENT,
      textFont: (config.textFont as TextFontType) ?? DEFAULT_TEXT_FONT,
      textPosition: this.normalizePosition(config.textPosition ?? config.position),
      textPortraitPosition: this.normalizePosition(
        config.textPortraitPosition ??
          config.textPosition ??
          config.portraitPosition ??
          config.position,
      ),
    };
  }

  async createTournamentUploadAccess(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { photoUploadToken: true, approvalStatus: true },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');
    if (tournament.approvalStatus !== 'APPROVED') throw new BadRequestException('赛事审核通过后才能生成上传授权二维码');
    const token = tournament.photoUploadToken ?? randomBytes(24).toString('base64url');
    if (!tournament.photoUploadToken) {
      await this.prisma.tournament.update({ where: { id: tournamentId }, data: { photoUploadToken: token } });
    }
    return { token, path: `/photographer/authorize/${token}` };
  }

  async createActivityUploadAccess(activityId: string) {
    const activity = await this.prisma.photoActivity.findUnique({
      where: { id: activityId },
      select: { photoUploadToken: true, approvalStatus: true },
    });
    if (!activity) throw new NotFoundException('活动不存在');
    if (activity.approvalStatus !== 'APPROVED') throw new BadRequestException('活动审核通过后才能生成上传授权二维码');
    const token = activity.photoUploadToken ?? randomBytes(24).toString('base64url');
    if (!activity.photoUploadToken) {
      await this.prisma.photoActivity.update({ where: { id: activityId }, data: { photoUploadToken: token } });
    }
    return { token, path: `/photographer/authorize/${token}` };
  }

  async getPhotoUploadAccess(token: string) {
    const validToken = this.validUploadToken(token);
    const tournament = await this.prisma.tournament.findUnique({
      where: { photoUploadToken: validToken },
      select: { id: true, name: true, startDate: true, endDate: true },
    });
    if (tournament) return { targetType: 'TOURNAMENT' as const, id: tournament.id, name: tournament.name, startAt: tournament.startDate, endAt: tournament.endDate };
    const activity = await this.prisma.photoActivity.findFirst({
      where: { photoUploadToken: validToken, approvalStatus: 'APPROVED' },
      select: { id: true, title: true, startAt: true, endAt: true },
    });
    if (activity) return { targetType: 'ACTIVITY' as const, id: activity.id, name: activity.title, startAt: activity.startAt, endAt: activity.endAt };
    throw new NotFoundException('上传授权二维码无效');
  }

  async authorizePhotoUpload(token: string, userId: string) {
    const target = await this.getPhotoUploadAccess(token);
    if (target.targetType === 'TOURNAMENT') {
      await this.prisma.photoUploadGrant.upsert({
        where: { userId_tournamentId: { userId, tournamentId: target.id } },
        create: { userId, tournamentId: target.id },
        update: { grantedAt: new Date() },
      });
    } else {
      await this.prisma.photoUploadGrant.upsert({
        where: { userId_activityId: { userId, activityId: target.id } },
        create: { userId, activityId: target.id },
        update: { grantedAt: new Date() },
      });
    }
    return target;
  }

  async listAuthorizedUploadTargets(userId: string) {
    const grants = await this.prisma.photoUploadGrant.findMany({
      where: { userId },
      include: {
        tournament: { select: { id: true, name: true, startDate: true, endDate: true, isArchived: true, approvalStatus: true } },
        activity: { select: { id: true, title: true, startAt: true, endAt: true, approvalStatus: true } },
      },
      orderBy: { grantedAt: 'desc' },
    });
    const targets: Array<{
      targetType: 'TOURNAMENT' | 'ACTIVITY';
      id: string;
      name: string;
      startAt: Date;
      endAt: Date | null;
    }> = [];
    grants.forEach((grant) => {
      if (grant.tournament && !grant.tournament.isArchived && grant.tournament.approvalStatus === 'APPROVED') {
        targets.push({ targetType: 'TOURNAMENT', id: grant.tournament.id, name: grant.tournament.name, startAt: grant.tournament.startDate, endAt: grant.tournament.endDate });
      } else if (grant.activity?.approvalStatus === 'APPROVED') {
        targets.push({ targetType: 'ACTIVITY', id: grant.activity.id, name: grant.activity.title, startAt: grant.activity.startAt, endAt: grant.activity.endAt });
      }
    });
    return targets;
  }

  async assertPhotoUploadAuthorized(userId: string, targetType: 'TOURNAMENT' | 'ACTIVITY', targetId: string) {
    const grant = await this.prisma.photoUploadGrant.findFirst({
      where: targetType === 'TOURNAMENT'
        ? { userId, tournamentId: targetId, tournament: { isArchived: false, approvalStatus: 'APPROVED' } }
        : { userId, activityId: targetId, activity: { approvalStatus: 'APPROVED' } },
      select: { id: true },
    });
    if (!grant) throw new ForbiddenException('请先扫描上传授权二维码');
  }

  private validUploadToken(token: string) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new NotFoundException('上传授权二维码无效');
    return token;
  }

  private async loadActivityLogoConfig(activityId: string): Promise<Awaited<ReturnType<PhotosService['loadLogoConfig']>>> {
    const config = await this.prisma.photoActivityWatermark.findUnique({ where: { activityId } });
    if (!config) {
      return {
        buffers: [], logoHeightPercent: DEFAULT_LOGO_HEIGHT_PERCENT, logoGapPercent: DEFAULT_LOGO_GAP_PERCENT,
        position: DEFAULT_WATERMARK_POSITION, portraitPosition: DEFAULT_WATERMARK_POSITION,
        text: null, textColor: DEFAULT_TEXT_COLOR, textSizePercent: DEFAULT_TEXT_SIZE_PERCENT,
        textFont: DEFAULT_TEXT_FONT, textPosition: DEFAULT_WATERMARK_POSITION,
        textPortraitPosition: DEFAULT_WATERMARK_POSITION,
      };
    }
    const buffers: Buffer[] = [];
    for (const logo of this.parseLogos(config.logos)) {
      const abs = this.absolute(logo.path);
      if (existsSync(abs)) buffers.push(readFileSync(abs));
    }
    return {
      buffers,
      logoHeightPercent: this.clampLogoHeightPercent(config.logoHeightPercent),
      logoGapPercent: this.clampLogoGapPercent(config.logoGapPercent),
      position: this.normalizePosition(config.position),
      portraitPosition: this.normalizePosition(config.portraitPosition ?? config.position),
      text: this.sanitizeText(config.text),
      textColor: this.sanitizeTextColor(config.textColor),
      textSizePercent: this.clampTextSizePercent(config.textSizePercent),
      textFont: this.sanitizeTextFont(config.textFont),
      textPosition: this.normalizePosition(config.textPosition ?? config.position),
      textPortraitPosition: this.normalizePosition(config.textPortraitPosition ?? config.portraitPosition ?? config.textPosition ?? config.position),
    };
  }

  private normalizePosition(value?: string | null): WatermarkPosition {
    return WATERMARK_POSITIONS.includes(value as WatermarkPosition)
      ? (value as WatermarkPosition)
      : DEFAULT_WATERMARK_POSITION;
  }

  private isMissingTableError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2010' &&
      String(error.meta?.code ?? '') === '1146'
    );
  }

  private async lockTournamentForPhotoSequence(
    tx: Prisma.TransactionClient,
    tournamentId: string,
  ) {
    try {
      // Prisma maps the model to `Tournament`; older migration-created DBs may still expose `tournament`.
      return await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM \`Tournament\` WHERE id = ${tournamentId} FOR UPDATE
      `;
    } catch (error) {
      if (!this.isMissingTableError(error)) throw error;
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM \`tournament\` WHERE id = ${tournamentId} FOR UPDATE
      `;
    }
  }

  private lockActivityForPhotoSequence(tx: Prisma.TransactionClient, activityId: string) {
    return tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM \`PhotoActivity\` WHERE id = ${activityId} FOR UPDATE
    `;
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
    if (files.length > MAX_UPLOAD_FILES) {
      throw new BadRequestException(`每批最多上传 ${MAX_UPLOAD_FILES} 张图片`);
    }

    const {
      buffers: logos,
      logoHeightPercent,
      logoGapPercent,
      position,
      portraitPosition,
      text,
      textColor,
      textSizePercent,
      textFont,
      textPosition,
      textPortraitPosition,
    } = await this.loadLogoConfig(tournamentId);

    // Bound concurrency so several large images don't blow up memory.
    // p-limit@3 is CommonJS; the dynamic import exposes it on `.default`.
    const { default: pLimit } = await import('p-limit');
    const limit = pLimit(3);

    const failed: Array<{ name: string; reason: string }> = [];
    const processed: ProcessedUpload[] = [];

    await Promise.all(
      files.map((file, idx) =>
        limit(async () => {
          const name = file.originalname || 'unknown';
          const writtenPaths: string[] = [];
          try {
            if (!file.buffer) throw new Error('空文件');
            if (!PHOTO_MIME_RE.test(file.mimetype ?? '')) {
              throw new Error('仅支持图片格式');
            }
            if ((file.size ?? file.buffer.length) > MAX_UPLOAD_FILE_SIZE) {
              throw new Error('单张图片不能超过 15MB');
            }
            await this.moderation.assertAllowed(file.buffer);
            const uuid = randomUUID();
            const info = await this.watermark.imageInfo(file.buffer);
            const origExt = this.originalImageExtension(info.format);
            const resolvedPosition = info.height > info.width ? portraitPosition : position;
            const resolvedTextPosition =
              info.height > info.width ? textPortraitPosition : textPosition;

            const originalPath = `photos/${tournamentId}/original/${uuid}${origExt}`;
            const thumbnailPath = `photos/${tournamentId}/thumb/${uuid}.jpg`;

            const watermarked = await this.watermark.applyWatermark(
              file.buffer,
              logos,
              logoHeightPercent,
              logoGapPercent,
              resolvedPosition,
              {
                content: text,
                color: textColor,
                heightPercent: textSizePercent,
                position: resolvedTextPosition,
                font: textFont,
              },
            );
            const fullPath = `photos/${tournamentId}/full/${uuid}${watermarked.ext}`;
            const thumb = await this.watermark.generateThumbnail(watermarked.buffer);

            this.writeRelative(originalPath, file.buffer);
            writtenPaths.push(originalPath);
            this.writeRelative(fullPath, watermarked.buffer);
            writtenPaths.push(fullPath);
            this.writeRelative(thumbnailPath, thumb);
            writtenPaths.push(thumbnailPath);

            processed.push({
              idx,
              name,
              originalPath,
              fullPath,
              thumbnailPath,
              fileSize: file.size ?? file.buffer.length,
              width: info.width,
              height: info.height,
            });
          } catch (error) {
            writtenPaths.forEach((path) => this.removeRelative(path));
            failed.push({
              name,
              reason: error instanceof Error ? error.message : '处理失败',
            });
          }
        }),
      ),
    );

    const readyToCreate = processed.sort((a, b) => a.idx - b.idx);
    let uploaded = 0;

    if (readyToCreate.length > 0) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Serialize sequence assignment per tournament; image processing stays outside the lock.
          const locked = await this.lockTournamentForPhotoSequence(tx, tournamentId);
          if (locked.length === 0) throw new NotFoundException('Tournament not found');

          // New photos continue from the current max (deleted rows included)
          // so download names stay unique and stable.
          const seqAgg = await tx.photo.aggregate({
            where: { tournamentId },
            _max: { seq: true },
          });
          const seqBase = seqAgg._max.seq ?? 0;

          for (const [order, item] of readyToCreate.entries()) {
            await tx.photo.create({
              data: {
                tournamentId,
                uploaderId,
                category,
                seq: seqBase + order + 1,
                originalPath: item.originalPath,
                fullPath: item.fullPath,
                thumbnailPath: item.thumbnailPath,
                fileSize: item.fileSize,
                width: item.width,
                height: item.height,
              },
            });
          }
        });
        uploaded = readyToCreate.length;
      } catch (error) {
        readyToCreate.forEach((item) => this.removeProcessedUploadFiles(item));
        const reason = error instanceof Error ? error.message : 'Processing failed';
        failed.push(...readyToCreate.map((item) => ({ name: item.name, reason })));
      }
    }

    return { uploaded, failed };
  }

  async uploadActivityPhotos(activityId: string, category: PhotoCategory, files: UploadFile[], uploaderId: string) {
    const activity = await this.prisma.photoActivity.findUnique({ where: { id: activityId }, select: { id: true } });
    if (!activity) throw new NotFoundException('活动不存在');
    if (!files?.length) throw new BadRequestException('请至少上传一张图片');
    if (files.length > MAX_UPLOAD_FILES) throw new BadRequestException(`每批最多上传 ${MAX_UPLOAD_FILES} 张图片`);

    const config = await this.loadActivityLogoConfig(activityId);
    const { default: pLimit } = await import('p-limit');
    const limit = pLimit(3);
    const failed: Array<{ name: string; reason: string }> = [];
    const processed: ProcessedUpload[] = [];

    await Promise.all(files.map((file, idx) => limit(async () => {
      const name = file.originalname || 'unknown';
      const writtenPaths: string[] = [];
      try {
        if (!file.buffer) throw new Error('空文件');
        if (!PHOTO_MIME_RE.test(file.mimetype ?? '')) throw new Error('仅支持图片格式');
        if ((file.size ?? file.buffer.length) > MAX_UPLOAD_FILE_SIZE) throw new Error('单张图片不能超过 15MB');
        await this.moderation.assertAllowed(file.buffer);
        const uuid = randomUUID();
        const info = await this.watermark.imageInfo(file.buffer);
        const originalPath = `photos/${activityId}/original/${uuid}${this.originalImageExtension(info.format)}`;
        const thumbnailPath = `photos/${activityId}/thumb/${uuid}.jpg`;
        const watermarked = await this.watermark.applyWatermark(
          file.buffer, config.buffers, config.logoHeightPercent, config.logoGapPercent,
          info.height > info.width ? config.portraitPosition : config.position,
          {
            content: config.text, color: config.textColor, heightPercent: config.textSizePercent,
            position: info.height > info.width ? config.textPortraitPosition : config.textPosition,
            font: config.textFont,
          },
        );
        const fullPath = `photos/${activityId}/full/${uuid}${watermarked.ext}`;
        const thumb = await this.watermark.generateThumbnail(watermarked.buffer);
        this.writeRelative(originalPath, file.buffer); writtenPaths.push(originalPath);
        this.writeRelative(fullPath, watermarked.buffer); writtenPaths.push(fullPath);
        this.writeRelative(thumbnailPath, thumb); writtenPaths.push(thumbnailPath);
        processed.push({ idx, name, originalPath, fullPath, thumbnailPath, fileSize: file.size ?? file.buffer.length, width: info.width, height: info.height });
      } catch (error) {
        writtenPaths.forEach((path) => this.removeRelative(path));
        failed.push({ name, reason: error instanceof Error ? error.message : '处理失败' });
      }
    })));

    const ready = processed.sort((a, b) => a.idx - b.idx);
    let uploaded = 0;
    if (ready.length) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const locked = await this.lockActivityForPhotoSequence(tx, activityId);
          if (!locked.length) throw new NotFoundException('活动不存在');
          const seq = await tx.photo.aggregate({ where: { activityId }, _max: { seq: true } });
          const base = seq._max.seq ?? 0;
          for (const [order, item] of ready.entries()) {
            await tx.photo.create({ data: {
              activityId, uploaderId, category, seq: base + order + 1,
              originalPath: item.originalPath, fullPath: item.fullPath, thumbnailPath: item.thumbnailPath,
              fileSize: item.fileSize, width: item.width, height: item.height,
            } });
          }
        });
        uploaded = ready.length;
      } catch (error) {
        ready.forEach((item) => this.removeProcessedUploadFiles(item));
        const reason = error instanceof Error ? error.message : '处理失败';
        failed.push(...ready.map((item) => ({ name: item.name, reason })));
      }
    }
    return { uploaded, failed };
  }

  // ---------------------------------------------------------------------------
  // Public gallery
  // ---------------------------------------------------------------------------

  private url(relPath: string) {
    return `/api/uploads/${relPath}`;
  }

  private photoAccessUrl(photoId: string, action: 'thumb' | 'view' | 'download', accessToken: string) {
    return `/api/photos/${photoId}/${action}?accessToken=${encodeURIComponent(accessToken)}`;
  }

  private validateAccessToken(accessToken?: string) {
    if (typeof accessToken !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(accessToken)) {
      throw new NotFoundException('图片访问地址不存在');
    }
    return accessToken;
  }

  private async findGalleryByAccessToken(accessToken: string) {
    const validAccessToken = this.validateAccessToken(accessToken);
    const tournament = await this.prisma.tournament.findUnique({
      where: { photoAccessToken: validAccessToken },
      select: {
        id: true,
        name: true,
        subtitle: true,
        coverImageUrl: true,
        startDate: true,
        endDate: true,
        location: true,
      },
    });
    if (tournament) return { ...tournament, scope: 'tournament' as const };
    const activity = await this.prisma.photoActivity.findFirst({
      where: { photoAccessToken: validAccessToken, approvalStatus: 'APPROVED' },
      select: { id: true, title: true, coverImageUrl: true, startAt: true, endAt: true },
    });
    if (!activity) throw new NotFoundException('图片访问地址不存在');
    return {
      id: activity.id,
      name: activity.title,
      subtitle: null,
      coverImageUrl: activity.coverImageUrl,
      startDate: activity.startAt,
      endDate: activity.endAt ?? activity.startAt,
      location: null,
      scope: 'activity' as const,
    };
  }

  async getPublicGallery(accessToken: string) {
    const gallery = await this.findGalleryByAccessToken(accessToken);
    const photoCount = await this.prisma.photo.count({
      where: { ...(gallery.scope === 'activity' ? { activityId: gallery.id } : { tournamentId: gallery.id }), deletedAt: null },
    });
    return { ...gallery, photoCount };
  }

  async listPublicPhotos(query: PublicPhotoQueryDto) {
    const gallery = await this.findGalleryByAccessToken(query.accessToken);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const orderBy: Prisma.PhotoOrderByWithRelationInput[] =
      query.sort === PublicPhotoSort.DOWNLOADS
        ? [{ downloadCount: 'desc' }, { viewCount: 'desc' }, { uploadedAt: 'desc' }, { id: 'desc' }]
        : query.sort === PublicPhotoSort.LATEST
          ? [{ uploadedAt: 'desc' }, { id: 'desc' }]
          : [{ viewCount: 'desc' }, { downloadCount: 'desc' }, { uploadedAt: 'desc' }, { id: 'desc' }];
    const where: Prisma.PhotoWhereInput = {
      ...(gallery.scope === 'activity' ? { activityId: gallery.id } : { tournamentId: gallery.id }),
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
    };

    const [total, stats, rows] = await this.prisma.$transaction([
      this.prisma.photo.count({ where }),
      this.prisma.photo.aggregate({
        where,
        _sum: {
          viewCount: true,
          downloadCount: true,
        },
      }),
      this.prisma.photo.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          category: true,
          seq: true,
          fullPath: true,
          thumbnailPath: true,
          width: true,
          height: true,
          uploadedAt: true,
          viewCount: true,
          downloadCount: true,
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      stats: {
        viewCount: stats._sum.viewCount ?? 0,
        downloadCount: stats._sum.downloadCount ?? 0,
      },
      items: rows.map((r) => ({
        id: r.id,
        category: r.category,
        seq: r.seq,
        url: this.photoAccessUrl(r.id, 'view', query.accessToken),
        thumbUrl: this.photoAccessUrl(r.id, 'thumb', query.accessToken),
        downloadUrl: this.photoAccessUrl(r.id, 'download', query.accessToken),
        width: r.width,
        height: r.height,
        uploadedAt: r.uploadedAt,
        viewCount: r.viewCount,
        downloadCount: r.downloadCount,
      })),
    };
  }

  async getPublicThumb(photoId: string, accessToken: string) {
    const validAccessToken = this.validateAccessToken(accessToken);
    const photo = await this.prisma.photo.findFirst({
      where: {
        id: photoId,
        deletedAt: null,
        OR: [
          { tournament: { photoAccessToken: validAccessToken } },
          { activity: { photoAccessToken: validAccessToken, approvalStatus: 'APPROVED' } },
        ],
      },
    });
    if (!photo || photo.deletedAt) throw new NotFoundException('图片不存在');
    const abs = this.absolute(photo.thumbnailPath);
    if (!existsSync(abs)) throw new NotFoundException('缩略图文件丢失');

    await this.prisma.photo.update({
      where: { id: photoId },
      data: { viewCount: { increment: 1 } },
    });

    return { absolutePath: abs };
  }

  async getPublicView(photoId: string, accessToken: string) {
    const validAccessToken = this.validateAccessToken(accessToken);
    const photo = await this.prisma.photo.findFirst({
      where: {
        id: photoId,
        deletedAt: null,
        OR: [
          { tournament: { photoAccessToken: validAccessToken } },
          { activity: { photoAccessToken: validAccessToken, approvalStatus: 'APPROVED' } },
        ],
      },
    });
    if (!photo || photo.deletedAt) throw new NotFoundException('图片不存在');
    const abs = this.absolute(photo.fullPath);
    if (!existsSync(abs)) throw new NotFoundException('图片文件丢失');

    await this.prisma.photo.update({
      where: { id: photoId },
      data: { viewCount: { increment: 1 } },
    });

    return { absolutePath: abs };
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

  private clampLogoHeightPercent(value?: number | null): number {
    const v = value ?? DEFAULT_LOGO_HEIGHT_PERCENT;
    return Math.min(MAX_LOGO_HEIGHT_PERCENT, Math.max(MIN_LOGO_HEIGHT_PERCENT, Math.round(v)));
  }

  private clampLogoGapPercent(value?: number | null): number {
    const v = value ?? DEFAULT_LOGO_GAP_PERCENT;
    return Math.min(MAX_LOGO_GAP_PERCENT, Math.max(MIN_LOGO_GAP_PERCENT, Math.round(v)));
  }

  private clampTextSizePercent(value?: number | null): number {
    const v = value ?? DEFAULT_TEXT_SIZE_PERCENT;
    return Math.min(MAX_TEXT_SIZE_PERCENT, Math.max(MIN_TEXT_SIZE_PERCENT, Math.round(v)));
  }

  /** Trim + length-cap the text; empty → null (no text watermark). */
  private sanitizeText(value?: string | null): string | null {
    const v = (value ?? '').trim().slice(0, MAX_TEXT_LENGTH);
    return v ? v : null;
  }

  /** Accept #RGB / #RRGGBB hex only; fall back to white. */
  private sanitizeTextColor(value?: string | null): string {
    const v = (value ?? '').trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : DEFAULT_TEXT_COLOR;
  }

  private sanitizeTextFont(value?: string | null): TextFontType {
    const v = (value ?? '').trim().toUpperCase();
    return (TEXT_FONT_OPTIONS as readonly string[]).includes(v)
      ? (v as TextFontType)
      : DEFAULT_TEXT_FONT;
  }

  async getWatermark(tournamentId: string) {
    const config = await this.prisma.tournamentWatermark.findUnique({
      where: { tournamentId },
    });
    const logos = this.parseLogos(config?.logos);
    return {
      tournamentId,
      logos: logos.map((l) => ({ ...l, url: this.url(l.path) })),
      logoHeightPercent: config?.logoHeightPercent ?? DEFAULT_LOGO_HEIGHT_PERCENT,
      logoGapPercent: config?.logoGapPercent ?? DEFAULT_LOGO_GAP_PERCENT,
      position: this.normalizePosition(config?.position),
      portraitPosition: this.normalizePosition(config?.portraitPosition ?? config?.position),
      text: config?.text?.trim() ? config.text.trim() : '',
      textColor: config?.textColor ?? DEFAULT_TEXT_COLOR,
      textSizePercent: config?.textSizePercent ?? DEFAULT_TEXT_SIZE_PERCENT,
      textFont: (config?.textFont as TextFontType) ?? DEFAULT_TEXT_FONT,
      textPosition: this.normalizePosition(config?.textPosition ?? config?.position),
      textPortraitPosition: this.normalizePosition(
        config?.textPortraitPosition ??
          config?.portraitPosition ??
          config?.textPosition ??
          config?.position,
      ),
      updatedAt: config?.updatedAt ?? null,
    };
  }

  async updateWatermark(tournamentId: string, dto: UpdateWatermarkDto) {
    await this.assertTournamentExists(tournamentId);
    const logos = dto.logos
      .slice(0, 5)
      .map((l, i) => ({ order: i + 1, path: l.path, filename: l.filename }));
    const data = {
      logos: logos as unknown as Prisma.InputJsonValue,
      logoHeightPercent: this.clampLogoHeightPercent(dto.logoHeightPercent),
      logoGapPercent: this.clampLogoGapPercent(dto.logoGapPercent),
      position: this.normalizePosition(dto.position),
      portraitPosition: this.normalizePosition(dto.portraitPosition ?? dto.position),
      text: this.sanitizeText(dto.text),
      textColor: this.sanitizeTextColor(dto.textColor),
      textSizePercent: this.clampTextSizePercent(dto.textSizePercent),
      textFont: this.sanitizeTextFont(dto.textFont),
      textPosition: this.normalizePosition(dto.textPosition ?? dto.position),
      textPortraitPosition: this.normalizePosition(
        dto.textPortraitPosition ??
          dto.portraitPosition ??
          dto.textPosition ??
          dto.position,
      ),
    };
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

    await this.moderation.assertAllowed(file.buffer);
    const uuid = randomUUID();
    const path = `photos/${tournamentId}/logos/${uuid}.png`;
    this.writeRelative(path, file.buffer);

    const next = [...logos, { order: logos.length + 1, path, filename: file.originalname }].map(
      (l, i) => ({ order: i + 1, path: l.path, filename: l.filename }),
    );
    const data = { logos: next as unknown as Prisma.InputJsonValue };
    try {
      await this.prisma.tournamentWatermark.upsert({
        where: { tournamentId },
        create: { tournamentId, ...data },
        update: data,
      });
    } catch (error) {
      this.removeRelative(path);
      throw error;
    }
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

  async getActivityWatermark(activityId: string) {
    const config = await this.prisma.photoActivityWatermark.findUnique({ where: { activityId } });
    const logos = this.parseLogos(config?.logos);
    return {
      activityId,
      logos: logos.map((logo) => ({ ...logo, url: this.url(logo.path) })),
      logoHeightPercent: config?.logoHeightPercent ?? DEFAULT_LOGO_HEIGHT_PERCENT,
      logoGapPercent: config?.logoGapPercent ?? DEFAULT_LOGO_GAP_PERCENT,
      position: this.normalizePosition(config?.position),
      portraitPosition: this.normalizePosition(config?.portraitPosition ?? config?.position),
      text: config?.text?.trim() ? config.text.trim() : '',
      textColor: config?.textColor ?? DEFAULT_TEXT_COLOR,
      textSizePercent: config?.textSizePercent ?? DEFAULT_TEXT_SIZE_PERCENT,
      textFont: (config?.textFont as TextFontType) ?? DEFAULT_TEXT_FONT,
      textPosition: this.normalizePosition(config?.textPosition ?? config?.position),
      textPortraitPosition: this.normalizePosition(config?.textPortraitPosition ?? config?.portraitPosition ?? config?.textPosition ?? config?.position),
      updatedAt: config?.updatedAt ?? null,
    };
  }

  async updateActivityWatermark(activityId: string, dto: UpdateWatermarkDto) {
    await this.assertActivityExists(activityId);
    const logos = dto.logos.slice(0, 5).map((logo, index) => ({ order: index + 1, path: logo.path, filename: logo.filename }));
    const data = {
      logos: logos as unknown as Prisma.InputJsonValue,
      logoHeightPercent: this.clampLogoHeightPercent(dto.logoHeightPercent),
      logoGapPercent: this.clampLogoGapPercent(dto.logoGapPercent),
      position: this.normalizePosition(dto.position),
      portraitPosition: this.normalizePosition(dto.portraitPosition ?? dto.position),
      text: this.sanitizeText(dto.text),
      textColor: this.sanitizeTextColor(dto.textColor),
      textSizePercent: this.clampTextSizePercent(dto.textSizePercent),
      textFont: this.sanitizeTextFont(dto.textFont),
      textPosition: this.normalizePosition(dto.textPosition ?? dto.position),
      textPortraitPosition: this.normalizePosition(dto.textPortraitPosition ?? dto.portraitPosition ?? dto.textPosition ?? dto.position),
    };
    await this.prisma.photoActivityWatermark.upsert({
      where: { activityId }, create: { activityId, ...data }, update: data,
    });
    return this.getActivityWatermark(activityId);
  }

  async addActivityWatermarkLogo(activityId: string, file: UploadFile) {
    await this.assertActivityExists(activityId);
    if (!file?.buffer) throw new BadRequestException('请上传有效的 PNG 文件');
    if (!(file.mimetype || '').includes('png')) throw new BadRequestException('Logo 必须为 PNG 格式');
    const config = await this.prisma.photoActivityWatermark.findUnique({ where: { activityId } });
    const logos = this.parseLogos(config?.logos);
    if (logos.length >= 5) throw new BadRequestException('最多只能添加 5 个 Logo');
    await this.moderation.assertAllowed(file.buffer);
    const path = `photos/${activityId}/logos/${randomUUID()}.png`;
    this.writeRelative(path, file.buffer);
    const next = [...logos, { order: logos.length + 1, path, filename: file.originalname }]
      .map((logo, index) => ({ order: index + 1, path: logo.path, filename: logo.filename }));
    try {
      await this.prisma.photoActivityWatermark.upsert({
        where: { activityId },
        create: { activityId, logos: next as unknown as Prisma.InputJsonValue },
        update: { logos: next as unknown as Prisma.InputJsonValue },
      });
    } catch (error) {
      this.removeRelative(path);
      throw error;
    }
    return this.getActivityWatermark(activityId);
  }

  async deleteActivityWatermarkLogo(activityId: string, path: string) {
    const config = await this.prisma.photoActivityWatermark.findUnique({ where: { activityId } });
    if (!config) throw new NotFoundException('水印配置不存在');
    const logos = this.parseLogos(config.logos);
    const target = logos.find((logo) => logo.path === path);
    if (!target) throw new NotFoundException('Logo 不存在');
    this.removeRelative(target.path);
    const next = logos.filter((logo) => logo.path !== path)
      .map((logo, index) => ({ order: index + 1, path: logo.path, filename: logo.filename }));
    await this.prisma.photoActivityWatermark.update({ where: { activityId }, data: { logos: next as unknown as Prisma.InputJsonValue } });
    return this.getActivityWatermark(activityId);
  }

  // ---------------------------------------------------------------------------
  // Admin photo management
  // ---------------------------------------------------------------------------

  async adminListPhotos(query: AdminPhotoQueryDto, actor?: AuthActor) {
    if (Boolean(query.tournamentId) === Boolean(query.activityId)) {
      throw new BadRequestException('必须且只能指定一个赛事或活动');
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const where: Prisma.PhotoWhereInput = {
      ...(query.activityId
        ? {
            activityId: query.activityId,
            activity: actor?.role === 'ROOT' ? {} : { submittedById: actor?.id },
          }
        : { tournamentId: query.tournamentId, tournament: tournamentScope(actor) }),
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
          seq: true,
          fullPath: true,
          thumbnailPath: true,
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
        seq: r.seq,
        url: signedPhotoPreviewUrl(r.fullPath),
        thumbUrl: signedPhotoPreviewUrl(r.thumbnailPath),
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
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      include: { tournament: { select: { name: true } }, activity: { select: { title: true } } },
    });
    if (!photo || photo.deletedAt) throw new NotFoundException('图片不存在');
    const abs = this.absolute(photo.originalPath);
    if (!existsSync(abs)) throw new NotFoundException('原图文件丢失');

    await this.log(photo.tournamentId, photo.activityId, operator, 'VIEW_ORIGINAL', photo.id, {
      originalPath: photo.originalPath,
    });

    const ext = photo.originalPath.slice(photo.originalPath.lastIndexOf('.')) || '.jpg';
    const filename = `${this.safeFileName(photo.tournament?.name ?? photo.activity?.title ?? '活动')}-${photo.seq}${ext}`;
    return { absolutePath: abs, filename };
  }

  /**
   * Public download of the high-res watermarked version. Routed through the API
   * (rather than a raw /uploads URL) so the filename is server-controlled and
   * future access control / counting can hook in here. Filename: 赛事名-分类-序号.ext.
   */
  async getDownload(photoId: string, accessToken: string) {
    const validAccessToken = this.validateAccessToken(accessToken);
    const photo = await this.prisma.photo.findFirst({
      where: {
        id: photoId,
        deletedAt: null,
        OR: [
          { tournament: { photoAccessToken: validAccessToken } },
          { activity: { photoAccessToken: validAccessToken, approvalStatus: 'APPROVED' } },
        ],
      },
      include: { tournament: { select: { name: true } }, activity: { select: { title: true } } },
    });
    if (!photo || photo.deletedAt) throw new NotFoundException('图片不存在');
    const abs = this.absolute(photo.fullPath);
    if (!existsSync(abs)) throw new NotFoundException('图片文件丢失');

    // Increment download count
    await this.prisma.photo.update({
      where: { id: photoId },
      data: { downloadCount: { increment: 1 } },
    });

    const name = this.safeFileName(photo.tournament?.name ?? photo.activity?.title ?? '活动');
    const category = PHOTO_CATEGORY_LABELS[photo.category] ?? photo.category;
    const dot = photo.fullPath.lastIndexOf('.');
    const ext = dot >= 0 ? photo.fullPath.slice(dot) : '.jpg';
    const filename = `${name}-${category}-${photo.seq}${ext}`;
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
    await this.log(photo.tournamentId, photo.activityId, operator, 'DELETE_PHOTO', photo.id, {
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
      const byTarget = new Map<string, { tournamentId: string | null; activityId: string | null; count: number }>();
      photos.forEach((photo) => {
        const key = photo.activityId ? `activity:${photo.activityId}` : `tournament:${photo.tournamentId}`;
        const current = byTarget.get(key);
        byTarget.set(key, { tournamentId: photo.tournamentId, activityId: photo.activityId, count: (current?.count ?? 0) + 1 });
      });
      for (const target of byTarget.values()) {
        await this.log(target.tournamentId, target.activityId, operator, 'BATCH_DELETE', null, { count: target.count });
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
    await this.log(tournamentId, null, operator, 'DELETE_TOURNAMENT_PHOTOS', null, {
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

  async deleteActivityPhotos(activityId: string, confirmName: string, operator: { id: string; username?: string | null }) {
    const activity = await this.prisma.photoActivity.findUnique({ where: { id: activityId }, select: { title: true } });
    if (!activity) throw new NotFoundException('活动不存在');
    if ((confirmName ?? '').trim() !== activity.title) throw new BadRequestException('活动名称不匹配,删除已取消');
    const photos = await this.prisma.photo.findMany({ where: { activityId, deletedAt: null } });
    photos.forEach((photo) => this.hardRemoveFiles(photo));
    if (photos.length) {
      await this.prisma.photo.updateMany({ where: { id: { in: photos.map((photo) => photo.id) } }, data: { deletedAt: new Date() } });
    }
    await this.log(null, activityId, operator, 'DELETE_ACTIVITY_PHOTOS', null, { count: photos.length });
    return { deleted: photos.length };
  }

  async listActivityLogs(activityId: string) {
    const since = new Date(Date.now() - PHOTO_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const logs = await this.prisma.photoOperationLog.findMany({
      where: { activityId, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 500,
    });
    return logs.map((log) => ({ id: log.id, photoId: log.photoId, action: log.action, operator: log.operatorNameSnapshot, detail: log.detail, createdAt: log.createdAt }));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private hardRemoveFiles(photo: {
    originalPath: string;
    fullPath: string;
    thumbnailPath: string;
  }) {
    this.removeProcessedUploadFiles(photo);
  }

  /** Strip characters that are illegal in filenames / Content-Disposition. */
  private safeFileName(name: string) {
    return (name || '')
      .replace(/[\\/:*?"<>|\r\n]/g, '')
      .trim()
      .slice(0, 80) || '赛事';
  }

  private async assertTournamentExists(tournamentId: string) {
    const exists = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('赛事不存在');
  }

  private async assertActivityExists(activityId: string) {
    const exists = await this.prisma.photoActivity.findUnique({ where: { id: activityId }, select: { id: true } });
    if (!exists) throw new NotFoundException('活动不存在');
  }

  private async log(
    tournamentId: string | null,
    activityId: string | null,
    operator: { id: string; username?: string | null },
    action: string,
    photoId: string | null,
    detail?: Prisma.InputJsonValue,
  ) {
    try {
      await this.prisma.photoOperationLog.create({
        data: {
          tournamentId,
          activityId,
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
