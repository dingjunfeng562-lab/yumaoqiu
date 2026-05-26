import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EventType,
  Format,
  Gender,
  Prisma,
  RegistrationStatus,
  Role,
  ScoringMode,
  ScoringRule,
  TournamentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitCompetitionRegistrationDto } from './dto/competition-registration.dto';
import { effectiveTournamentStatus } from '../tournaments/tournament-status';

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

const TOURNAMENT_STATUS_LABELS: Record<TournamentStatus, string> = {
  REGISTRATION_NOT_STARTED: '报名未开始',
  REGISTRATION_OPEN: '报名中',
  REGISTRATION_CLOSED: '报名已截止',
  ONGOING: '比赛进行中',
  FINISHED: '已结束',
};

const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已拒绝',
  REMOVED: '已移除',
};

type CompetitionWithRelations = Prisma.TournamentGetPayload<{
  include: {
    events: {
      include: {
        registrations: true;
      };
    };
    competitionRegistrations: {
      include: {
        user: true;
        eventItems: {
          include: {
            event: true;
          };
        };
      };
    };
  };
}>;

type CompetitionRegistrationWithRelations = Prisma.CompetitionRegistrationGetPayload<{
  include: {
    user: true;
    eventItems: {
      include: {
        event: true;
      };
    };
  };
}>;

type RegistrationWithRelations = Prisma.RegistrationGetPayload<{
  include: {
    event: true;
    player1: true;
    player2: true;
    competitionRegistration: {
      include: {
        user: true;
      };
    };
  };
}>;

@Injectable()
export class CompetitionsService {
  constructor(private prisma: PrismaService) {}

  async listPublicCompetitions() {
    const competitions = await this.prisma.tournament.findMany({
      where: { isArchived: false, isPublished: true, approvalStatus: 'APPROVED' },
      include: {
        events: {
          include: {
            registrations: true,
          },
          orderBy: { type: 'asc' },
        },
        competitionRegistrations: {
          include: {
            user: true,
            eventItems: {
              include: {
                event: true,
              },
            },
          },
        },
      },
      orderBy: [{ startDate: 'desc' }, { edition: 'desc' }],
    });

    return competitions.map((competition) => this.toCompetitionView(competition));
  }

  async getPublicCompetition(id: string) {
    const competition = await this.findCompetition(id, false);
    return this.toCompetitionView(competition, true);
  }

  async getMyRegistration(competitionId: string, userId: string) {
    await this.findCompetition(competitionId, false);
    const registration = await this.prisma.competitionRegistration.findUnique({
      where: {
        competitionId_userId: {
          competitionId,
          userId,
        },
      },
      include: {
        user: true,
        eventItems: {
          include: {
            event: true,
          },
        },
      },
    });

    if (!registration) {
      return null;
    }

    return this.toCompetitionRegistrationView(registration);
  }

  async submitRegistration(competitionId: string, userId: string, dto: SubmitCompetitionRegistrationDto) {
    const competition = await this.findCompetition(competitionId, false);
    this.ensureRegistrationWindow(competition);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    if (user.role !== Role.PLAYER) {
      throw new ForbiddenException('只有普通用户可以提交报名');
    }

    const eventIds = [...new Set(dto.items.map((item) => item.eventId.trim()))];
    if (eventIds.length !== dto.items.length) {
      throw new BadRequestException('报名项目不能重复');
    }
    const maxRegistrationEvents = competition.allowCrossEventRegistration ? competition.maxRegistrationEvents : 1;
    if (eventIds.length > maxRegistrationEvents) {
      throw new BadRequestException(`最多选择 ${maxRegistrationEvents} 个报名项目`);
    }

    const events = competition.events.filter((event) => eventIds.includes(event.id));
    if (events.length !== eventIds.length) {
      throw new BadRequestException('存在无效的报名项目');
    }

    for (const item of dto.items) {
      const event = events.find((current) => current.id === item.eventId.trim());
      if (!event) {
        throw new BadRequestException('存在无效的报名项目');
      }
      this.ensurePartnerFields(event.type, item.partnerName, item.partnerStudentId, item.teamName);
    }

    const existing = await this.prisma.competitionRegistration.findUnique({
      where: {
        competitionId_userId: {
          competitionId,
          userId,
        },
      },
      include: {
        user: true,
        eventItems: {
          include: {
            event: true,
          },
        },
      },
    });

    if (existing && (existing.status === RegistrationStatus.PENDING || existing.status === RegistrationStatus.APPROVED)) {
      throw new ConflictException('你已提交报名，当前状态下不能重复提交');
    }

    const gender = this.normalizeGender(dto.gender);
    const nextStatus = competition.needsRegistrationReview ? RegistrationStatus.PENDING : RegistrationStatus.APPROVED;

    const registration = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.competitionRegistrationEventItem.deleteMany({
          where: { competitionRegistrationId: existing.id },
        });
        await tx.registration.updateMany({
          where: { competitionRegistrationId: existing.id },
          data: {
            status: RegistrationStatus.REMOVED,
            reviewedAt: null,
            reviewedBy: null,
            rejectReason: null,
            groupName: null,
            isSeed: false,
            seedRank: null,
          },
        });

        const updated = await tx.competitionRegistration.update({
          where: { id: existing.id },
          data: {
            studentId: dto.studentId.trim(),
            name: dto.name.trim(),
            gender,
            school: dto.school.trim(),
            contact: dto.contact?.trim() || null,
            remark: dto.remark?.trim() || null,
            status: nextStatus,
            rejectReason: null,
            reviewedAt: nextStatus === RegistrationStatus.APPROVED ? new Date() : null,
            reviewedById: null,
            eventItems: {
              create: dto.items.map((item) => ({
                eventId: item.eventId.trim(),
                partnerName: item.partnerName?.trim() || null,
                partnerStudentId: item.partnerStudentId?.trim() || null,
                teamName: item.teamName?.trim() || null,
              })),
            },
          },
          include: {
            user: true,
            eventItems: {
              include: {
                event: true,
              },
            },
          },
        });
        if (nextStatus === RegistrationStatus.APPROVED) {
          await this.createApprovedRegistrationRecords(tx, updated, null);
        }
        return updated;
      }

      const created = await tx.competitionRegistration.create({
        data: {
          competitionId,
          userId,
          studentId: dto.studentId.trim(),
          name: dto.name.trim(),
          gender,
          school: dto.school.trim(),
          contact: dto.contact?.trim() || null,
          remark: dto.remark?.trim() || null,
          status: nextStatus,
          reviewedAt: nextStatus === RegistrationStatus.APPROVED ? new Date() : undefined,
          eventItems: {
            create: dto.items.map((item) => ({
              eventId: item.eventId.trim(),
              partnerName: item.partnerName?.trim() || null,
              partnerStudentId: item.partnerStudentId?.trim() || null,
              teamName: item.teamName?.trim() || null,
            })),
          },
        },
        include: {
          user: true,
          eventItems: {
            include: {
              event: true,
            },
          },
        },
      });
      if (nextStatus === RegistrationStatus.APPROVED) {
        await this.createApprovedRegistrationRecords(tx, created, null);
      }
      return created;
    });

    return {
      message: competition.needsRegistrationReview ? '报名已提交，请等待管理员审核。' : '报名已提交并自动通过。',
      registration: this.toCompetitionRegistrationView(registration),
    };
  }

  async listMyRegistrations(userId: string) {
    if (!userId) return [];
    const registrations = await this.prisma.competitionRegistration.findMany({
      where: { userId },
      include: {
        user: true,
        competition: true,
        eventItems: { include: { event: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return registrations.map((registration) => ({
      ...this.toCompetitionRegistrationView(registration),
      competition: {
        id: registration.competition.id,
        name: registration.competition.name,
        title: registration.competition.name,
        startDate: registration.competition.startDate.toISOString(),
        endDate: registration.competition.endDate.toISOString(),
        location: registration.competition.location,
        coverImage: registration.competition.coverImageUrl,
      },
    }));
  }

  async listPublicPlayers(competitionId: string) {
    await this.findCompetition(competitionId, false);
    const registrations = await this.findRegistrationsByCompetition(competitionId, {
      status: RegistrationStatus.APPROVED,
    });
    return this.groupPlayers(registrations);
  }

  async listAdminCompetitions() {
    const competitions = await this.prisma.tournament.findMany({
      include: {
        events: {
          include: {
            registrations: true,
          },
          orderBy: { type: 'asc' },
        },
        competitionRegistrations: {
          include: {
            user: true,
            eventItems: {
              include: {
                event: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    return competitions.map((competition) => ({
      ...this.toCompetitionView(competition, true),
      isArchived: competition.isArchived,
      isPublished: competition.isPublished,
      approvalStatus: competition.approvalStatus,
      rejectReason: competition.rejectReason,
      counts: {
        all: competition.competitionRegistrations.length,
        pending: competition.competitionRegistrations.filter((item) => item.status === RegistrationStatus.PENDING)
          .length,
        approved: competition.competitionRegistrations.filter((item) => item.status === RegistrationStatus.APPROVED)
          .length,
        rejected: competition.competitionRegistrations.filter((item) => item.status === RegistrationStatus.REJECTED)
          .length,
        removed: competition.competitionRegistrations.filter((item) => item.status === RegistrationStatus.REMOVED)
          .length,
      },
    }));
  }

  async publishCompetition(id: string) {
    const existing = await this.findCompetition(id, true);
    if (existing.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('赛事尚未通过总管理员审核,无法发布');
    }
    const competition = await this.prisma.tournament.update({
      where: { id },
      data: {
        isArchived: false,
        isPublished: true,
      },
      include: {
        events: {
          include: { registrations: true },
        },
        competitionRegistrations: {
          include: {
            user: true,
            eventItems: {
              include: {
                event: true,
              },
            },
          },
        },
      },
    });
    return this.toCompetitionView(competition, true);
  }

  async unpublishCompetition(id: string) {
    await this.findCompetition(id, true);
    const competition = await this.prisma.tournament.update({
      where: { id },
      data: { isPublished: false },
      include: {
        events: {
          include: { registrations: true },
        },
        competitionRegistrations: {
          include: {
            user: true,
            eventItems: {
              include: {
                event: true,
              },
            },
          },
        },
      },
    });
    return this.toCompetitionView(competition, true);
  }

  async listAdminRegistrations(competitionId: string, status?: string) {
    await this.findCompetition(competitionId, true);
    const normalizedStatus = this.normalizeStatusFilter(status);
    const registrations = await this.prisma.competitionRegistration.findMany({
      where: {
        competitionId,
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
      include: {
        user: true,
        eventItems: {
          include: {
            event: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    return registrations
      .sort((a, b) => this.statusPriority(a.status) - this.statusPriority(b.status))
      .map((registration) => this.toCompetitionRegistrationView(registration));
  }

  async listAdminPlayers(competitionId: string, eventName?: string, search?: string) {
    await this.findCompetition(competitionId, true);
    const eventType = eventName ? this.normalizeEventType(eventName) : undefined;
    const registrations = await this.findRegistrationsByCompetition(competitionId, {
      status: RegistrationStatus.APPROVED,
      eventType,
      search,
    });

    return registrations.map((registration) => this.toRegistrationView(registration));
  }

  async approveRegistration(competitionRegistrationId: string, reviewedById?: string) {
    const competitionRegistration = await this.ensureCompetitionRegistration(competitionRegistrationId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const registration = await tx.competitionRegistration.update({
        where: { id: competitionRegistration.id },
        data: {
          status: RegistrationStatus.APPROVED,
          reviewedAt: new Date(),
          reviewedById: reviewedById ?? null,
          rejectReason: null,
        },
        include: {
          user: true,
          eventItems: {
            include: {
              event: true,
            },
          },
        },
      });

      const existingRegularRegistrations = await tx.registration.findMany({
        where: { competitionRegistrationId: competitionRegistration.id },
      });

      if (existingRegularRegistrations.length) {
        await tx.registration.updateMany({
          where: { competitionRegistrationId: competitionRegistration.id },
          data: {
            status: RegistrationStatus.APPROVED,
            reviewedAt: new Date(),
            reviewedBy: reviewedById ?? null,
            rejectReason: null,
          },
        });
      } else {
        await this.createApprovedRegistrationRecords(tx, registration, reviewedById ?? null);
      }

      return registration;
    });

    return this.toCompetitionRegistrationView(updated);
  }

  async rejectRegistration(competitionRegistrationId: string, reviewedById?: string, rejectReason?: string) {
    const competitionRegistration = await this.ensureCompetitionRegistration(competitionRegistrationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.competitionRegistration.update({
        where: { id: competitionRegistration.id },
        data: {
          status: RegistrationStatus.REJECTED,
          reviewedAt: new Date(),
          reviewedById: reviewedById ?? null,
          rejectReason: rejectReason?.trim() || null,
        },
      });
      await tx.registration.updateMany({
        where: { competitionRegistrationId: competitionRegistration.id },
        data: {
          status: RegistrationStatus.REJECTED,
          reviewedAt: new Date(),
          reviewedBy: reviewedById ?? null,
          rejectReason: rejectReason?.trim() || null,
          groupName: null,
          isSeed: false,
          seedRank: null,
        },
      });
    });

    const updated = await this.ensureCompetitionRegistration(competitionRegistration.id);
    return this.toCompetitionRegistrationView(updated);
  }

  async removeRegistration(competitionRegistrationId: string, reviewedById?: string) {
    const competitionRegistration = await this.ensureCompetitionRegistration(competitionRegistrationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.competitionRegistration.update({
        where: { id: competitionRegistration.id },
        data: {
          status: RegistrationStatus.REMOVED,
          reviewedAt: new Date(),
          reviewedById: reviewedById ?? null,
          rejectReason: null,
        },
      });
      await tx.registration.updateMany({
        where: { competitionRegistrationId: competitionRegistration.id },
        data: {
          status: RegistrationStatus.REMOVED,
          reviewedAt: new Date(),
          reviewedBy: reviewedById ?? null,
          rejectReason: null,
          groupName: null,
          isSeed: false,
          seedRank: null,
        },
      });
    });

    const updated = await this.ensureCompetitionRegistration(competitionRegistration.id);
    return this.toCompetitionRegistrationView(updated);
  }

  private async findCompetition(id: string, includeArchived: boolean) {
    const competition = await this.prisma.tournament.findFirst({
      where: {
        id,
        ...(includeArchived ? {} : { isArchived: false }),
        ...(includeArchived ? {} : { isPublished: true }),
      },
      include: {
        events: {
          include: {
            registrations: true,
          },
          orderBy: { type: 'asc' },
        },
        competitionRegistrations: {
          include: {
            user: true,
            eventItems: {
              include: {
                event: true,
              },
            },
          },
        },
      },
    });
    if (!competition) throw new NotFoundException('赛事不存在');
    return competition;
  }

  private async ensureCompetitionRegistration(id: string) {
    const registration = await this.prisma.competitionRegistration.findUnique({
      where: { id },
      include: {
        user: true,
        eventItems: {
          include: {
            event: true,
          },
        },
      },
    });
    if (!registration) throw new NotFoundException('报名记录不存在');
    return registration;
  }

  private async ensureEvent(
    tournamentId: string,
    events: CompetitionWithRelations['events'],
    type: EventType,
  ) {
    const existing = events.find((event) => event.type === type);
    if (existing) return existing;

    return this.prisma.event.create({
      data: {
        tournamentId,
        type,
        format: Format.SINGLE_ELIMINATION,
        scoringRule: ScoringRule.TWENTYONE_BO3,
        scoringMode: ScoringMode.STANDARD_GOLDEN,
      },
      include: { registrations: true },
    });
  }

  private ensureRegistrationWindow(competition: CompetitionWithRelations) {
    const status = effectiveTournamentStatus(competition);
    if (status === TournamentStatus.FINISHED || status === TournamentStatus.ONGOING) {
      throw new BadRequestException('赛事已开始或已结束，无法报名。');
    }
    if (status === TournamentStatus.REGISTRATION_NOT_STARTED) {
      throw new BadRequestException('报名尚未开始。');
    }
    if (status === TournamentStatus.REGISTRATION_CLOSED) {
      throw new BadRequestException('报名已截止。');
    }
  }

  private findRegistrationsByCompetition(
    competitionId: string,
    filters: {
      status?: RegistrationStatus;
      eventType?: EventType;
      search?: string;
    } = {},
  ) {
    const search = filters.search?.trim();
    return this.prisma.registration.findMany({
      where: {
        event: {
          tournamentId: competitionId,
          ...(filters.eventType ? { type: filters.eventType } : {}),
        },
        ...(filters.status ? { status: filters.status } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { studentId: { contains: search } },
                { className: { contains: search } },
                { competitionRegistration: { user: { email: { contains: search } } } },
                { competitionRegistration: { school: { contains: search } } },
                { player1: { name: { contains: search } } },
                { player1: { affiliation: { contains: search } } },
              ],
            }
          : {}),
      },
      include: {
        event: true,
        player1: true,
        player2: true,
        competitionRegistration: {
          include: {
            user: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  private async createApprovedRegistrationRecords(
    tx: Prisma.TransactionClient,
    registration: CompetitionRegistrationWithRelations,
    reviewedById: string | null,
  ) {
    const schoolName = registration.school?.trim() || '未填写学校';
    for (const item of registration.eventItems) {
      const primaryPlayer = await tx.player.create({
        data: {
          name: registration.name,
          gender: registration.gender,
          affiliation: schoolName,
          contact: registration.contact,
          notes: registration.remark,
        },
      });

      let secondaryPlayerId: string | null = null;
      if (this.isDoubleEvent(item.event.type) && item.partnerName) {
        const secondaryPlayer = await tx.player.create({
          data: {
            name: item.partnerName,
            gender: this.resolvePartnerGender(item.event.type, registration.gender),
            // Partner shares the same school as primary registrant.
            affiliation: schoolName,
            contact: null,
            notes: null,
          },
        });
        secondaryPlayerId = secondaryPlayer.id;
      }

      await tx.registration.create({
        data: {
          competitionRegistrationId: registration.id,
          eventId: item.eventId,
          player1Id: primaryPlayer.id,
          player2Id: secondaryPlayerId,
          name: secondaryPlayerId && item.partnerName ? `${registration.name} / ${item.partnerName}` : registration.name,
          teamName: secondaryPlayerId ? item.teamName?.trim() || null : null,
          studentId: registration.studentId,
          className: schoolName,
          phone: registration.contact,
          gender: registration.gender,
          eventName: EVENT_TYPE_LABELS[item.event.type],
          remark: registration.remark,
          status: RegistrationStatus.APPROVED,
          reviewedAt: new Date(),
          reviewedBy: reviewedById,
        },
      });
    }
  }

  private toCompetitionView(competition: CompetitionWithRelations, detailed = false) {
    const status = effectiveTournamentStatus(competition);
    const approvedCount = competition.competitionRegistrations.filter(
      (item) => item.status === RegistrationStatus.APPROVED,
    ).length;
    const events = this.projectLabels(competition);

    return {
      id: competition.id,
      title: competition.name,
      name: competition.name,
      subtitle: competition.subtitle,
      coverImage: competition.coverImageUrl,
      cover: competition.coverImageUrl,
      startDate: competition.startDate.toISOString(),
      endDate: competition.endDate.toISOString(),
      location: competition.location,
      events,
      projects: events,
      eventOptions: competition.events.map((event) => ({
        id: event.id,
        type: event.type,
        label: EVENT_TYPE_LABELS[event.type],
        isDouble: this.isDoubleEvent(event.type),
      })),
      description: competition.description ?? competition.rules,
      registrationNotice: competition.registrationNotice,
      maxRegistrationEvents: competition.maxRegistrationEvents,
      allowCrossEventRegistration: competition.allowCrossEventRegistration,
      needsRegistrationReview: competition.needsRegistrationReview,
      status,
      rawStatus: competition.status,
      statusLabel: TOURNAMENT_STATUS_LABELS[status],
      registrationStatus: this.registrationStatusText(competition),
      registrationStartTime: competition.registrationStartDate?.toISOString() ?? null,
      registrationEndTime: competition.registrationEndDate?.toISOString() ?? null,
      registeredCount: approvedCount,
      createdAt: detailed ? competition.createdAt.toISOString() : undefined,
      updatedAt: detailed ? competition.updatedAt.toISOString() : undefined,
      isPublished: detailed ? competition.isPublished : undefined,
    };
  }

  private toCompetitionRegistrationView(registration: CompetitionRegistrationWithRelations) {
    return {
      id: registration.id,
      competitionId: registration.competitionId,
      userId: registration.userId,
      email: registration.user.email ?? '',
      studentId: registration.studentId,
      name: registration.name,
      gender: registration.gender,
      genderLabel: registration.gender === Gender.MALE ? '男' : '女',
      school: registration.school ?? '',
      contact: registration.contact ?? '',
      phone: registration.contact ?? '',
      remark: registration.remark ?? '',
      items: registration.eventItems.map((item) => ({
        id: item.id,
        eventId: item.eventId,
        eventType: item.event.type,
        eventName: EVENT_TYPE_LABELS[item.event.type],
        partnerName: item.partnerName,
        partnerStudentId: item.partnerStudentId,
        teamName: item.teamName,
      })),
      eventNames: registration.eventItems.map((item) => EVENT_TYPE_LABELS[item.event.type]),
      eventSummary: registration.eventItems.map((item) => EVENT_TYPE_LABELS[item.event.type]).join(' / '),
      status: registration.status.toLowerCase(),
      statusRaw: registration.status,
      statusLabel: REGISTRATION_STATUS_LABELS[registration.status],
      createdAt: registration.createdAt.toISOString(),
      reviewedAt: registration.reviewedAt?.toISOString() ?? null,
      reviewedBy: registration.reviewedById,
      rejectReason: registration.rejectReason,
    };
  }

  private toRegistrationView(registration: RegistrationWithRelations) {
    const gender = registration.gender ?? registration.player1.gender;
    const school =
      registration.competitionRegistration?.school ??
      registration.className ??
      registration.player1.affiliation ??
      '';
    const primaryName = registration.player1.name;
    const partner = registration.player2
      ? {
          name: registration.player2.name,
          gender: registration.player2.gender,
          genderLabel: registration.player2.gender === Gender.MALE ? '男' : '女',
          // The partner shares the school of the primary registrant on doubles
          // registrations, so fall back to the same school resolution.
          school,
          phone: registration.player2.contact ?? '',
        }
      : null;
    return {
      id: registration.id,
      competitionRegistrationId: registration.competitionRegistrationId,
      competitionId: registration.event.tournamentId,
      eventId: registration.eventId,
      email: registration.competitionRegistration?.user.email ?? '',
      name: registration.name ?? primaryName,
      // Always expose the primary player's individual name so doubles lists can
      // show each team member on their own row.
      primaryName,
      partner,
      teamName: registration.teamName ?? null,
      studentId: registration.studentId ?? '',
      school,
      className: registration.className ?? registration.player1.affiliation,
      phone: registration.phone ?? registration.player1.contact ?? '',
      gender,
      genderLabel: gender === Gender.MALE ? '男' : '女',
      eventName: registration.eventName ?? EVENT_TYPE_LABELS[registration.event.type],
      eventType: registration.event.type,
      remark: registration.remark ?? registration.player1.notes ?? '',
      status: registration.status.toLowerCase(),
      statusRaw: registration.status,
      statusLabel: REGISTRATION_STATUS_LABELS[registration.status],
      createdAt: registration.createdAt.toISOString(),
      reviewedAt: registration.reviewedAt?.toISOString() ?? null,
      reviewedBy: registration.reviewedBy,
      rejectReason: registration.rejectReason,
    };
  }

  private groupPlayers(registrations: RegistrationWithRelations[]) {
    const players = registrations.map((registration) => this.toRegistrationView(registration));
    return {
      players,
      groups: {
        mensSingles: players.filter((item) => item.eventType === EventType.MENS_SINGLES),
        womensSingles: players.filter((item) => item.eventType === EventType.WOMENS_SINGLES),
        mensDoubles: players.filter((item) => item.eventType === EventType.MENS_DOUBLES),
        womensDoubles: players.filter((item) => item.eventType === EventType.WOMENS_DOUBLES),
        mixedDoubles: players.filter((item) => item.eventType === EventType.MIXED_DOUBLES),
      },
    };
  }

  private projectLabels(competition: {
    projectText: string | null;
    events: Array<{ type: EventType }>;
  }) {
    const fromText = (competition.projectText ?? '')
      .split(/[\/、,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (fromText.length) return fromText;

    const labels = competition.events.map((event) => EVENT_TYPE_LABELS[event.type]);
    return [...new Set(labels)].filter(Boolean);
  }

  private registrationStatusText(competition: CompetitionWithRelations) {
    const status = effectiveTournamentStatus(competition);
    if (status === TournamentStatus.FINISHED) return '已结束';
    if (status === TournamentStatus.ONGOING) return '比赛进行中';
    if (status === TournamentStatus.REGISTRATION_NOT_STARTED) return '报名未开始';
    if (status === TournamentStatus.REGISTRATION_CLOSED) return '报名已截止';
    return '报名中';
  }

  private normalizeEventType(value: string): EventType {
    if (value === EventType.MENS_SINGLES || value === '男子单打') return EventType.MENS_SINGLES;
    if (value === EventType.WOMENS_SINGLES || value === '女子单打') return EventType.WOMENS_SINGLES;
    if (value === EventType.MENS_DOUBLES || value === '男子双打') return EventType.MENS_DOUBLES;
    if (value === EventType.WOMENS_DOUBLES || value === '女子双打') return EventType.WOMENS_DOUBLES;
    if (value === EventType.MIXED_DOUBLES || value === '混合双打') return EventType.MIXED_DOUBLES;
    throw new BadRequestException('报名项目填写有误。');
  }

  private normalizeGender(value: string): Gender {
    if (value === Gender.MALE || value === '男') return Gender.MALE;
    if (value === Gender.FEMALE || value === '女') return Gender.FEMALE;
    throw new BadRequestException('性别填写有误。');
  }

  private normalizeStatusFilter(value?: string): RegistrationStatus | undefined {
    if (!value || value === 'all') return undefined;
    const normalized = value.toUpperCase();
    if (Object.values(RegistrationStatus).includes(normalized as RegistrationStatus)) {
      return normalized as RegistrationStatus;
    }
    throw new BadRequestException('审核状态筛选有误。');
  }

  private statusPriority(status: RegistrationStatus) {
    const priorities: Record<RegistrationStatus, number> = {
      PENDING: 0,
      APPROVED: 1,
      REJECTED: 2,
      REMOVED: 3,
    };
    return priorities[status] ?? 9;
  }

  private isDoubleEvent(eventType: EventType) {
    return (
      eventType === EventType.MENS_DOUBLES ||
      eventType === EventType.WOMENS_DOUBLES ||
      eventType === EventType.MIXED_DOUBLES
    );
  }

  private ensurePartnerFields(
    eventType: EventType,
    partnerName?: string,
    partnerStudentId?: string,
    teamName?: string,
  ) {
    if (!this.isDoubleEvent(eventType)) {
      return;
    }
    if (!partnerName?.trim() || !partnerStudentId?.trim()) {
      throw new BadRequestException('双打项目必须填写搭档姓名和学号');
    }
    if (!teamName?.trim()) {
      throw new BadRequestException('双打项目必须填写队伍名称');
    }
  }

  private resolvePartnerGender(eventType: EventType, primaryGender: Gender) {
    if (eventType === EventType.MENS_DOUBLES) return Gender.MALE;
    if (eventType === EventType.WOMENS_DOUBLES) return Gender.FEMALE;
    return primaryGender === Gender.MALE ? Gender.FEMALE : Gender.MALE;
  }
}
