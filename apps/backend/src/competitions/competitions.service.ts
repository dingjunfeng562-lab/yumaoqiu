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
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../mail/email.service';
import {
  AdminBatchCompetitionPlayerDto,
  AdminBatchCompetitionPlayersDto,
  AdminCompetitionPlayerDto,
  SubmitCompetitionRegistrationDto,
} from './dto/competition-registration.dto';
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
        eventItems: true;
      };
    };
  };
}>;

const REGISTRATION_VIEW_INCLUDE = {
  event: true,
  player1: true,
  player2: true,
  competitionRegistration: {
    include: {
      user: true,
      eventItems: true,
    },
  },
} satisfies Prisma.RegistrationInclude;

type NormalizedAdminBatchPlayer = {
  name: string;
  gender: Gender;
  studentId: string;
  school: string;
  className: string;
  contact: string;
  teamName?: string;
  partnerName?: string;
  partnerGender?: Gender;
  partnerStudentId?: string;
  partnerSchool?: string;
  partnerClassName?: string;
  partnerContact?: string;
};

@Injectable()
export class CompetitionsService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

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
    if (!dto.className?.trim() || !dto.contact?.trim()) {
      throw new BadRequestException('请完整填写学院班级和联系方式');
    }

    const submittedEventIds = [...new Set(dto.items.map((item) => item.eventId.trim()))];
    if (submittedEventIds.length !== dto.items.length) {
      throw new BadRequestException('报名项目不能重复');
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

    if (existing?.status === RegistrationStatus.PENDING) {
      throw new ConflictException('你已提交报名，待审核状态下不能重复提交');
    }

    const existingApprovedEventIds =
      existing?.status === RegistrationStatus.APPROVED
        ? existing.eventItems.map((item) => item.eventId)
        : [];
    const eventIds = [...new Set([...existingApprovedEventIds, ...submittedEventIds])];
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
      this.ensureRegistrationGender(event.type, this.normalizeGender(dto.gender), item.partnerGender);
      this.ensurePartnerFields(
        event.type,
        item.partnerName,
        item.partnerGender,
        item.partnerStudentId,
        item.partnerSchool,
        item.partnerClassName,
        item.partnerContact,
        item.teamName,
      );
    }

    const gender = this.normalizeGender(dto.gender);
    const nextStatus = competition.needsRegistrationReview ? RegistrationStatus.PENDING : RegistrationStatus.APPROVED;

    const registration = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        if (existing.status === RegistrationStatus.APPROVED) {
          const newItems = dto.items.filter((item) => !existingApprovedEventIds.includes(item.eventId.trim()));
          if (!newItems.length) {
            throw new ConflictException('请选择新的报名项目');
          }
          const updated = await tx.competitionRegistration.update({
            where: { id: existing.id },
            data: {
              studentId: dto.studentId.trim(),
              name: dto.name.trim(),
              gender,
              school: dto.school.trim(),
              className: dto.className?.trim() || null,
              contact: dto.contact?.trim() || null,
              remark: dto.remark?.trim() || null,
              status: RegistrationStatus.APPROVED,
              rejectReason: null,
              eventItems: {
                create: newItems.map((item) => ({
                  eventId: item.eventId.trim(),
                  partnerName: item.partnerName?.trim() || null,
                  partnerGender: item.partnerGender ? this.normalizeGender(item.partnerGender) : null,
                  partnerStudentId: item.partnerStudentId?.trim() || null,
                  partnerSchool: item.partnerSchool?.trim() || null,
                  partnerClassName: item.partnerClassName?.trim() || null,
                  partnerContact: item.partnerContact?.trim() || null,
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
          await this.createApprovedRegistrationRecords(
            tx,
            updated,
            existing.reviewedById ?? null,
            newItems.map((item) => item.eventId.trim()),
          );
          return updated;
        }

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
            className: dto.className?.trim() || null,
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
                partnerGender: item.partnerGender ? this.normalizeGender(item.partnerGender) : null,
                partnerStudentId: item.partnerStudentId?.trim() || null,
                partnerSchool: item.partnerSchool?.trim() || null,
                partnerClassName: item.partnerClassName?.trim() || null,
                partnerContact: item.partnerContact?.trim() || null,
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
          className: dto.className?.trim() || null,
          contact: dto.contact?.trim() || null,
          remark: dto.remark?.trim() || null,
          status: nextStatus,
          reviewedAt: nextStatus === RegistrationStatus.APPROVED ? new Date() : undefined,
          eventItems: {
            create: dto.items.map((item) => ({
              eventId: item.eventId.trim(),
              partnerName: item.partnerName?.trim() || null,
              partnerGender: item.partnerGender ? this.normalizeGender(item.partnerGender) : null,
              partnerStudentId: item.partnerStudentId?.trim() || null,
              partnerSchool: item.partnerSchool?.trim() || null,
              partnerClassName: item.partnerClassName?.trim() || null,
              partnerContact: item.partnerContact?.trim() || null,
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

    if (registration.status === RegistrationStatus.APPROVED) {
      // 免审核赛事提交即通过，按"审核通过"通知
      this.notifyRegistrationEmail(registration, 'registration_approved');
    } else if (registration.status === RegistrationStatus.PENDING) {
      this.notifyRegistrationEmail(registration, 'registration_submitted');
    }

    return {
      message: existing?.status === RegistrationStatus.APPROVED
        ? '已追加报名项目。'
        : competition.needsRegistrationReview ? '报名已提交，请等待管理员审核。' : '报名已提交并自动通过。',
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

  async batchAddAdminPlayers(
    competitionId: string,
    dto: AdminBatchCompetitionPlayersDto,
    reviewedById?: string,
  ) {
    const competition = await this.findCompetition(competitionId, true);
    const event = competition.events.find((item) => item.id === dto.eventId);
    if (!event) throw new BadRequestException('请选择当前赛事下的参赛项目');
    // 不再因签表已冻结/已发布而拦截批量新增：新增报名只是把选手作为「未排位选手」加入，
    // 不会改动既有对阵图或比赛结果，需待下次重新抽签才纳入对阵。这样有结果的赛事也能继续补录选手而不必先清空结果。

    const players = dto.players.map((item, index) =>
      this.normalizeAdminBatchPlayer(item, index + 1, event.type),
    );
    this.ensureBatchStudentIds(players);
    await this.ensureNoExistingEventStudentIds(event.id, players);

    // 预生成 id 后用两次 createMany 批量入库（选手 + 报名），而不是逐条 await。
    // 逐条创建会在一个交互式事务里堆叠数百次往返、轻易超过 Prisma 默认 5s 事务超时
    // 导致整批回滚、前端一直 loading（“冻结”）。前端只用 createdCount，无需逐条返回。
    const reviewedAt = new Date();
    const playerRows: Prisma.PlayerCreateManyInput[] = [];
    const registrationRows: Prisma.RegistrationCreateManyInput[] = [];
    for (const item of players) {
      const primaryId = randomUUID();
      playerRows.push({
        id: primaryId,
        name: item.name,
        gender: item.gender,
        affiliation: item.school,
        contact: item.contact,
        isTemporary: true,
      });

      let secondaryPlayerId: string | null = null;
      if (this.isDoubleEvent(event.type) && item.partnerName && item.partnerGender) {
        secondaryPlayerId = randomUUID();
        playerRows.push({
          id: secondaryPlayerId,
          name: item.partnerName,
          gender: item.partnerGender,
          affiliation: item.partnerSchool ?? item.school,
          contact: item.partnerContact ?? null,
          isTemporary: true,
        });
      }

      registrationRows.push({
        eventId: event.id,
        player1Id: primaryId,
        player2Id: secondaryPlayerId,
        name: secondaryPlayerId && item.partnerName ? `${item.name} / ${item.partnerName}` : item.name,
        teamName: secondaryPlayerId ? item.teamName ?? null : null,
        studentId: item.studentId,
        className: item.className,
        phone: item.contact,
        gender: item.gender,
        eventName: EVENT_TYPE_LABELS[event.type],
        partnerStudentId: secondaryPlayerId ? item.partnerStudentId ?? null : null,
        partnerSchool: secondaryPlayerId ? item.partnerSchool ?? null : null,
        partnerClassName: secondaryPlayerId ? item.partnerClassName ?? null : null,
        partnerPhone: secondaryPlayerId ? item.partnerContact ?? null : null,
        status: RegistrationStatus.APPROVED,
        reviewedAt,
        reviewedBy: reviewedById ?? null,
      });
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.player.createMany({ data: playerRows });
        await tx.registration.createMany({ data: registrationRows });
      },
      { timeout: 30000, maxWait: 10000 },
    );

    return { createdCount: registrationRows.length };
  }

  async createAdminPlayer(
    competitionId: string,
    dto: AdminCompetitionPlayerDto,
    reviewedById?: string,
  ) {
    const competition = await this.findCompetition(competitionId, true);
    const event = competition.events.find((item) => item.id === dto.eventId);
    if (!event) throw new BadRequestException('请选择当前赛事下的参赛项目');

    // 复用批量录入的字段校验（单/双打必填项、性别合法性），单条按第 1 行处理。
    const player = this.normalizeAdminBatchPlayer(dto, 1, event.type);
    await this.ensureNoExistingEventStudentIds(event.id, [player]);

    const isDouble = this.isDoubleEvent(event.type);
    const reviewedAt = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const primary = await tx.player.create({
        data: {
          name: player.name,
          gender: player.gender,
          affiliation: player.school,
          contact: player.contact,
          isTemporary: true,
        },
      });

      let secondaryId: string | null = null;
      if (isDouble && player.partnerName && player.partnerGender) {
        const secondary = await tx.player.create({
          data: {
            name: player.partnerName,
            gender: player.partnerGender,
            affiliation: player.partnerSchool ?? player.school,
            contact: player.partnerContact ?? null,
            isTemporary: true,
          },
        });
        secondaryId = secondary.id;
      }

      return tx.registration.create({
        data: {
          eventId: event.id,
          player1Id: primary.id,
          player2Id: secondaryId,
          name: secondaryId && player.partnerName ? `${player.name} / ${player.partnerName}` : player.name,
          teamName: secondaryId ? player.teamName ?? null : null,
          studentId: player.studentId,
          className: player.className,
          phone: player.contact,
          gender: player.gender,
          eventName: EVENT_TYPE_LABELS[event.type],
          partnerStudentId: secondaryId ? player.partnerStudentId ?? null : null,
          partnerSchool: secondaryId ? player.partnerSchool ?? null : null,
          partnerClassName: secondaryId ? player.partnerClassName ?? null : null,
          partnerPhone: secondaryId ? player.partnerContact ?? null : null,
          status: RegistrationStatus.APPROVED,
          reviewedAt,
          reviewedBy: reviewedById ?? null,
        },
        include: REGISTRATION_VIEW_INCLUDE,
      });
    });

    return this.toRegistrationView(created);
  }

  async updateAdminPlayer(
    competitionId: string,
    registrationId: string,
    dto: AdminCompetitionPlayerDto,
    reviewedById?: string,
  ) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        event: true,
        player1: true,
        player2: true,
        competitionRegistration: {
          include: { eventItems: true },
        },
      },
    });
    if (!registration || registration.event.tournamentId !== competitionId) {
      throw new NotFoundException('报名记录不存在');
    }

    const competition = await this.findCompetition(competitionId, true);
    const targetEvent = competition.events.find(
      (item) => item.id === (dto.eventId ?? registration.eventId),
    );
    if (!targetEvent) throw new BadRequestException('请选择当前赛事下的参赛项目');

    // 仅信息修改不影响对阵结构，随时可改；只有「改报名项目」才会动到签表，故对已锁定项目拦截。
    const changingEvent = targetEvent.id !== registration.eventId;
    if (changingEvent && (registration.event.drawLocked || targetEvent.drawLocked)) {
      throw new ConflictException('签表已冻结或对阵已发布，请先取消发布后再调整报名项目');
    }

    const player = this.normalizeAdminBatchPlayer(dto, 1, targetEvent.type);
    await this.ensureNoExistingEventStudentIds(targetEvent.id, [player], registration.id);

    const isDouble = this.isDoubleEvent(targetEvent.type);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.player.update({
        where: { id: registration.player1Id },
        data: {
          name: player.name,
          gender: player.gender,
          affiliation: player.school,
          contact: player.contact,
        },
      });

      let secondaryId: string | null = null;
      if (isDouble && player.partnerName && player.partnerGender) {
        if (registration.player2Id) {
          await tx.player.update({
            where: { id: registration.player2Id },
            data: {
              name: player.partnerName,
              gender: player.partnerGender,
              affiliation: player.partnerSchool ?? player.school,
              contact: player.partnerContact ?? null,
            },
          });
          secondaryId = registration.player2Id;
        } else {
          const secondary = await tx.player.create({
            data: {
              name: player.partnerName,
              gender: player.partnerGender,
              affiliation: player.partnerSchool ?? player.school,
              contact: player.partnerContact ?? null,
              isTemporary: true,
            },
          });
          secondaryId = secondary.id;
        }
      }

      await tx.registration.update({
        where: { id: registration.id },
        data: {
          eventId: targetEvent.id,
          player2Id: secondaryId,
          name: secondaryId && player.partnerName ? `${player.name} / ${player.partnerName}` : player.name,
          teamName: secondaryId ? player.teamName ?? null : null,
          studentId: player.studentId,
          className: player.className,
          phone: player.contact,
          gender: player.gender,
          eventName: EVENT_TYPE_LABELS[targetEvent.type],
          partnerStudentId: secondaryId ? player.partnerStudentId ?? null : null,
          partnerSchool: secondaryId ? player.partnerSchool ?? null : null,
          partnerClassName: secondaryId ? player.partnerClassName ?? null : null,
          partnerPhone: secondaryId ? player.partnerContact ?? null : null,
          reviewedAt: new Date(),
          reviewedBy: reviewedById ?? null,
        },
      });

      // 选手自助报名生成的记录，学校/学院班级在视图里优先取自报名主表，
      // 因此必须把主表与对应项目一并改掉，前台与后台列表才会随之更新。
      if (registration.competitionRegistrationId) {
        await tx.competitionRegistration.update({
          where: { id: registration.competitionRegistrationId },
          data: {
            studentId: player.studentId,
            name: player.name,
            gender: player.gender,
            school: player.school,
            className: player.className,
            contact: player.contact,
          },
        });
        const eventItem = registration.competitionRegistration?.eventItems.find(
          (item) => item.eventId === targetEvent.id,
        );
        if (eventItem) {
          await tx.competitionRegistrationEventItem.update({
            where: { id: eventItem.id },
            data: {
              partnerName: secondaryId ? player.partnerName ?? null : null,
              partnerGender: secondaryId ? player.partnerGender ?? null : null,
              partnerStudentId: secondaryId ? player.partnerStudentId ?? null : null,
              partnerSchool: secondaryId ? player.partnerSchool ?? null : null,
              partnerClassName: secondaryId ? player.partnerClassName ?? null : null,
              partnerContact: secondaryId ? player.partnerContact ?? null : null,
              teamName: secondaryId ? player.teamName ?? null : null,
            },
          });
        }
      }

      return tx.registration.findUniqueOrThrow({
        where: { id: registration.id },
        include: REGISTRATION_VIEW_INCLUDE,
      });
    });

    return this.toRegistrationView(updated);
  }

  async removeAdminPlayerRegistration(
    competitionId: string,
    registrationId: string,
    reviewedById?: string,
  ) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        event: true,
      },
    });
    if (!registration || registration.event.tournamentId !== competitionId) {
      throw new NotFoundException('报名记录不存在');
    }
    if (registration.competitionRegistrationId) {
      return this.removeRegistration(registration.competitionRegistrationId, reviewedById);
    }
    if (registration.event.drawLocked) {
      throw new ConflictException('签表已冻结或对阵已发布，请先取消发布后再调整报名');
    }

    const updated = await this.prisma.registration.update({
      where: { id: registration.id },
      data: {
        status: RegistrationStatus.REMOVED,
        reviewedAt: new Date(),
        reviewedBy: reviewedById ?? null,
        rejectReason: null,
        groupName: null,
        isSeed: false,
        seedRank: null,
      },
      include: {
        event: true,
        player1: true,
        player2: true,
        competitionRegistration: {
          include: {
            user: true,
            eventItems: true,
          },
        },
      },
    });

    return this.toRegistrationView(updated);
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

    this.notifyRegistrationEmail(updated, 'registration_approved');

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

    this.notifyRegistrationEmail(updated, 'registration_rejected', updated.rejectReason);

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

  /**
   * 报名状态变化后异步发送邮件通知。
   * 是否真正发送由 EmailService 统一门控（SMTP / 全局开关 / 模板开关 / 赛事开关），
   * 发送失败或被跳过都只写入邮件日志，不影响业务主流程。
   */
  private notifyRegistrationEmail(
    registration: CompetitionRegistrationWithRelations,
    templateKey: 'registration_submitted' | 'registration_approved' | 'registration_rejected',
    rejectReason?: string | null,
  ) {
    void this.emailService.sendRegistrationNotification({
      templateKey,
      tournamentId: registration.competitionId,
      to: registration.user.email,
      playerName: registration.name,
      eventNames: registration.eventItems.map((item) => EVENT_TYPE_LABELS[item.event.type]),
      rejectReason,
    });
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
                { partnerStudentId: { contains: search } },
                { partnerClassName: { contains: search } },
                { partnerSchool: { contains: search } },
                { competitionRegistration: { user: { email: { contains: search } } } },
                { competitionRegistration: { school: { contains: search } } },
                { player1: { name: { contains: search } } },
                { player1: { affiliation: { contains: search } } },
                { player2: { name: { contains: search } } },
                { player2: { affiliation: { contains: search } } },
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
            eventItems: true,
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
    eventIds?: string[],
  ) {
    const schoolName = registration.school?.trim() || '未填写学校';
    const eventIdSet = eventIds?.length ? new Set(eventIds) : null;
    for (const item of registration.eventItems) {
      if (eventIdSet && !eventIdSet.has(item.eventId)) continue;
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
            gender: item.partnerGender ?? this.resolvePartnerGender(item.event.type, registration.gender),
            affiliation: item.partnerSchool?.trim() || schoolName,
            contact: item.partnerContact?.trim() || null,
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
          className: registration.className?.trim() || null,
          phone: registration.contact,
          gender: registration.gender,
          eventName: EVENT_TYPE_LABELS[item.event.type],
          partnerStudentId: secondaryPlayerId ? item.partnerStudentId?.trim() || null : null,
          partnerSchool: secondaryPlayerId ? item.partnerSchool?.trim() || null : null,
          partnerClassName: secondaryPlayerId ? item.partnerClassName?.trim() || null : null,
          partnerPhone: secondaryPlayerId ? item.partnerContact?.trim() || null : null,
          remark: registration.remark,
          status: RegistrationStatus.APPROVED,
          reviewedAt: new Date(),
          reviewedBy: reviewedById,
        },
      });
    }
  }

  private normalizeAdminBatchPlayer(
    item: AdminBatchCompetitionPlayerDto,
    rowNumber: number,
    eventType: EventType,
  ): NormalizedAdminBatchPlayer {
    const name = this.requiredBatchField(item.name, rowNumber, '姓名');
    const gender = this.normalizeBatchGender(item.gender, rowNumber, '性别');
    const studentId = this.requiredBatchField(item.studentId, rowNumber, '学号');
    const school = this.requiredBatchField(item.school, rowNumber, '学校');
    const className = this.requiredBatchField(item.className, rowNumber, '学院班级');
    const contact = this.requiredBatchField(item.contact, rowNumber, '联系方式');

    if (!this.isDoubleEvent(eventType)) {
      this.ensureRegistrationGender(eventType, gender);
      return {
        name,
        gender,
        studentId,
        school,
        className,
        contact,
      };
    }

    const teamName = this.requiredBatchField(item.teamName, rowNumber, '队伍名称');
    const partnerName = this.requiredBatchField(item.partnerName, rowNumber, '搭档姓名');
    const partnerGender = this.normalizeBatchGender(item.partnerGender, rowNumber, '搭档性别');
    const partnerStudentId = this.requiredBatchField(item.partnerStudentId, rowNumber, '搭档学号');
    const partnerSchool = this.requiredBatchField(item.partnerSchool, rowNumber, '搭档学校');
    const partnerClassName = this.requiredBatchField(item.partnerClassName, rowNumber, '搭档学院班级');
    const partnerContact = this.requiredBatchField(item.partnerContact, rowNumber, '搭档联系方式');

    try {
      this.ensureRegistrationGender(eventType, gender, partnerGender);
    } catch (error) {
      const message = error instanceof Error ? error.message : '双打性别填写有误';
      throw new BadRequestException(`第 ${rowNumber} 行：${message}`);
    }

    return {
      name,
      gender,
      studentId,
      school,
      className,
      contact,
      teamName,
      partnerName,
      partnerGender,
      partnerStudentId,
      partnerSchool,
      partnerClassName,
      partnerContact,
    };
  }

  private requiredBatchField(value: string | undefined, rowNumber: number, label: string) {
    const trimmed = value?.trim();
    if (!trimmed) throw new BadRequestException(`第 ${rowNumber} 行缺少${label}`);
    return trimmed;
  }

  private normalizeBatchGender(
    value: string | undefined,
    rowNumber: number,
    label: string,
  ) {
    try {
      return this.normalizeGender(this.requiredBatchField(value, rowNumber, label));
    } catch {
      throw new BadRequestException(`第 ${rowNumber} 行${label}填写有误`);
    }
  }

  private ensureBatchStudentIds(players: NormalizedAdminBatchPlayer[]) {
    const seen = new Map<string, string>();
    players.forEach((player, index) => {
      const rowLabel = `第 ${index + 1} 行`;
      const studentIds = [
        { value: player.studentId, label: `${rowLabel}学号` },
        ...(player.partnerStudentId
          ? [{ value: player.partnerStudentId, label: `${rowLabel}搭档学号` }]
          : []),
      ];

      studentIds.forEach((item) => {
        const existing = seen.get(item.value);
        if (existing) {
          throw new ConflictException(`${item.label}与${existing}重复：${item.value}`);
        }
        seen.set(item.value, item.label);
      });
    });
  }

  private async ensureNoExistingEventStudentIds(
    eventId: string,
    players: NormalizedAdminBatchPlayer[],
    excludeRegistrationId?: string,
  ) {
    const studentIds = [
      ...new Set(
        players.flatMap((player) =>
          [player.studentId, player.partnerStudentId].filter(Boolean) as string[],
        ),
      ),
    ];
    if (!studentIds.length) return;

    const existingRegistrations = await this.prisma.registration.findMany({
      where: {
        eventId,
        status: { not: RegistrationStatus.REMOVED },
        ...(excludeRegistrationId ? { id: { not: excludeRegistrationId } } : {}),
        OR: [
          { studentId: { in: studentIds } },
          { partnerStudentId: { in: studentIds } },
          {
            competitionRegistration: {
              eventItems: {
                some: {
                  eventId,
                  partnerStudentId: { in: studentIds },
                },
              },
            },
          },
        ],
      },
      select: {
        studentId: true,
        partnerStudentId: true,
        competitionRegistration: {
          select: {
            eventItems: {
              where: { eventId },
              select: { partnerStudentId: true },
            },
          },
        },
      },
    });

    const existingIds = new Set(
      existingRegistrations.flatMap((registration) => [
        registration.studentId,
        registration.partnerStudentId,
        ...(registration.competitionRegistration?.eventItems.map((item) => item.partnerStudentId) ?? []),
      ]).filter(Boolean) as string[],
    );
    const duplicated = studentIds.find((studentId) => existingIds.has(studentId));
    if (duplicated) throw new ConflictException(`学号 ${duplicated} 已在该项目报名`);
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
      className: registration.className ?? '',
      contact: registration.contact ?? '',
      phone: registration.contact ?? '',
      remark: registration.remark ?? '',
      items: registration.eventItems.map((item) => ({
        id: item.id,
        eventId: item.eventId,
        eventType: item.event.type,
        eventName: EVENT_TYPE_LABELS[item.event.type],
        partnerName: item.partnerName,
        partnerGender: item.partnerGender,
        partnerGenderLabel: item.partnerGender === Gender.MALE ? '男' : item.partnerGender === Gender.FEMALE ? '女' : null,
        partnerStudentId: item.partnerStudentId,
        partnerSchool: item.partnerSchool,
        partnerClassName: item.partnerClassName,
        partnerContact: item.partnerContact,
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
      registration.player1.affiliation ??
      '';
    const className =
      registration.competitionRegistration?.className ??
      registration.className ??
      '';
    const eventItem = registration.competitionRegistration?.eventItems.find((item) => item.eventId === registration.eventId);
    const primaryName = registration.player1.name;
    const partner = registration.player2
      ? {
          name: registration.player2.name,
          studentId: registration.partnerStudentId ?? eventItem?.partnerStudentId ?? '',
          gender: registration.player2.gender,
          genderLabel: registration.player2.gender === Gender.MALE ? '男' : '女',
          school: registration.partnerSchool ?? eventItem?.partnerSchool ?? registration.player2.affiliation ?? school,
          className: registration.partnerClassName ?? eventItem?.partnerClassName ?? '',
          phone: registration.partnerPhone ?? eventItem?.partnerContact ?? registration.player2.contact ?? '',
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
      isTemporary: registration.player1.isTemporary || Boolean(registration.player2?.isTemporary),
      studentId: registration.studentId ?? '',
      school,
      className,
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

  private ensureRegistrationGender(eventType: EventType, primaryGender: Gender, partnerGenderValue?: string) {
    const partnerGender = partnerGenderValue ? this.normalizeGender(partnerGenderValue) : null;
    if (eventType === EventType.MENS_SINGLES && primaryGender !== Gender.MALE) {
      throw new BadRequestException('男子单打报名性别必须为男');
    }
    if (eventType === EventType.WOMENS_SINGLES && primaryGender !== Gender.FEMALE) {
      throw new BadRequestException('女子单打报名性别必须为女');
    }
    if (eventType === EventType.MENS_DOUBLES && (primaryGender !== Gender.MALE || partnerGender !== Gender.MALE)) {
      throw new BadRequestException('男子双打必须两名队员均为男');
    }
    if (eventType === EventType.WOMENS_DOUBLES && (primaryGender !== Gender.FEMALE || partnerGender !== Gender.FEMALE)) {
      throw new BadRequestException('女子双打必须两名队员均为女');
    }
    if (
      eventType === EventType.MIXED_DOUBLES &&
      (!partnerGender || primaryGender === partnerGender)
    ) {
      throw new BadRequestException('混合双打必须为一男一女');
    }
  }

  private ensurePartnerFields(
    eventType: EventType,
    partnerName?: string,
    partnerGender?: string,
    partnerStudentId?: string,
    partnerSchool?: string,
    partnerClassName?: string,
    partnerContact?: string,
    teamName?: string,
  ) {
    if (!this.isDoubleEvent(eventType)) {
      return;
    }
    if (!teamName?.trim()) {
      throw new BadRequestException('双打项目必须填写队伍名称');
    }
    if (
      !partnerName?.trim() ||
      !partnerGender ||
      !partnerStudentId?.trim() ||
      !partnerSchool?.trim() ||
      !partnerClassName?.trim() ||
      !partnerContact?.trim()
    ) {
      throw new BadRequestException('双打项目必须完整填写搭档姓名、性别、学号、学校、学院班级和联系方式');
    }
  }

  private resolvePartnerGender(eventType: EventType, primaryGender: Gender) {
    if (eventType === EventType.MENS_DOUBLES) return Gender.MALE;
    if (eventType === EventType.WOMENS_DOUBLES) return Gender.FEMALE;
    return primaryGender === Gender.MALE ? Gender.FEMALE : Gender.MALE;
  }
}
