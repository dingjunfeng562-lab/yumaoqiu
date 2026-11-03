import { hasPermission } from '../auth/permissions';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntrantType,
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
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthActor, tournamentScope } from '../auth/admin-scope';
import { EmailService } from '../mail/email.service';
import {
  AdminBatchCompetitionPlayerDto,
  AdminBatchCompetitionPlayersDto,
  AdminCompetitionLibraryPlayerDto,
  AdminCompetitionPlayerDto,
  PublicCompetitionRegistrationDto,
  SubmitCompetitionRegistrationDto,
} from './dto/competition-registration.dto';
import { effectiveTournamentStatus } from '../tournaments/tournament-status';
import { UpdateCompetitionRankingsDto } from './dto/competition-rankings.dto';
import {
  eventDisplayLabel,
  entrantTypeLabel,
  isFieldRequired,
  normalizeRegistrationFieldRules,
  type RegistrationFieldRules,
} from '../common/entrant';
import {
  generateRegistrationCode,
  normalizeRegistrationCode,
  registrationCodeFor,
} from '../common/registration-code';
import {
  ChangeActor,
  RedrawEvent,
  checkEventsForEntrantChange,
  deleteOrphanPlayers,
  ensureRegistrationEditable,
  lockEvents,
  markEventsStale,
  requireAdminActor,
} from '../common/registration-changes';
import { registrationDisplayName } from '../payments/payment-rules';

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
  social: boolean;
  entrantType: EntrantType;
  name: string;
  gender: Gender;
  // 社会组没有学号和学院；学生组按赛事字段配置决定是否必填。
  studentId?: string;
  college?: string;
  majorGrade?: string;
  school: string;
  className?: string;
  contact: string;
  teamName?: string;
  partnerName?: string;
  partnerGender?: Gender;
  partnerStudentId?: string;
  partnerSchool?: string;
  partnerCollege?: string;
  partnerMajorGrade?: string;
  partnerClassName?: string;
  partnerContact?: string;
  row: number;
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

  /**
   * 公开报名码校验：码本身决定组别，前台据此渲染学生组/社会组表单。
   * 与提交时的校验共用 registrationCodeFor / normalizeRegistrationCode。
   */
  async verifyRegistrationCode(code: string) {
    const normalized = normalizeRegistrationCode(code);
    if (!normalized) throw new NotFoundException('报名码无效或已停用');
    const tournament = await this.prisma.tournament.findFirst({
      where: {
        registrationCodeEnabled: true,
        isPublished: true,
        approvalStatus: 'APPROVED',
        isArchived: false,
        OR: [
          { schoolRegistrationCode: normalized, schoolRegistrationCodeEnabled: true },
          { socialRegistrationCode: normalized, socialRegistrationCodeEnabled: true },
        ],
      },
      include: {
        events: {
          orderBy: [{ entrantType: 'asc' }, { type: 'asc' }],
        },
      },
    });
    if (!tournament) {
      throw new NotFoundException('报名码无效或已停用，请向组委会确认');
    }
    const entrantType = tournament.schoolRegistrationCode === normalized
      ? EntrantType.SCHOOL
      : EntrantType.SOCIAL;
    const enabled = entrantType === EntrantType.SCHOOL
      ? tournament.allowSchoolRegistration
      : tournament.allowSocialRegistration;
    if (!enabled) {
      throw new ForbiddenException(
        `${entrantTypeLabel(entrantType)}报名未开放，请向组委会确认`,
      );
    }
    const rules = normalizeRegistrationFieldRules(tournament.registrationFieldRules);
    const payment = await this.prisma.tournamentPaymentSetting.findUnique({
      where: { tournamentId_entrantType: { tournamentId: tournament.id, entrantType } },
      select: { enabled: true, singlesFee: true, doublesFee: true },
    });
    return {
      tournamentId: tournament.id,
      title: tournament.name,
      subtitle: tournament.subtitle,
      // 扫码报名先展示赛事简介，再进入报名表。
      coverImageUrl: tournament.coverImageUrl,
      organizer: tournament.organizer,
      description: tournament.description ?? tournament.rules,
      registrationNotice: tournament.registrationNotice,
      maxRegistrationEvents: tournament.allowCrossEventRegistration ? tournament.maxRegistrationEvents : 1,
      needsRegistrationReview: tournament.needsRegistrationReview,
      registrationOpen: effectiveTournamentStatus(tournament) === TournamentStatus.REGISTRATION_OPEN,
      // 本组别收费标准（分）；未开启时为 null。免审核且收费时，提交后直接进入缴费页。
      payment: payment?.enabled
        ? { singlesFee: payment.singlesFee, doublesFee: payment.doublesFee }
        : null,
      startDate: tournament.startDate.toISOString(),
      endDate: tournament.endDate.toISOString(),
      location: tournament.location,
      registrationStatus: this.registrationStatusText(tournament),
      registrationStartTime: tournament.registrationStartDate?.toISOString() ?? null,
      registrationEndTime: tournament.registrationEndDate?.toISOString() ?? null,
      entrantType,
      entrantTypeLabel: entrantTypeLabel(entrantType),
      loginRequired: false,
      fieldRules: rules,
      events: tournament.events
        .filter((event) => event.entrantType === entrantType)
        .map((event) => ({
          id: event.id,
          type: event.type,
          label: eventDisplayLabel(event),
          isDouble: this.isDoubleEvent(event.type),
        })),
    };
  }

  /** 游客凭 token 查询报名状态；不暴露其他报名。 */
  async getPublicRegistration(competitionId: string, token: string) {
    const registration = await this.prisma.competitionRegistration.findFirst({
      where: { competitionId, guestToken: token },
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
    return this.toCompetitionRegistrationView(registration);
  }

  async regenerateRegistrationCode(competitionId: string, entrantType: string) {
    const type = this.normalizeEntrantType(entrantType);
    await this.findCompetition(competitionId, true);
    const code = await this.uniqueRegistrationCode();
    await this.prisma.tournament.update({
      where: { id: competitionId },
      data: type === EntrantType.SCHOOL
        ? { schoolRegistrationCode: code, schoolRegistrationCodeEnabled: true }
        : { socialRegistrationCode: code, socialRegistrationCodeEnabled: true },
    });
    return { entrantType: type, code };
  }

  async setRegistrationCodeEnabled(competitionId: string, entrantType: string, enabled: boolean) {
    const type = this.normalizeEntrantType(entrantType);
    await this.findCompetition(competitionId, true);
    await this.prisma.tournament.update({
      where: { id: competitionId },
      data: type === EntrantType.SCHOOL
        ? { schoolRegistrationCodeEnabled: enabled }
        : { socialRegistrationCodeEnabled: enabled },
    });
    return { entrantType: type, enabled };
  }

  private async uniqueRegistrationCode(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = generateRegistrationCode();
      const exists = await this.prisma.tournament.findFirst({
        where: {
          OR: [
            { schoolRegistrationCode: code },
            { socialRegistrationCode: code },
          ],
        },
        select: { id: true },
      });
      if (!exists) return code;
    }
    throw new ConflictException('报名码生成失败，请重试');
  }

  async submitRegistration(competitionId: string, userId: string, dto: SubmitCompetitionRegistrationDto) {
    const competition = await this.findCompetition(competitionId, false);
    this.ensureRegistrationWindow(competition);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    if (!hasPermission(user, 'REGISTRATION')) {
      throw new ForbiddenException('只有普通用户和超级管理员可以提交报名');
    }

    return this.saveRegistration(competition, userId, dto);
  }

  /**
   * 游客报名：学校组与社会组都可使用，凭报名码提交，不要求登录。
   * userId 为空，靠 guestToken 查询结果；已登录用户仍走 submitRegistration 以绑定账号。
   */
  async publicRegister(competitionId: string, dto: PublicCompetitionRegistrationDto) {
    const competition = await this.findCompetition(competitionId, false);
    this.ensureRegistrationWindow(competition);
    const result = await this.saveRegistration(competition, null, dto);
    const guestToken = await this.prisma.competitionRegistration.findUnique({
      where: { id: result.registration.id },
      select: { guestToken: true },
    });
    return { ...result, guestToken: guestToken?.guestToken ?? null };
  }

  private async saveRegistration(
    competition: CompetitionWithRelations,
    userId: string | null,
    dto: SubmitCompetitionRegistrationDto,
  ) {
    const entrantType = this.normalizeEntrantType(dto.entrantType);
    this.ensureRegistrationCode(competition, dto.registrationCode, entrantType);
    this.ensureChannelOpen(competition, entrantType);
    const rules = normalizeRegistrationFieldRules(competition.registrationFieldRules);

    const contact = dto.contact?.trim() ?? '';
    if (!contact) throw new BadRequestException('请填写联系方式');
    const school = dto.school?.trim() ?? '';
    if (!school) throw new BadRequestException(entrantType === EntrantType.SOCIAL ? '请填写单位/俱乐部' : '请填写学校');

    const studentId = entrantType === EntrantType.SCHOOL
      ? this.resolveGroupField(dto.studentId, rules, EntrantType.SCHOOL, 'studentId', '学号')
      : null;
    const college = entrantType === EntrantType.SCHOOL
      ? this.resolveGroupField(dto.college, rules, EntrantType.SCHOOL, 'college', '学院')
      : null;
    const majorGrade = entrantType === EntrantType.SCHOOL
      ? this.resolveGroupField(dto.majorGrade, rules, EntrantType.SCHOOL, 'majorGrade', '年级专业')
      : null;
    const className = [college, majorGrade].filter(Boolean).join(' ') || null;

    const submittedEventIds = [...new Set(dto.items.map((item) => item.eventId.trim()))];
    if (submittedEventIds.length !== dto.items.length) {
      throw new BadRequestException('报名项目不能重复');
    }

    const existing = userId
      ? await this.prisma.competitionRegistration.findUnique({
          where: {
            competitionId_userId: {
              competitionId: competition.id,
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
        })
      : null;

    if (existing?.status === RegistrationStatus.PENDING) {
      throw new ConflictException('你已提交报名，待审核状态下不能重复提交');
    }
    if (existing && existing.entrantType !== entrantType) {
      throw new ConflictException(
        `你已报名${entrantTypeLabel(existing.entrantType)}，不能重复报名${entrantTypeLabel(entrantType)}`,
      );
    }

    await this.ensureNoDuplicateRegistration(competition.id, entrantType, {
      studentId,
      name: dto.name.trim(),
      contact,
    }, existing?.id);

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
    if (events.some((event) => event.entrantType !== entrantType)) {
      throw new BadRequestException('报名项目与报名组别不一致');
    }

    const gender = this.normalizeGender(dto.gender);
    for (const item of dto.items) {
      const event = events.find((current) => current.id === item.eventId.trim());
      if (!event) {
        throw new BadRequestException('存在无效的报名项目');
      }
      this.ensureRegistrationGender(event.type, gender, item.partnerGender);
      this.ensurePartnerFields(event.type, item, entrantType, rules, {
        school,
        college,
        majorGrade,
        className,
      });
    }

    const nextStatus = competition.needsRegistrationReview
      ? RegistrationStatus.PENDING
      : RegistrationStatus.APPROVED;
    const fallback = { school, college, majorGrade, className };
    const baseData = {
      entrantType,
      studentId,
      college,
      majorGrade,
      name: dto.name.trim(),
      gender,
      school,
      className,
      contact,
      remark: dto.remark?.trim() || null,
      guestEmail: entrantType === EntrantType.SOCIAL ? dto.guestEmail?.trim() || null : null,
    };

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
              ...baseData,
              status: RegistrationStatus.APPROVED,
              rejectReason: null,
              eventItems: {
                create: newItems.map((item) => this.registrationItemData(item, entrantType, fallback)),
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
            ...baseData,
            status: nextStatus,
            rejectReason: null,
            reviewedAt: nextStatus === RegistrationStatus.APPROVED ? new Date() : null,
            reviewedById: null,
            eventItems: {
              create: dto.items.map((item) => this.registrationItemData(item, entrantType, fallback)),
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
          competitionId: competition.id,
          userId,
          ...baseData,
          guestToken: userId ? null : randomBytes(24).toString('base64url'),
          status: nextStatus,
          reviewedAt: nextStatus === RegistrationStatus.APPROVED ? new Date() : undefined,
          eventItems: {
            create: dto.items.map((item) => this.registrationItemData(item, entrantType, fallback)),
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

  async listAdminCompetitions(actor?: AuthActor) {
    const competitions = await this.prisma.tournament.findMany({
      where: tournamentScope(actor),
      include: {
        events: {
          include: {
            registrations: true,
          },
          orderBy: [{ entrantType: 'asc' }, { type: 'asc' }],
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

    // 赛事只存了 submittedById，没有建立 Prisma 关系。超级管理员需要在赛事管理里
    // 看到每条赛事由哪个账号创建/发布，这里一次性查出账号，避免逐条查询。
    const publisherIds = [
      ...new Set(
        competitions
          .map((competition) => competition.submittedById)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const publishers = publisherIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: publisherIds } },
          select: { id: true, username: true, email: true, role: true },
        })
      : [];
    const publisherById = new Map(publishers.map((publisher) => [publisher.id, publisher]));

    return competitions.map((competition) => {
      // 管理员在「参赛选手」里手工新增、批量导入、Excel 导入、选手库加入的报名不经过
      // 审核队列，直接以已通过状态落库（competitionRegistrationId 为空）。它们和线上报名
      // 一样属于「已通过」，必须一起统计，否则赛事管理里的「通过」会与报名审核列表、
      // 参赛选手人数对不上。
      const adminApproved = this.countAdminApprovedEntries(competition);
      const countByStatus = (target: RegistrationStatus) =>
        competition.competitionRegistrations.filter((item) => item.status === target).length;

      return {
        ...this.toCompetitionView(competition, true),
        // 报名码只给后台列表，公开接口不返回。
        schoolRegistrationCode: competition.schoolRegistrationCode,
        socialRegistrationCode: competition.socialRegistrationCode,
        schoolRegistrationCodeEnabled: competition.schoolRegistrationCodeEnabled,
        socialRegistrationCodeEnabled: competition.socialRegistrationCodeEnabled,
        registrationCodeEnabled: competition.registrationCodeEnabled,
        isArchived: competition.isArchived,
        isPublished: competition.isPublished,
        approvalStatus: competition.approvalStatus,
        rejectReason: competition.rejectReason,
        photoAccessEnabled: Boolean(competition.photoAccessToken),
        // 「发布人」= 创建并提交该赛事的账号；账号删除后 submittedById 仍保留，
        // 前端据此区分「账号已删除」和更早的历史赛事。
        submittedById: competition.submittedById,
        publisher: competition.submittedById
          ? publisherById.get(competition.submittedById) ?? null
          : null,
        counts: {
          // all = 报名审核页「全部」的条数 = 线上报名 + 管理员录入的已通过报名。
          all: competition.competitionRegistrations.length + adminApproved,
          pending: countByStatus(RegistrationStatus.PENDING),
          approved: countByStatus(RegistrationStatus.APPROVED) + adminApproved,
          rejected: countByStatus(RegistrationStatus.REJECTED),
          removed: countByStatus(RegistrationStatus.REMOVED),
        },
      };
    });
  }

  async publishCompetition(id: string) {
    const existing = await this.findCompetition(id, true);
    if (existing.isArchived) {
      throw new ForbiddenException('赛事已归档，请先由超级管理员恢复后再发布');
    }
    if (existing.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('赛事尚未通过超级管理员审核,无法发布');
    }
    const competition = await this.prisma.tournament.update({
      where: { id },
      data: {
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

  async getOrCreatePhotoAccess(id: string) {
    await this.findCompetition(id, true);
    const generatedToken = randomUUID().replace(/-/g, '');

    // updateMany makes concurrent first-time requests safe: only one request
    // can fill a null token, and all callers read back the same final value.
    await this.prisma.tournament.updateMany({
      where: { id, photoAccessToken: null },
      data: { photoAccessToken: generatedToken },
    });

    const competition = await this.prisma.tournament.findUnique({
      where: { id },
      select: { name: true, photoAccessToken: true },
    });
    if (!competition?.photoAccessToken) {
      throw new NotFoundException('赛事不存在');
    }

    return {
      competitionId: id,
      title: competition.name,
      accessToken: competition.photoAccessToken,
      path: `/tupiannicai/${competition.photoAccessToken}`,
    };
  }

  async listAdminRegistrations(competitionId: string, status?: string, entrantType?: string) {
    await this.findCompetition(competitionId, true);
    const normalizedStatus = this.normalizeStatusFilter(status);
    const normalizedEntrantType = entrantType && entrantType !== 'all'
      ? this.normalizeEntrantType(entrantType)
      : undefined;
    const registrations = await this.prisma.competitionRegistration.findMany({
      where: {
        competitionId,
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
        ...(normalizedEntrantType ? { entrantType: normalizedEntrantType } : {}),
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

    const onlineRows = registrations.map((registration) => this.toCompetitionRegistrationView(registration));

    // 管理员录入/批量导入的报名本来就不需要审核，但它们是「已通过」的一部分。
    // 只有当前筛选包含已通过时才需要合并，保证列表条数与赛事管理里的「通过」一致。
    const toAdminRow = (entry: RegistrationWithRelations) => this.toAdminEntryReviewView(entry);
    const adminRows: Array<ReturnType<typeof toAdminRow>> = [];
    if (!normalizedStatus || normalizedStatus === RegistrationStatus.APPROVED) {
      const adminEntries = await this.listAdminEntryRegistrations(competitionId, normalizedEntrantType);
      adminRows.push(...adminEntries.map(toAdminRow));
    }

    const rows: Array<(typeof onlineRows)[number] | ReturnType<typeof toAdminRow>> = [
      ...onlineRows,
      ...adminRows,
    ];
    return rows.sort((a, b) => {
      const byStatus = this.statusPriority(a.statusRaw) - this.statusPriority(b.statusRaw);
      if (byStatus !== 0) return byStatus;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  /** 管理员在参赛选手页新增/导入的已通过报名（不属于任何线上报名申请）。 */
  private listAdminEntryRegistrations(competitionId: string, entrantType?: EntrantType) {
    return this.prisma.registration.findMany({
      where: {
        competitionRegistrationId: null,
        status: RegistrationStatus.APPROVED,
        event: { tournamentId: competitionId },
        ...(entrantType ? { entrantType } : {}),
      },
      include: REGISTRATION_VIEW_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  /** 把管理员录入的报名适配成报名审核列表的一行，标注来源便于前端区分。 */
  private toAdminEntryReviewView(registration: RegistrationWithRelations) {
    const view = this.toRegistrationView(registration);
    return {
      id: view.id,
      competitionId: view.competitionId,
      userId: null,
      guest: false,
      email: '',
      entrantType: view.entrantType,
      entrantTypeLabel: view.entrantTypeLabel,
      studentId: view.studentId,
      college: view.college,
      majorGrade: view.majorGrade,
      name: view.primaryName,
      gender: view.gender,
      genderLabel: view.genderLabel,
      school: view.school,
      className: view.className,
      contact: view.phone,
      phone: view.phone,
      remark: view.remark,
      items: view.partner
        ? [
            {
              id: view.id,
              eventId: view.eventId,
              eventType: view.eventType,
              eventName: view.eventName,
              partnerName: view.partner.name,
              partnerGender: view.partner.gender,
              partnerGenderLabel: view.partner.genderLabel,
              partnerStudentId: view.partner.studentId || null,
              partnerSchool: view.partner.school || null,
              partnerCollege: view.partner.college || null,
              partnerMajorGrade: view.partner.majorGrade || null,
              partnerClassName: view.partner.className || null,
              partnerContact: view.partner.phone || null,
              teamName: view.teamName,
            },
          ]
        : [],
      eventNames: [view.eventName],
      eventSummary: view.eventName,
      status: view.status,
      statusRaw: view.statusRaw,
      statusLabel: view.statusLabel,
      createdAt: view.createdAt,
      reviewedAt: view.reviewedAt,
      reviewedBy: view.reviewedBy,
      rejectReason: view.rejectReason,
      // 该行由管理员直接录入，报名审核页不提供通过/驳回操作，去「参赛选手」页维护。
      source: 'ADMIN' as const,
    };
  }

  /** 统计管理员直接录入（未经审核队列）且已通过的报名记录。 */
  private countAdminApprovedEntries(competition: CompetitionWithRelations) {
    return competition.events.reduce(
      (total, event) =>
        total +
        event.registrations.filter(
          (item) =>
            item.competitionRegistrationId === null &&
            item.status === RegistrationStatus.APPROVED,
        ).length,
      0,
    );
  }

  async listAdminPlayers(
    competitionId: string,
    eventId?: string,
    entrantType?: string,
    search?: string,
  ) {
    await this.findCompetition(competitionId, true);
    const registrations = await this.findRegistrationsByCompetition(competitionId, {
      status: RegistrationStatus.APPROVED,
      eventId: eventId && eventId !== 'all' ? eventId : undefined,
      entrantType: entrantType && entrantType !== 'all'
        ? this.normalizeEntrantType(entrantType)
        : undefined,
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

    const rules = normalizeRegistrationFieldRules(competition.registrationFieldRules);
    const players = dto.players.map((item, index) =>
      this.normalizeAdminBatchPlayer(item, index + 1, event, rules),
    );
    const mixedGroup = players.find((player) => player.entrantType !== event.entrantType);
    if (mixedGroup) {
      throw new BadRequestException(
        `批量名单的报名组别（${entrantTypeLabel(mixedGroup.entrantType)}）与项目「${eventDisplayLabel(event)}」不一致`,
      );
    }
    this.ensureBatchStudentIds(players);
    await this.ensureNoExistingEventStudentIds(event.id, players);
    this.ensureBatchSocialContacts(players);
    await this.ensureNoExistingEventSocialContacts(event.id, players);

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
        entrantType: item.entrantType,
        studentId: item.studentId ?? null,
        college: item.college ?? null,
        majorGrade: item.majorGrade ?? null,
        className: item.className ?? null,
        phone: item.contact,
        gender: item.gender,
        eventName: eventDisplayLabel(event),
        partnerStudentId: secondaryPlayerId ? item.partnerStudentId ?? null : null,
        partnerSchool: secondaryPlayerId ? item.partnerSchool ?? null : null,
        partnerCollege: secondaryPlayerId ? item.partnerCollege ?? null : null,
        partnerMajorGrade: secondaryPlayerId ? item.partnerMajorGrade ?? null : null,
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

    return {
      createdCount: registrationRows.length,
      schoolCount: players.filter((player) => player.entrantType === EntrantType.SCHOOL).length,
      socialCount: players.filter((player) => player.entrantType === EntrantType.SOCIAL).length,
    };
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
    const rules = normalizeRegistrationFieldRules(competition.registrationFieldRules);
    const player = this.normalizeAdminBatchPlayer(dto, 1, event, rules);
    if (player.entrantType !== event.entrantType) {
      throw new BadRequestException('报名组别与项目组别不一致');
    }
    await this.ensureNoExistingEventStudentIds(event.id, [player]);
    await this.ensureNoExistingEventSocialContacts(event.id, [player]);

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
          entrantType: player.entrantType,
          studentId: player.studentId ?? null,
          college: player.college ?? null,
          majorGrade: player.majorGrade ?? null,
          className: player.className ?? null,
          phone: player.contact,
          gender: player.gender,
          eventName: eventDisplayLabel(event),
          partnerStudentId: secondaryId ? player.partnerStudentId ?? null : null,
          partnerSchool: secondaryId ? player.partnerSchool ?? null : null,
          partnerCollege: secondaryId ? player.partnerCollege ?? null : null,
          partnerMajorGrade: secondaryId ? player.partnerMajorGrade ?? null : null,
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

  async getRankings(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        events: {
          orderBy: { type: 'asc' },
          include: { registrations: {
            where: { status: RegistrationStatus.APPROVED },
            include: { player1: true, player2: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          } },
        },
        teamCompetitions: {
          orderBy: { createdAt: 'asc' },
          include: { teams: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
        },
      },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');
    return {
      id, title: tournament.name,
      groups: [
        ...tournament.events.map((event) => ({
          id: event.id, kind: 'event' as const, name: eventDisplayLabel(event),
          rankingLimit: event.rankingLimit,
          entries: event.registrations.map((registration) => ({
            id: registration.id,
            name: [registration.player1.name, registration.player2?.name].filter(Boolean).join(' / '),
            teamName: registration.teamName,
            affiliation: [registration.player1.affiliation, registration.player2?.affiliation].filter(Boolean).join(' / '),
            rank: registration.finalRank,
          })),
        })),
        ...tournament.teamCompetitions.map((competition) => ({
          id: competition.id, kind: 'team' as const, name: `${entrantTypeLabel(competition.entrantType)}团体赛 · ${competition.name}`,
          rankingLimit: competition.rankingLimit,
          entries: competition.teams.map((team) => ({
            id: team.id, name: team.name, teamName: null, affiliation: team.affiliation, rank: team.finalRank,
          })),
        })),
      ],
    };
  }

  async updateRankings(id: string, dto: UpdateCompetitionRankingsDto) {
    if (new Set(dto.entries.map((entry) => entry.id)).size !== dto.entries.length) {
      throw new BadRequestException('同一参赛方不能重复设置');
    }
    await this.prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUnique({ where: { id }, select: { id: true } });
      if (!tournament) throw new NotFoundException('赛事不存在');
      const group = dto.kind === 'event'
        ? await tx.event.findFirst({ where: { id: dto.groupId, tournamentId: id }, select: { id: true } })
        : await tx.teamCompetition.findFirst({ where: { id: dto.groupId, tournamentId: id }, select: { id: true } });
      if (!group) throw new BadRequestException('该项目不属于当前赛事');
      if (dto.rankingLimit !== undefined) {
        if (dto.kind === 'event') {
          await tx.event.update({ where: { id: group.id }, data: { rankingLimit: dto.rankingLimit } });
        } else {
          await tx.teamCompetition.update({ where: { id: group.id }, data: { rankingLimit: dto.rankingLimit } });
        }
      }
      for (const entry of dto.entries) {
        const result = dto.kind === 'event'
          ? await tx.registration.updateMany({
            where: { id: entry.id, eventId: dto.groupId, event: { tournamentId: id }, status: RegistrationStatus.APPROVED },
            data: { finalRank: entry.rank },
          })
          : await tx.team.updateMany({
            where: { id: entry.id, teamCompetitionId: dto.groupId, teamCompetition: { tournamentId: id } },
            data: { finalRank: entry.rank },
          });
        if (result.count !== 1) throw new BadRequestException('参赛方不属于该赛事项目，或报名状态已变更，请刷新后重试');
      }
    });
    return this.getRankings(id);
  }

  async createAdminPlayerFromLibrary(
    competitionId: string,
    dto: AdminCompetitionLibraryPlayerDto,
    reviewedById?: string,
  ) {
    const competition = await this.findCompetition(competitionId, true);
    const event = competition.events.find((item) => item.id === dto.eventId);
    if (!event) throw new BadRequestException('请选择当前赛事下的参赛项目');

    const playerIds = [dto.player1Id, dto.player2Id].filter(Boolean) as string[];
    if (new Set(playerIds).size !== playerIds.length) {
      throw new BadRequestException('同一报名中不能选择同一位选手');
    }

    const libraryPlayers = await this.prisma.player.findMany({
      where: { id: { in: playerIds }, isTemporary: false },
    });
    if (libraryPlayers.length !== playerIds.length) {
      throw new NotFoundException('选手库中存在无效选手，请刷新后重试');
    }
    const playerById = new Map(libraryPlayers.map((player) => [player.id, player]));
    const player1 = playerById.get(dto.player1Id)!;
    const player2 = dto.player2Id ? playerById.get(dto.player2Id) : undefined;
    const isDouble = this.isDoubleEvent(event.type);
    if (isDouble && !player2) throw new BadRequestException('双打项目需要选择两位选手');
    if (!isDouble && player2) throw new BadRequestException('单打项目只能选择一位选手');
    const teamName = dto.teamName?.trim();
    if (isDouble && !teamName) throw new BadRequestException('双打项目需要填写队伍名称');
    this.ensureRegistrationGender(event.type, player1.gender, player2?.gender);

    const existing = await this.prisma.registration.findFirst({
      where: {
        eventId: event.id,
        status: { not: RegistrationStatus.REMOVED },
        OR: [
          { player1Id: { in: playerIds } },
          { player2Id: { in: playerIds } },
        ],
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException('所选选手已报名当前项目');

    for (const playerId of playerIds) {
      const registrationCount = await this.prisma.registration.count({
        where: {
          status: RegistrationStatus.APPROVED,
          eventId: { not: event.id },
          event: { tournamentId: competitionId },
          OR: [{ player1Id: playerId }, { player2Id: playerId }],
        },
      });
      const maxEvents = competition.allowCrossEventRegistration
        ? competition.maxRegistrationEvents
        : 1;
      if (registrationCount >= maxEvents) {
        throw new ConflictException(`选手 ${playerById.get(playerId)?.name ?? ''} 最多报名 ${maxEvents} 个项目`);
      }
    }

    const created = await this.prisma.registration.create({
      data: {
        eventId: event.id,
        player1Id: player1.id,
        player2Id: player2?.id ?? null,
        name: player2 ? `${player1.name} / ${player2.name}` : player1.name,
        teamName: player2 ? teamName : null,
        entrantType: event.entrantType,
        phone: player1.contact,
        gender: player1.gender,
        eventName: eventDisplayLabel(event),
        partnerSchool: player2?.affiliation ?? null,
        partnerPhone: player2?.contact ?? null,
        status: RegistrationStatus.APPROVED,
        reviewedAt: new Date(),
        reviewedBy: reviewedById ?? null,
      },
      include: REGISTRATION_VIEW_INCLUDE,
    });

    return this.toRegistrationView(created);
  }

  /** 后台读取单条报名，用于编辑表单；otherEvents 是同一份报名表里的其他项目（改组别时会一起转）。 */
  async getAdminPlayer(competitionId: string, registrationId: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: REGISTRATION_VIEW_INCLUDE,
    });
    if (
      !registration ||
      registration.event.tournamentId !== competitionId ||
      registration.status !== RegistrationStatus.APPROVED
    ) {
      throw new NotFoundException('报名记录不存在');
    }
    const others = registration.competitionRegistrationId
      ? await this.prisma.registration.findMany({
          where: {
            competitionRegistrationId: registration.competitionRegistrationId,
            status: RegistrationStatus.APPROVED,
            id: { not: registration.id },
          },
          include: { event: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    return {
      ...this.toRegistrationView(registration),
      otherEvents: others.map((item) => ({
        id: item.id,
        eventId: item.eventId,
        eventType: item.event.type,
        entrantType: item.event.entrantType,
        label: eventDisplayLabel(item.event),
      })),
    };
  }

  /**
   * 后台修改单项报名，参赛选手页与缴费管理共用。
   * - 只改信息不影响签表，随时可改，但受赛事「报名信息修改截止时间」限制；
   * - 改项目或组别会动到签表：已冻结、已发布或已开赛的项目不能改，已抽签的项目改完需要重新抽签；
   * - 线上报名的一份报名表只属于一个组别，改组别时这个人报的所有项目一起转到另一组的同名项目；
   * - 同一份报名表里的其他项目同步本人信息（姓名、性别、学校、学号等），各项目显示保持一致。
   */
  async updateAdminPlayer(
    competitionId: string,
    registrationId: string,
    dto: AdminCompetitionPlayerDto,
    actor?: { id?: string; username?: string | null },
  ) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        event: true,
        player1: true,
        player2: true,
        competitionRegistration: {
          include: {
            eventItems: true,
            registrations: {
              where: { status: RegistrationStatus.APPROVED, id: { not: registrationId } },
              include: { event: true, player1: true, player2: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });
    if (!registration || registration.event.tournamentId !== competitionId) {
      throw new NotFoundException('报名记录不存在');
    }

    const competition = await this.findCompetition(competitionId, true);
    ensureRegistrationEditable(competition);
    const targetEvent = competition.events.find(
      (item) => item.id === (dto.eventId ?? registration.eventId),
    );
    if (!targetEvent) throw new BadRequestException('请选择当前赛事下的参赛项目');

    const rules = normalizeRegistrationFieldRules(competition.registrationFieldRules);
    const player = this.normalizeAdminBatchPlayer(dto, 1, targetEvent, rules);
    if (player.entrantType !== targetEvent.entrantType) {
      throw new BadRequestException('报名组别与项目组别不一致');
    }

    const application = registration.competitionRegistration;
    const siblings = application?.registrations ?? [];
    const groupChanging = registration.event.entrantType !== targetEvent.entrantType;
    const changingEvent = targetEvent.id !== registration.eventId;

    // 同一份报名表里的其他项目：改组别时转到另一组的同名项目，否则留在原项目。
    const siblingTargets = siblings.map((sibling) => {
      if (!groupChanging) return { sibling, target: sibling.event };
      const target = competition.events.find(
        (event) => event.entrantType === targetEvent.entrantType && event.type === sibling.event.type,
      );
      if (!target) {
        throw new BadRequestException(
          `${entrantTypeLabel(targetEvent.entrantType)}没有${EVENT_TYPE_LABELS[sibling.event.type]}项目，该选手报名的${eventDisplayLabel(sibling.event)}无法一起转组`,
        );
      }
      return { sibling, target };
    });
    const targetEventIds = [targetEvent.id, ...siblingTargets.map((item) => item.target.id)];
    if (new Set(targetEventIds).size !== targetEventIds.length) {
      throw new ConflictException(`该选手已报名${eventDisplayLabel(targetEvent)}，同一项目不能重复报名`);
    }
    // 本人性别改了的话，其他项目也要符合性别要求。
    for (const { sibling, target } of siblingTargets) {
      if (sibling.player1.gender === player.gender) continue;
      try {
        this.ensureRegistrationGender(target.type, player.gender, sibling.player2?.gender);
      } catch (error) {
        const reason = error instanceof Error ? error.message : '性别不符合项目要求';
        throw new BadRequestException(`该选手还报名了${eventDisplayLabel(target)}：${reason}`);
      }
    }

    await this.ensureNoExistingEventStudentIds(targetEvent.id, [player], registration.id);
    await this.ensureNoExistingEventSocialContacts(targetEvent.id, [player], registration.id);
    for (const { sibling, target } of siblingTargets) {
      const toSchool = target.entrantType === EntrantType.SCHOOL;
      const person: NormalizedAdminBatchPlayer = {
        ...player,
        social: !toSchool,
        entrantType: target.entrantType,
        partnerName: sibling.player2?.name,
        partnerContact: sibling.player2?.contact ?? sibling.partnerPhone ?? undefined,
        partnerStudentId: toSchool ? sibling.partnerStudentId ?? undefined : undefined,
      };
      await this.ensureNoExistingEventStudentIds(target.id, [person], sibling.id);
      await this.ensureNoExistingEventSocialContacts(target.id, [person], sibling.id);
    }

    const movedSiblings = siblingTargets.filter(({ sibling, target }) => sibling.eventId !== target.id);
    const changedEventIds = [
      ...(changingEvent ? [registration.eventId, targetEvent.id] : []),
      ...movedSiblings.flatMap(({ sibling, target }) => [sibling.eventId, target.id]),
    ];
    const isDouble = this.isDoubleEvent(targetEvent.type);
    const logAction = groupChanging ? 'GROUP_CHANGE' : 'EVENT_CHANGE';

    const { updated, redrawEvents } = await this.prisma.$transaction(async (tx) => {
      await lockEvents(tx, changedEventIds);
      const redraw = await checkEventsForEntrantChange(tx, changedEventIds, '调整报名项目或组别');

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
      const primaryName = secondaryId && player.partnerName ? `${player.name} / ${player.partnerName}` : player.name;

      await tx.registration.update({
        where: { id: registration.id },
        data: {
          eventId: targetEvent.id,
          player2Id: secondaryId,
          name: primaryName,
          teamName: secondaryId ? player.teamName ?? null : null,
          entrantType: player.entrantType,
          studentId: player.studentId ?? null,
          college: player.college ?? null,
          majorGrade: player.majorGrade ?? null,
          className: player.className ?? null,
          phone: player.contact,
          gender: player.gender,
          eventName: eventDisplayLabel(targetEvent),
          partnerStudentId: secondaryId ? player.partnerStudentId ?? null : null,
          partnerSchool: secondaryId ? player.partnerSchool ?? null : null,
          partnerCollege: secondaryId ? player.partnerCollege ?? null : null,
          partnerMajorGrade: secondaryId ? player.partnerMajorGrade ?? null : null,
          partnerClassName: secondaryId ? player.partnerClassName ?? null : null,
          partnerPhone: secondaryId ? player.partnerContact ?? null : null,
          reviewedAt: new Date(),
          reviewedBy: actor?.id ?? null,
        },
      });

      // 同一个人的其他项目：同步本人信息；改组别时转到另一组的同名项目。
      for (const { sibling, target } of siblingTargets) {
        const toSchool = target.entrantType === EntrantType.SCHOOL;
        await tx.player.update({
          where: { id: sibling.player1Id },
          data: {
            name: player.name,
            gender: player.gender,
            affiliation: player.school,
            contact: player.contact,
          },
        });
        await tx.registration.update({
          where: { id: sibling.id },
          data: {
            eventId: target.id,
            entrantType: target.entrantType,
            eventName: eventDisplayLabel(target),
            name: sibling.player2 ? `${player.name} / ${sibling.player2.name}` : player.name,
            studentId: player.studentId ?? null,
            college: player.college ?? null,
            majorGrade: player.majorGrade ?? null,
            className: player.className ?? null,
            phone: player.contact,
            gender: player.gender,
            // 社会组没有学号、学院和年级专业。
            ...(toSchool
              ? {}
              : { partnerStudentId: null, partnerCollege: null, partnerMajorGrade: null, partnerClassName: null }),
          },
        });
      }

      // 选手自助报名的记录，学校/学院班级在视图里优先取自报名主表，
      // 因此主表与对应项目要一并改掉，选手端「我的报名」才会显示新的组别和项目。
      if (application) {
        await tx.competitionRegistration.update({
          where: { id: application.id },
          data: {
            entrantType: player.entrantType,
            studentId: player.studentId ?? null,
            college: player.college ?? null,
            majorGrade: player.majorGrade ?? null,
            name: player.name,
            gender: player.gender,
            school: player.school,
            className: player.className ?? null,
            contact: player.contact,
          },
        });

        const currentEventIds = new Set([registration.eventId, ...siblings.map((item) => item.eventId)]);
        const claimed = new Set<string>();
        const findItem = (eventId: string) => {
          const item =
            application.eventItems.find((entry) => entry.eventId === eventId && !claimed.has(entry.id)) ??
            // 以前改项目时报名表里的项目没有跟着改：取一条不再对应任何报名的项目。
            application.eventItems.find((entry) => !currentEventIds.has(entry.eventId) && !claimed.has(entry.id));
          if (item) claimed.add(item.id);
          return item;
        };

        const partnerData = {
          partnerName: secondaryId ? player.partnerName ?? null : null,
          partnerGender: secondaryId ? player.partnerGender ?? null : null,
          partnerStudentId: secondaryId ? player.partnerStudentId ?? null : null,
          partnerSchool: secondaryId ? player.partnerSchool ?? null : null,
          partnerCollege: secondaryId ? player.partnerCollege ?? null : null,
          partnerMajorGrade: secondaryId ? player.partnerMajorGrade ?? null : null,
          partnerClassName: secondaryId ? player.partnerClassName ?? null : null,
          partnerContact: secondaryId ? player.partnerContact ?? null : null,
          teamName: secondaryId ? player.teamName ?? null : null,
        };
        const primaryItem = findItem(registration.eventId);
        if (primaryItem) {
          await tx.competitionRegistrationEventItem.update({
            where: { id: primaryItem.id },
            data: { eventId: targetEvent.id, ...partnerData },
          });
        } else {
          await tx.competitionRegistrationEventItem.create({
            data: { competitionRegistrationId: application.id, eventId: targetEvent.id, ...partnerData },
          });
        }
        for (const { sibling, target } of movedSiblings) {
          const item = findItem(sibling.eventId);
          if (!item) continue;
          const toSchool = target.entrantType === EntrantType.SCHOOL;
          await tx.competitionRegistrationEventItem.update({
            where: { id: item.id },
            data: {
              eventId: target.id,
              ...(toSchool
                ? {}
                : { partnerStudentId: null, partnerCollege: null, partnerMajorGrade: null, partnerClassName: null }),
            },
          });
        }
      }

      // 改项目或组别会影响应缴金额，记一笔变更，缴费状态和已缴金额保持不变。
      const moves = [
        ...(changingEvent
          ? [{ id: registration.id, name: primaryName, from: registration.event, to: targetEvent, paymentStatus: registration.paymentStatus, paidAmount: registration.paidAmount }]
          : []),
        ...movedSiblings.map(({ sibling, target }) => ({
          id: sibling.id,
          name: sibling.player2 ? `${player.name} / ${sibling.player2.name}` : player.name,
          from: sibling.event,
          to: target,
          paymentStatus: sibling.paymentStatus,
          paidAmount: sibling.paidAmount,
        })),
      ];
      for (const move of moves) {
        await tx.paymentLog.create({
          data: {
            tournamentId: competitionId,
            entrantType: move.to.entrantType,
            action: logAction,
            registrationId: move.id,
            targetName: move.name.slice(0, 191),
            itemName: eventDisplayLabel(move.to).slice(0, 120),
            fromStatus: move.paymentStatus,
            toStatus: move.paymentStatus,
            amount: move.paidAmount,
            note: `${eventDisplayLabel(move.from)} → ${eventDisplayLabel(move.to)}`.slice(0, 255),
            operatorId: actor?.id ?? null,
            operatorName: actor?.username ?? null,
          },
        });
      }

      await markEventsStale(tx, redraw);
      const row = await tx.registration.findUniqueOrThrow({
        where: { id: registration.id },
        include: REGISTRATION_VIEW_INCLUDE,
      });
      return { updated: row, redrawEvents: redraw };
    }, { timeout: 30_000, maxWait: 10_000 });

    // 一起转到学生组的双打项目只同步了本人信息，搭档缺的学号、学院要管理员再编辑该项目补填。
    const incompleteEvents = movedSiblings
      .filter(
        ({ sibling, target }) =>
          target.entrantType === EntrantType.SCHOOL &&
          sibling.player2Id &&
          ((rules.SCHOOL.studentId === 'required' && !sibling.partnerStudentId) ||
            (rules.SCHOOL.college === 'required' && !sibling.partnerCollege)),
      )
      .map(({ target }) => eventDisplayLabel(target));

    return {
      ...this.toRegistrationView(updated),
      redrawEvents,
      movedEvents: movedSiblings.map(({ target }) => eventDisplayLabel(target)),
      incompleteEvents,
    };
  }

  /** 参赛选手页「删除」单条报名：只删这一项，联动规则见 deleteAdminRegistrations。 */
  async removeAdminPlayerRegistration(
    competitionId: string,
    registrationId: string,
    actor?: ChangeActor,
  ) {
    return this.deleteAdminRegistrations(competitionId, [registrationId], actor);
  }

  /**
   * 后台删除单项报名（真删除，只删选中的项目）。参赛选手页与缴费管理共用。
   * - 报名表里对应的项目一并删除；删到最后一项时整份报名表删除（游客报名编号失效，选手可以重新报名）；
   * - 只为这条报名生成的选手档案一并删除，选手库里的正式选手保留；
   * - 种子设置、小组成员随外键级联删除，签位置空；已生成签表的项目标记为需要重新抽签；
   * - 签表已冻结、已发布或已有比赛开始的项目不能删，批量删除只要有一条不能删就整批不删；
   * - 缴费记录保留，另记一条「删除」，写明删除时的缴费状态和金额。
   */
  async deleteAdminRegistrations(
    competitionId: string,
    registrationIds: string[],
    actor: ChangeActor | undefined,
    note?: string,
  ) {
    requireAdminActor(actor, '删除报名');
    return this.prisma.$transaction(
      (tx) => this.deleteEventRegistrationsInTx(tx, competitionId, registrationIds, actor, note),
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  /** 在调用方的事务里删除单项报名；缴费管理批量删除时与删除队伍放在同一个事务。 */
  async deleteEventRegistrationsInTx(
    tx: Prisma.TransactionClient,
    competitionId: string,
    registrationIds: string[],
    actor: ChangeActor,
    note?: string,
  ): Promise<{ deleted: number; redrawEvents: RedrawEvent[] }> {
    const ids = [...new Set(registrationIds.filter(Boolean))];
    if (!ids.length) return { deleted: 0, redrawEvents: [] };
    const registrations = await tx.registration.findMany({
      where: { id: { in: ids } },
      include: { event: true, player1: { select: { name: true } }, player2: { select: { name: true } } },
    });
    if (
      registrations.length !== ids.length ||
      registrations.some((row) => row.event.tournamentId !== competitionId)
    ) {
      throw new NotFoundException('部分报名不存在或不属于该赛事，请刷新后重试');
    }

    const eventIds = registrations.map((row) => row.eventId);
    await lockEvents(tx, eventIds);
    const redrawEvents = await checkEventsForEntrantChange(tx, eventIds, '删除报名');

    const cleanNote = note?.trim().slice(0, 255) || null;
    for (const row of registrations) {
      await tx.paymentLog.create({
        data: {
          tournamentId: competitionId,
          entrantType: row.event.entrantType,
          action: 'DELETE',
          registrationId: row.id,
          targetName: registrationDisplayName(row).slice(0, 191),
          itemName: eventDisplayLabel(row.event).slice(0, 120),
          fromStatus: row.paymentStatus,
          toStatus: row.paymentStatus,
          amount: row.paidAmount,
          note: cleanNote,
          operatorId: actor.id,
          operatorName: actor.username ?? null,
        },
      });
    }

    await tx.registration.deleteMany({ where: { id: { in: ids } } });

    const applicationIds = [
      ...new Set(registrations.map((row) => row.competitionRegistrationId).filter((id): id is string => Boolean(id))),
    ];
    for (const applicationId of applicationIds) {
      await this.reconcileApplicationAfterDelete(
        tx,
        applicationId,
        registrations.filter((row) => row.competitionRegistrationId === applicationId).map((row) => row.eventId),
      );
    }

    await deleteOrphanPlayers(
      tx,
      registrations.filter((row) => row.competitionRegistrationId).flatMap((row) => [row.player1Id, row.player2Id]),
      { registrationOwned: true },
    );
    await deleteOrphanPlayers(
      tx,
      registrations.filter((row) => !row.competitionRegistrationId).flatMap((row) => [row.player1Id, row.player2Id]),
      { registrationOwned: false },
    );
    await markEventsStale(tx, redrawEvents);
    return { deleted: registrations.length, redrawEvents };
  }

  /**
   * 删除报名后整理报名表：删掉对应的项目；不再有已通过的报名时整份报名表删除。
   * 以前被移除、驳回留下的旧参赛记录不动，外键会把它们与报名表解除关联。
   */
  private async reconcileApplicationAfterDelete(
    tx: Prisma.TransactionClient,
    applicationId: string,
    deletedEventIds: string[],
  ) {
    const application = await tx.competitionRegistration.findUnique({
      where: { id: applicationId },
      include: {
        eventItems: true,
        registrations: { where: { status: RegistrationStatus.APPROVED }, select: { eventId: true } },
      },
    });
    if (!application) return;
    if (!application.registrations.length) {
      await tx.competitionRegistration.delete({ where: { id: application.id } });
      return;
    }
    const activeEventIds = new Set(application.registrations.map((row) => row.eventId));
    const claimed = new Set<string>();
    for (const eventId of deletedEventIds) {
      const item =
        application.eventItems.find((entry) => entry.eventId === eventId && !activeEventIds.has(entry.eventId) && !claimed.has(entry.id)) ??
        // 以前改项目时报名表里的项目没有跟着改：删一条不再对应任何报名的项目。
        application.eventItems.find((entry) => !activeEventIds.has(entry.eventId) && !claimed.has(entry.id));
      if (item) claimed.add(item.id);
    }
    if (claimed.size) {
      await tx.competitionRegistrationEventItem.deleteMany({ where: { id: { in: [...claimed] } } });
    }
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
    const redrawEvents = await this.prisma.$transaction(async (tx) => {
      // 已进入签表的报名：签表已冻结、已发布或已开赛时不能移除；已抽签的项目移除后需要重新抽签。
      const active = await tx.registration.findMany({
        where: { competitionRegistrationId: competitionRegistration.id, status: RegistrationStatus.APPROVED },
        select: { eventId: true },
      });
      const eventIds = active.map((row) => row.eventId);
      await lockEvents(tx, eventIds);
      const redraw = await checkEventsForEntrantChange(tx, eventIds, '移除报名');
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
      await markEventsStale(tx, redraw);
      return redraw;
    });

    const updated = await this.ensureCompetitionRegistration(competitionRegistration.id);
    return { ...this.toCompetitionRegistrationView(updated), redrawEvents };
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
    // 社会组游客没有账号，跳过邮件；不能因为 user 为空抛错。
    const to = registration.user?.email ?? registration.guestEmail ?? '';
    if (!to.trim()) return;
    void this.emailService.sendRegistrationNotification({
      templateKey,
      tournamentId: registration.competitionId,
      to,
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

  private normalizeEntrantType(value?: string | null): EntrantType {
    if (!value || value === 'SCHOOL') return EntrantType.SCHOOL;
    if (value === 'SOCIAL') return EntrantType.SOCIAL;
    throw new BadRequestException('报名组别填写有误');
  }

  private ensureRegistrationCode(
    competition: CompetitionWithRelations,
    code: string | undefined,
    entrantType: EntrantType,
  ) {
    // 未启用报名码的旧赛事保持可直接报名。
    if (!competition.registrationCodeEnabled) return;
    const enabled = entrantType === EntrantType.SCHOOL
      ? competition.schoolRegistrationCodeEnabled
      : competition.socialRegistrationCodeEnabled;
    if (!enabled) {
      throw new ForbiddenException(`${entrantTypeLabel(entrantType)}报名已关闭`);
    }
    const expected = registrationCodeFor(competition, entrantType);
    if (!expected) {
      throw new ForbiddenException(`${entrantTypeLabel(entrantType)}报名未开放`);
    }
    if (normalizeRegistrationCode(code) !== expected) {
      throw new ForbiddenException('报名码无效或已停用，请向组委会确认');
    }
  }

  private ensureChannelOpen(competition: CompetitionWithRelations, entrantType: EntrantType) {
    if (entrantType === EntrantType.SCHOOL && !competition.allowSchoolRegistration) {
      throw new ForbiddenException('本赛事未开放学生组报名');
    }
    if (entrantType === EntrantType.SOCIAL && !competition.allowSocialRegistration) {
      throw new ForbiddenException('本赛事未开放社会组报名');
    }
    if (!competition.events.some((event) => event.entrantType === entrantType)) {
      throw new BadRequestException(`本赛事未配置${entrantTypeLabel(entrantType)}项目`);
    }
  }

  private resolveGroupField(
    value: string | undefined,
    rules: RegistrationFieldRules,
    entrantType: EntrantType,
    field: string,
    label: string,
  ): string | null {
    const state = isFieldRequired(rules, entrantType, field)
      ? 'required'
      : this.fieldState(rules, entrantType, field);
    if (state === 'hidden') return null;
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
      if (state === 'required') throw new BadRequestException(`请填写${label}`);
      return null;
    }
    return trimmed;
  }

  private fieldState(
    rules: RegistrationFieldRules,
    entrantType: EntrantType,
    field: string,
  ): 'required' | 'optional' | 'hidden' {
    const group = rules[entrantType] as Record<string, 'required' | 'optional' | 'hidden'> | undefined;
    return group?.[field] ?? 'optional';
  }

  private registrationItemData(
    item: SubmitCompetitionRegistrationDto['items'][number],
    entrantType: EntrantType,
    fallback: { school: string; college: string | null; majorGrade: string | null; className: string | null },
  ) {
    const hasPartner = Boolean(item.partnerName?.trim() || item.partnerContact?.trim());
    return {
      eventId: item.eventId.trim(),
      partnerName: item.partnerName?.trim() || null,
      partnerGender: item.partnerGender ? this.normalizeGender(item.partnerGender) : null,
      partnerStudentId: hasPartner && entrantType === EntrantType.SCHOOL
        ? item.partnerStudentId?.trim() || null
        : null,
      partnerSchool: hasPartner ? item.partnerSchool?.trim() || fallback.school : null,
      partnerCollege: hasPartner && entrantType === EntrantType.SCHOOL
        ? item.partnerCollege?.trim() || fallback.college
        : null,
      partnerMajorGrade: hasPartner && entrantType === EntrantType.SCHOOL
        ? item.partnerMajorGrade?.trim() || fallback.majorGrade
        : null,
      partnerClassName: hasPartner && entrantType === EntrantType.SCHOOL
        ? item.partnerClassName?.trim() || fallback.className
        : null,
      partnerContact: hasPartner ? item.partnerContact?.trim() || null : null,
      teamName: item.teamName?.trim() || null,
    };
  }

  private async ensureNoDuplicateRegistration(
    competitionId: string,
    entrantType: EntrantType,
    person: { studentId: string | null; name: string; contact: string },
    excludeId?: string,
  ) {
    const name = person.name.trim();
    const contact = person.contact.trim();
    if (!name || !contact) return;
    const duplicate = await this.prisma.competitionRegistration.findFirst({
      where: {
        competitionId,
        // 被驳回的报名允许重新提交；游客没有账号可排除旧记录，只能在这里放行。
        status: { notIn: [RegistrationStatus.REMOVED, RegistrationStatus.REJECTED] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [
          ...(entrantType === EntrantType.SCHOOL && person.studentId
            ? [{ studentId: person.studentId }]
            : []),
          { name, contact },
        ],
      },
      select: { id: true, entrantType: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `该选手已在本赛事${entrantTypeLabel(duplicate.entrantType)}报名，不能重复报名`,
      );
    }
  }

  private findRegistrationsByCompetition(
    competitionId: string,
    filters: {
      status?: RegistrationStatus;
      eventId?: string;
      eventType?: EventType;
      entrantType?: EntrantType;
      search?: string;
    } = {},
  ) {
    const search = filters.search?.trim();
    return this.prisma.registration.findMany({
      where: {
        event: {
          tournamentId: competitionId,
          ...(filters.eventId ? { id: filters.eventId } : {}),
          ...(filters.eventType ? { type: filters.eventType } : {}),
        },
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.entrantType ? { entrantType: filters.entrantType } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { studentId: { contains: search } },
                { college: { contains: search } },
                { majorGrade: { contains: search } },
                { className: { contains: search } },
                { partnerStudentId: { contains: search } },
                { partnerCollege: { contains: search } },
                { partnerMajorGrade: { contains: search } },
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
          entrantType: registration.entrantType,
          studentId: registration.studentId,
          college: registration.college?.trim() || null,
          majorGrade: registration.majorGrade?.trim() || null,
          className: registration.className?.trim() || null,
          phone: registration.contact,
          gender: registration.gender,
          eventName: eventDisplayLabel(item.event),
          partnerStudentId: secondaryPlayerId ? item.partnerStudentId?.trim() || null : null,
          partnerSchool: secondaryPlayerId ? item.partnerSchool?.trim() || null : null,
          partnerCollege: secondaryPlayerId ? item.partnerCollege?.trim() || null : null,
          partnerMajorGrade: secondaryPlayerId ? item.partnerMajorGrade?.trim() || null : null,
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
    event: { type: EventType; entrantType: EntrantType },
    rules: RegistrationFieldRules,
  ): NormalizedAdminBatchPlayer {
    const entrantType = item.entrantType
      ? this.normalizeEntrantType(item.entrantType)
      : item.social
        ? EntrantType.SOCIAL
        : event.entrantType;
    const row = item.row ?? rowNumber;
    const name = this.requiredBatchField(item.name, row, '姓名');
    const gender = this.normalizeBatchGender(item.gender, row, '性别');
    const school = this.requiredBatchField(item.school, row, entrantType === EntrantType.SOCIAL ? '单位' : '学校');
    const contact = this.requiredBatchField(item.contact, row, '联系方式');
    const isSchool = entrantType === EntrantType.SCHOOL;
    const studentId = isSchool ? this.batchGroupField(item.studentId, rules, 'studentId', '学号', row) : undefined;
    const college = isSchool ? this.batchGroupField(item.college, rules, 'college', '学院', row) : undefined;
    const majorGrade = isSchool ? this.batchGroupField(item.majorGrade, rules, 'majorGrade', '年级专业', row) : undefined;
    const className = [college, majorGrade].filter(Boolean).join(' ')
      || item.className?.trim()
      || undefined;

    const base: NormalizedAdminBatchPlayer = {
      social: !isSchool,
      entrantType,
      name,
      gender,
      school,
      contact,
      studentId,
      college,
      majorGrade,
      className,
      row,
    };

    if (!this.isDoubleEvent(event.type)) {
      try {
        this.ensureRegistrationGender(event.type, gender);
      } catch (error) {
        const message = error instanceof Error ? error.message : '性别填写有误';
        throw new BadRequestException(`第 ${row} 行：${message}`);
      }
      return base;
    }

    const partnerName = this.requiredBatchField(item.partnerName, row, isSchool ? '搭档姓名' : '队友姓名');
    const partnerGender = this.normalizeBatchGender(item.partnerGender, row, isSchool ? '搭档性别' : '队友性别');
    const partnerContact = this.requiredBatchField(item.partnerContact, row, isSchool ? '搭档联系方式' : '队友联系方式');
    const partnerSchool = item.partnerSchool?.trim() || school;
    let partnerStudentId: string | undefined;
    let partnerCollege: string | undefined;
    let partnerMajorGrade: string | undefined;
    let partnerClassName: string | undefined;
    if (isSchool) {
      partnerStudentId = this.batchGroupField(item.partnerStudentId, rules, 'studentId', '搭档学号', row);
      partnerCollege = this.batchGroupField(
        item.partnerCollege?.trim() || college,
        rules,
        'college',
        '搭档学院',
        row,
      );
      partnerMajorGrade = this.batchGroupField(
        item.partnerMajorGrade?.trim() || majorGrade,
        rules,
        'majorGrade',
        '搭档年级专业',
        row,
      );
      partnerClassName = [partnerCollege, partnerMajorGrade].filter(Boolean).join(' ')
        || item.partnerClassName?.trim()
        || className;
    }

    try {
      this.ensureRegistrationGender(event.type, gender, partnerGender);
    } catch (error) {
      const message = error instanceof Error ? error.message : '双打性别填写有误';
      throw new BadRequestException(`第 ${row} 行：${message}`);
    }

    return {
      ...base,
      teamName: item.teamName?.trim() || undefined,
      partnerName,
      partnerGender,
      partnerSchool,
      partnerStudentId,
      partnerCollege,
      partnerMajorGrade,
      partnerClassName,
      partnerContact,
    };
  }

  private batchGroupField(
    value: string | undefined,
    rules: RegistrationFieldRules,
    field: string,
    label: string,
    row: number,
  ): string | undefined {
    const state = this.fieldState(rules, EntrantType.SCHOOL, field);
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
    if (state === 'required') {
      throw new BadRequestException(`第 ${row} 行缺少${label}`);
    }
    return undefined;
  }

  // 社会人员没有学号，同一项目内按「姓名 + 联系方式」判重。
  private socialPeople(player: NormalizedAdminBatchPlayer) {
    if (!player.social) return [];
    return [
      { name: player.name, contact: player.contact },
      ...(player.partnerName && player.partnerContact
        ? [{ name: player.partnerName, contact: player.partnerContact }]
        : []),
    ];
  }

  private ensureBatchSocialContacts(players: NormalizedAdminBatchPlayer[]) {
    const seen = new Map<string, number>();
    players.forEach((player, index) => {
      for (const person of this.socialPeople(player)) {
        const key = `${person.name}\u0000${person.contact}`;
        const existing = seen.get(key);
        if (existing) {
          throw new ConflictException(`第 ${index + 1} 行与第 ${existing} 行重复：${person.name}（${person.contact}）`);
        }
        seen.set(key, index + 1);
      }
    });
  }

  private async ensureNoExistingEventSocialContacts(
    eventId: string,
    players: NormalizedAdminBatchPlayer[],
    excludeRegistrationId?: string,
  ) {
    const people = players.flatMap((player) => this.socialPeople(player));
    if (!people.length) return;
    const existing = await this.prisma.registration.findFirst({
      where: {
        eventId,
        status: { not: RegistrationStatus.REMOVED },
        ...(excludeRegistrationId ? { id: { not: excludeRegistrationId } } : {}),
        OR: [
          { player1: { OR: people } },
          { player2: { OR: people } },
        ],
      },
      select: { player1: { select: { name: true, contact: true } }, player2: { select: { name: true, contact: true } } },
    });
    if (!existing) return;
    const hit = people.find((person) =>
      [existing.player1, existing.player2].some(
        (item) => item?.name === person.name && item?.contact === person.contact,
      ),
    );
    throw new ConflictException(`${hit?.name ?? '该选手'}（${hit?.contact ?? ''}）已在该项目报名`);
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
        ...(player.studentId ? [{ value: player.studentId, label: `${rowLabel}学号` }] : []),
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
    // 前台「已通过审核」名单里包含管理员录入/导入的选手，计数口径必须一致。
    const approvedCount =
      competition.competitionRegistrations.filter(
        (item) => item.status === RegistrationStatus.APPROVED,
      ).length + this.countAdminApprovedEntries(competition);
    const events = this.projectLabels(competition);
    const fieldRules = normalizeRegistrationFieldRules(competition.registrationFieldRules);

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
        entrantType: event.entrantType,
        groupLabel: event.groupLabel,
        label: eventDisplayLabel(event),
        isDouble: this.isDoubleEvent(event.type),
      })),
      description: competition.description ?? competition.rules,
      registrationNotice: competition.registrationNotice,
      maxRegistrationEvents: competition.maxRegistrationEvents,
      allowCrossEventRegistration: competition.allowCrossEventRegistration,
      needsRegistrationReview: competition.needsRegistrationReview,
      allowSchoolRegistration: competition.allowSchoolRegistration,
      allowSocialRegistration: competition.allowSocialRegistration,
      fieldRules,
      channels: [
        {
          entrantType: EntrantType.SCHOOL,
          label: entrantTypeLabel(EntrantType.SCHOOL),
          enabled: competition.allowSchoolRegistration
            && competition.events.some((event) => event.entrantType === EntrantType.SCHOOL),
          loginRequired: false,
        },
        {
          entrantType: EntrantType.SOCIAL,
          label: entrantTypeLabel(EntrantType.SOCIAL),
          enabled: competition.allowSocialRegistration
            && competition.events.some((event) => event.entrantType === EntrantType.SOCIAL),
          loginRequired: false,
        },
      ],
      status,
      rawStatus: competition.status,
      statusLabel: TOURNAMENT_STATUS_LABELS[status],
      registrationStatus: this.registrationStatusText(competition),
      registrationStartTime: competition.registrationStartDate?.toISOString() ?? null,
      registrationEndTime: competition.registrationEndDate?.toISOString() ?? null,
      registeredCount: approvedCount,
      // 后台用：过了这个时间不能再改报名信息和组别。
      registrationEditDeadline: detailed ? competition.registrationEditDeadline?.toISOString() ?? null : undefined,
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
      guest: !registration.userId,
      email: registration.user?.email ?? registration.guestEmail ?? '',
      entrantType: registration.entrantType,
      entrantTypeLabel: entrantTypeLabel(registration.entrantType),
      studentId: registration.studentId ?? '',
      college: registration.college ?? '',
      majorGrade: registration.majorGrade ?? '',
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
        eventName: eventDisplayLabel(item.event),
        partnerName: item.partnerName,
        partnerGender: item.partnerGender,
        partnerGenderLabel: item.partnerGender === Gender.MALE ? '男' : item.partnerGender === Gender.FEMALE ? '女' : null,
        partnerStudentId: item.partnerStudentId,
        partnerSchool: item.partnerSchool,
        partnerCollege: item.partnerCollege,
        partnerMajorGrade: item.partnerMajorGrade,
        partnerClassName: item.partnerClassName,
        partnerContact: item.partnerContact,
        teamName: item.teamName,
      })),
      eventNames: registration.eventItems.map((item) => eventDisplayLabel(item.event)),
      eventSummary: registration.eventItems.map((item) => eventDisplayLabel(item.event)).join(' / '),
      status: registration.status.toLowerCase(),
      statusRaw: registration.status,
      statusLabel: REGISTRATION_STATUS_LABELS[registration.status],
      createdAt: registration.createdAt.toISOString(),
      reviewedAt: registration.reviewedAt?.toISOString() ?? null,
      reviewedBy: registration.reviewedById,
      rejectReason: registration.rejectReason,
      // ONLINE：正常线上报名；ADMIN：管理员在参赛选手页直接录入/导入，无需审核。
      source: 'ONLINE' as const,
    };
  }

  private toRegistrationView(registration: RegistrationWithRelations) {
    const gender = registration.gender ?? registration.player1.gender;
    const entrantType =
      registration.entrantType ??
      registration.competitionRegistration?.entrantType ??
      EntrantType.SCHOOL;
    const school =
      registration.competitionRegistration?.school ??
      registration.player1.affiliation ??
      '';
    const college = registration.college ?? registration.competitionRegistration?.college ?? '';
    const majorGrade = registration.majorGrade ?? registration.competitionRegistration?.majorGrade ?? '';
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
          college: registration.partnerCollege ?? eventItem?.partnerCollege ?? '',
          majorGrade: registration.partnerMajorGrade ?? eventItem?.partnerMajorGrade ?? '',
          className: registration.partnerClassName ?? eventItem?.partnerClassName ?? '',
          phone: registration.partnerPhone ?? eventItem?.partnerContact ?? registration.player2.contact ?? '',
        }
      : null;
    return {
      id: registration.id,
      competitionRegistrationId: registration.competitionRegistrationId,
      competitionId: registration.event.tournamentId,
      eventId: registration.eventId,
      email: registration.competitionRegistration?.user?.email ?? registration.competitionRegistration?.guestEmail ?? '',
      entrantType,
      entrantTypeLabel: entrantTypeLabel(entrantType),
      name: registration.name ?? primaryName,
      // Always expose the primary player's individual name so doubles lists can
      // show each team member on their own row.
      primaryName,
      partner,
      teamName: registration.teamName ?? null,
      isTemporary: registration.player1.isTemporary || Boolean(registration.player2?.isTemporary),
      isSocial: entrantType === EntrantType.SOCIAL,
      studentId: registration.studentId ?? '',
      college,
      majorGrade,
      school,
      className,
      phone: registration.phone ?? registration.player1.contact ?? '',
      gender,
      genderLabel: gender === Gender.MALE ? '男' : '女',
      eventName: registration.eventName ?? eventDisplayLabel(registration.event),
      eventType: registration.event.type,
      eventGroupLabel: registration.event.groupLabel,
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
    const eventGroupMap = new Map<string, { eventId: string; label: string; players: typeof players }>();
    for (const player of players) {
      const item = eventGroupMap.get(player.eventId) ?? {
        eventId: player.eventId,
        label: player.eventName,
        players: [],
      };
      item.players.push(player);
      eventGroupMap.set(player.eventId, item);
    }
    return {
      players,
      // 新前端按 eventId 分组，学生组/社会组同项目不会混在一起。
      eventGroups: [...eventGroupMap.values()],
      // 旧字段保留一个版本，避免未更新的页面直接报错。
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
    events: Array<{ type: EventType; groupLabel: string | null }>;
  }) {
    // 分组赛事优先按 Event 展示，避免 projectText 里两组同名项目混在一起。
    if (competition.events.some((event) => event.groupLabel)) {
      return [...new Set(competition.events.map((event) => eventDisplayLabel(event)))].filter(Boolean);
    }
    const fromText = (competition.projectText ?? '')
      .split(/[\/、,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (fromText.length) return fromText;

    const labels = competition.events.map((event) => EVENT_TYPE_LABELS[event.type]);
    return [...new Set(labels)].filter(Boolean);
  }

  private registrationStatusText(competition: {
    status: TournamentStatus;
    registrationStartDate: Date | null;
    registrationEndDate: Date | null;
    startDate: Date;
    endDate: Date;
  }) {
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
    item: SubmitCompetitionRegistrationDto['items'][number],
    entrantType: EntrantType,
    rules: RegistrationFieldRules,
    fallback: { school: string; college: string | null; majorGrade: string | null; className: string | null },
  ) {
    if (!this.isDoubleEvent(eventType)) {
      return;
    }
    if (!item.partnerName?.trim() || !item.partnerGender || !item.partnerContact?.trim()) {
      throw new BadRequestException('双打项目必须填写搭档姓名、性别和联系方式');
    }
    if (entrantType !== EntrantType.SCHOOL) return;
    const partnerStudentId = item.partnerStudentId?.trim() ?? '';
    if (this.fieldState(rules, EntrantType.SCHOOL, 'studentId') === 'required' && !partnerStudentId) {
      throw new BadRequestException('本赛事要求学号，请填写搭档学号');
    }
    const college = item.partnerCollege?.trim() || fallback.college || '';
    if (this.fieldState(rules, EntrantType.SCHOOL, 'college') === 'required' && !college) {
      throw new BadRequestException('本赛事要求学院，请填写搭档学院');
    }
    const majorGrade = item.partnerMajorGrade?.trim() || fallback.majorGrade || '';
    if (this.fieldState(rules, EntrantType.SCHOOL, 'majorGrade') === 'required' && !majorGrade) {
      throw new BadRequestException('本赛事要求年级专业，请填写搭档年级专业');
    }
  }

  private resolvePartnerGender(eventType: EventType, primaryGender: Gender) {
    if (eventType === EventType.MENS_DOUBLES) return Gender.MALE;
    if (eventType === EventType.WOMENS_DOUBLES) return Gender.FEMALE;
    return primaryGender === Gender.MALE ? Gender.FEMALE : Gender.MALE;
  }
}
