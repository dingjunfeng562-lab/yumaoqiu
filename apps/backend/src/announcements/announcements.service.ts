import { Injectable, NotFoundException } from '@nestjs/common';
import { Announcement, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcement.dto';

@Injectable()
export class AnnouncementsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.announcement.findMany({
      orderBy: [
        { isPinned: 'desc' },
        { sortOrder: 'desc' },
        { publishedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
  }

  async findOne(id: string) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) throw new NotFoundException(`公告 ${id} 不存在`);
    return announcement;
  }

  create(dto: CreateAnnouncementDto, operator?: string) {
    const data = this.toAnnouncementData(dto) as Prisma.AnnouncementUncheckedCreateInput;
    data.createdBy = operator;
    data.updatedBy = operator;
    if (dto.isPublished && !dto.publishedAt) {
      data.publishedAt = new Date();
    }

    return this.prisma.announcement.create({ data });
  }

  async update(id: string, dto: UpdateAnnouncementDto, operator?: string) {
    const current = await this.findOne(id);
    const data = this.toAnnouncementData(dto) as Prisma.AnnouncementUncheckedUpdateInput;
    data.updatedBy = operator;
    if (dto.isPublished === true && !current.isPublished && dto.publishedAt === undefined && !current.publishedAt) {
      data.publishedAt = new Date();
    }

    return this.prisma.announcement.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.announcement.delete({ where: { id } });
  }

  async findPublished(limit?: number) {
    const announcements = await this.prisma.announcement.findMany({
      where: this.activeAnnouncementWhere(),
      orderBy: [
        { isPinned: 'desc' },
        { sortOrder: 'desc' },
        { publishedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      ...(limit ? { take: limit } : {}),
    });

    return announcements.map((announcement) => this.toPublicAnnouncement(announcement));
  }

  async findActivePopup() {
    const announcement = await this.prisma.announcement.findFirst({
      where: {
        ...this.activeAnnouncementWhere(),
        showAsPopup: true,
      },
      orderBy: [
        { isPinned: 'desc' },
        { sortOrder: 'desc' },
        { publishedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    return announcement ? this.toPublicAnnouncement(announcement) : null;
  }

  private toAnnouncementData(dto: CreateAnnouncementDto | UpdateAnnouncementDto) {
    const data: Record<string, unknown> = { ...dto };
    if (dto.publishedAt !== undefined) {
      data.publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : null;
    }
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    return data;
  }

  private activeAnnouncementWhere(): Prisma.AnnouncementWhereInput {
    const now = new Date();
    return {
      isPublished: true,
      AND: [
        {
          OR: [{ publishedAt: null }, { publishedAt: { lte: now } }],
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
      type: announcement.type,
      text: announcement.title,
      date: announcement.type,
      isPinned: announcement.isPinned,
      showAsPopup: announcement.showAsPopup,
      publishedAt: (announcement.publishedAt ?? announcement.createdAt).toISOString(),
      expiresAt: announcement.expiresAt?.toISOString() ?? null,
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString(),
    };
  }
}
