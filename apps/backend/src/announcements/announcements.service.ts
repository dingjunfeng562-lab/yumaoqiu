import { Injectable, NotFoundException } from '@nestjs/common';
import { Announcement, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeAnnouncementContent } from './announcement-content';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcement.dto';

const DEFAULT_TYPE = 'normal';
const DEFAULT_DISPLAY_MODE = 'popup';
const DEFAULT_SCOPE = 'global';
const DEFAULT_FREQUENCY = 'every_visit';
// Older public readers only recognize 'published' and isPublished = true.
const TARGETED_PUBLISHED = 'targeted_published';

@Injectable()
export class AnnouncementsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const announcements = await this.prisma.announcement.findMany({
      orderBy: [
        { priority: 'desc' },
        { status: 'asc' },
        { startAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });
    return announcements.map((announcement) => this.toAdminAnnouncement(announcement));
  }

  async findOne(id: string) {
    return this.toAdminAnnouncement(await this.getAnnouncement(id));
  }

  private async getAnnouncement(id: string) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) throw new NotFoundException(`公告 ${id} 不存在`);
    return announcement;
  }

  async create(dto: CreateAnnouncementDto, operator?: string) {
    const data = this.toAnnouncementData(dto, 'create') as Prisma.AnnouncementUncheckedCreateInput;
    data.createdBy = operator;
    data.updatedBy = operator;
    return this.toAdminAnnouncement(await this.prisma.announcement.create({ data }));
  }

  async update(id: string, dto: UpdateAnnouncementDto, operator?: string) {
    const current = await this.getAnnouncement(id);
    const data = this.toAnnouncementData(dto, 'update', current) as Prisma.AnnouncementUncheckedUpdateInput;
    data.updatedBy = operator;

    const where = dto.targetRole !== undefined || this.resolveStatus(dto) !== undefined
      ? { id, targetRole: current.targetRole, status: current.status, isPublished: current.isPublished }
      : { id };
    return this.toAdminAnnouncement(await this.prisma.announcement.update({
      where,
      data,
    }));
  }

  async updateStatus(id: string, status: 'published' | 'disabled', operator?: string) {
    const current = await this.getAnnouncement(id);
    const now = new Date();
    const currentStartAt = current.startAt ?? current.publishedAt ?? current.createdAt;
    const startAt = status === 'published' && currentStartAt > now ? now : currentStartAt;
    return this.toAdminAnnouncement(await this.prisma.announcement.update({
      where: { id, targetRole: current.targetRole },
      data: {
        ...this.publicationFields(status, current.targetRole),
        startAt,
        publishedAt: status === 'published' ? (current.publishedAt && current.publishedAt <= now ? current.publishedAt : startAt) : current.publishedAt,
        updatedBy: operator,
      },
    }));
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.announcement.delete({ where: { id } });
  }

  async findPublished(limit?: number, targetRole: Role | null = null) {
    const announcements = await this.prisma.announcement.findMany({
      where: this.activeAnnouncementWhere(targetRole, targetRole ? ['global', 'home'] : ['global']),
      orderBy: [
        { priority: 'desc' },
        { isPinned: 'desc' },
        { startAt: 'desc' },
        { createdAt: 'desc' },
      ],
      ...(limit ? { take: limit } : {}),
    });

    return announcements.map((announcement) => this.toPublicAnnouncement(announcement));
  }

  async findActivePopup(scope = DEFAULT_SCOPE) {
    return this.findActive(scope, 'popup');
  }

  async findActive(scope: string, displayMode: 'popup' | 'banner') {
    const announcement = await this.prisma.announcement.findFirst({
      where: {
        ...this.activeAnnouncementWhere(null, scope === 'home' ? ['global', 'home'] : ['global']),
        displayMode,
      },
      orderBy: [
        { priority: 'desc' },
        { startAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return announcement ? this.toActiveAnnouncement(announcement) : null;
  }

  private toAnnouncementData(
    dto: CreateAnnouncementDto | UpdateAnnouncementDto,
    mode: 'create' | 'update',
    current?: Announcement,
  ) {
    const data: Record<string, unknown> = {};

    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.content !== undefined) data.content = sanitizeAnnouncementContent(dto.content.trim());
    if (dto.targetRole !== undefined) data.targetRole = dto.targetRole;
    if (dto.type !== undefined) data.type = this.normalizeType(dto.type);
    if (dto.displayMode !== undefined) data.displayMode = dto.displayMode;
    if (dto.scope !== undefined) data.scope = dto.scope;
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.closable !== undefined) data.closable = dto.closable;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.primaryButtonText !== undefined) data.primaryButtonText = this.nullableTrim(dto.primaryButtonText);
    if (dto.primaryButtonLink !== undefined) data.primaryButtonLink = this.nullableTrim(dto.primaryButtonLink);
    if (dto.secondaryButtonText !== undefined) data.secondaryButtonText = this.nullableTrim(dto.secondaryButtonText);
    if (dto.startAt !== undefined) data.startAt = dto.startAt ? new Date(dto.startAt) : new Date();
    if (dto.endAt !== undefined) data.endAt = dto.endAt ? new Date(dto.endAt) : null;

    if (mode === 'create') {
      data.type ??= DEFAULT_TYPE;
      data.displayMode ??= DEFAULT_DISPLAY_MODE;
      data.scope ??= DEFAULT_SCOPE;
      data.frequency ??= DEFAULT_FREQUENCY;
      data.startAt ??= new Date();
      data.closable ??= true;
      data.priority ??= 0;
    }

    const status = this.resolveStatus(dto);
    const targetRole = dto.targetRole !== undefined ? dto.targetRole : current?.targetRole ?? null;
    if (status !== undefined || mode === 'create') {
      Object.assign(data, this.publicationFields(status ?? 'draft', targetRole));
    } else if (current && dto.targetRole !== undefined && targetRole !== current.targetRole) {
      const currentStatus = current.isPublished ? 'published' : this.toAdminAnnouncement(current).status;
      Object.assign(data, this.publicationFields(currentStatus, targetRole));
    }
    if (status === 'published') {
      data.publishedAt = (data.startAt as Date | undefined) ?? (dto.publishedAt ? new Date(dto.publishedAt) : new Date());
    }

    if (dto.isPinned !== undefined) data.isPinned = dto.isPinned;
    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
      if (dto.priority === undefined) data.priority = dto.sortOrder;
    }
    if (dto.showAsPopup !== undefined) {
      data.showAsPopup = dto.showAsPopup;
      if (dto.showAsPopup && dto.displayMode === undefined) data.displayMode = 'popup';
      if (dto.showAsPopup && dto.scope === undefined) data.scope = 'global';
    }
    if (dto.displayMode !== undefined || mode === 'create') {
      data.showAsPopup = (data.displayMode ?? DEFAULT_DISPLAY_MODE) === 'popup' && (data.scope ?? DEFAULT_SCOPE) === 'global';
    }

    if (dto.publishedAt !== undefined) {
      data.publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : null;
      if (dto.startAt === undefined && dto.publishedAt) data.startAt = new Date(dto.publishedAt);
    }
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
      if (dto.endAt === undefined) data.endAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    if (dto.startAt !== undefined && dto.publishedAt === undefined) data.publishedAt = data.startAt;
    if (dto.endAt !== undefined && dto.expiresAt === undefined) data.expiresAt = data.endAt;

    return data;
  }

  private resolveStatus(dto: CreateAnnouncementDto | UpdateAnnouncementDto) {
    if (dto.status !== undefined) return dto.status;
    if (dto.isPublished === true) return 'published';
    if (dto.isPublished === false) return 'disabled';
    return undefined;
  }

  private publicationFields(status: string, targetRole: Role | null) {
    return {
      status: status === 'published' && targetRole ? TARGETED_PUBLISHED : status,
      isPublished: status === 'published' && targetRole === null,
    };
  }

  private toAdminAnnouncement(announcement: Announcement) {
    if (announcement.status !== TARGETED_PUBLISHED) return announcement;
    return { ...announcement, status: 'published', isPublished: true };
  }

  private activeAnnouncementWhere(targetRole: Role | null, scopes: string[]): Prisma.AnnouncementWhereInput {
    const now = new Date();
    return {
      targetRole,
      scope: { in: scopes },
      ...(targetRole
        ? { status: TARGETED_PUBLISHED }
        : { OR: [{ status: 'published' }, { isPublished: true }] }),
      AND: [
        {
          OR: [{ startAt: { lte: now } }, { publishedAt: { lte: now } }],
        },
        {
          OR: [{ endAt: null }, { endAt: { gte: now } }],
        },
        {
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        },
      ],
    };
  }

  private toPublicAnnouncement(announcement: Announcement) {
    return {
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      targetRole: announcement.targetRole,
      type: announcement.type,
      displayMode: announcement.displayMode,
      scope: announcement.scope,
      frequency: announcement.frequency,
      closable: announcement.closable,
      primaryButtonText: announcement.primaryButtonText,
      primaryButtonLink: announcement.primaryButtonLink,
      secondaryButtonText: announcement.secondaryButtonText,
      text: announcement.title,
      date: announcement.type,
      isPinned: announcement.isPinned,
      showAsPopup: announcement.showAsPopup,
      publishedAt: (announcement.startAt ?? announcement.publishedAt ?? announcement.createdAt).toISOString(),
      startAt: (announcement.startAt ?? announcement.publishedAt ?? announcement.createdAt).toISOString(),
      endAt: announcement.endAt?.toISOString() ?? announcement.expiresAt?.toISOString() ?? null,
      expiresAt: announcement.endAt?.toISOString() ?? announcement.expiresAt?.toISOString() ?? null,
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString(),
    };
  }

  private toActiveAnnouncement(announcement: Announcement) {
    return {
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      type: announcement.type,
      displayMode: announcement.displayMode,
      scope: announcement.scope,
      frequency: announcement.frequency,
      closable: announcement.closable,
      primaryButtonText: announcement.primaryButtonText,
      primaryButtonLink: announcement.primaryButtonLink,
      secondaryButtonText: announcement.secondaryButtonText,
      startAt: (announcement.startAt ?? announcement.publishedAt ?? announcement.createdAt).toISOString(),
      endAt: announcement.endAt?.toISOString() ?? announcement.expiresAt?.toISOString() ?? null,
      updatedAt: announcement.updatedAt.toISOString(),
    };
  }

  private nullableTrim(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeType(type?: string | null) {
    if (!type) return DEFAULT_TYPE;
    if (['normal', 'event', 'maintenance', 'urgent'].includes(type)) return type;
    if (['赛事公告', '赛事', 'event_notice'].includes(type)) return 'event';
    if (['系统维护', '维护', 'maintenance_notice'].includes(type)) return 'maintenance';
    if (['紧急通知', '紧急', 'urgent_notice'].includes(type)) return 'urgent';
    return DEFAULT_TYPE;
  }
}
