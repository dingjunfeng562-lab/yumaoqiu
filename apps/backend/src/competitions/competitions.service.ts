import { maskContact } from '../common/mask-contact';
import { legacyGroupId } from '../registration-groups/registration-groups.service';
import { groupFields, normalizeAgeRule, ageRuleLabel, checkGender } from '../common/age-eligibility';
import { VerifyEligibilityDto } from '../registration-groups/registration-groups.dto';
import { preparePerson, itemEligibility, identityView, isPendingEligibility, type PreparedPerson } from '../common/registration-eligibility';
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
  TournamentApprovalStatus,
  TournamentStatus,
  TournamentGroup,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
import { normalizeContact, registrationDisplayName } from '../payments/payment-rules';

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
        group: true;
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
  gender: Gender | null;
  identityData?: ReturnType<typeof preparePerson>['identity'];
  partnerIdentityData?: ReturnType<typeof preparePerson>['identity'];
  eligibility?: ReturnType<typeof itemEligibility>;
  // 第三方没有学号和学院；学生组按赛事字段配置决定是否必填。
  studentId?: string;
  college?: string;
  majorGrade?: string;
  school: string;
  className?: string;
  contact: string;
  teamName?: string;
  partnerName?: string;
  partnerGender?: Gender | null;
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
            group: true,
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

  /**
   * 前台赛事主页被打开一次：浏览量 +1（每次打开都算，含刷新）。只统计前台能看到的赛事。
   * 用一条原生 UPDATE 自增：并发打开不会丢计数，也不会像 prisma.update 那样顺带改掉
   * updatedAt（那会让依赖赛事变动的逻辑，如报名表导出，每次浏览都被触发）。
   */
  async recordView(id: string) {
    const count = await this.prisma.$executeRaw`
      UPDATE \`Tournament\` SET \`viewCount\` = \`viewCount\` + 1
      WHERE \`id\` = ${id} AND \`isPublished\` = true AND \`isArchived\` = false AND \`approvalStatus\` = 'APPROVED'`;
    return { counted: count > 0 };
  }

  async getMyRegistration(competitionId: string, userId: string) {
    await this.findCompetition(competitionId, false);
    const registration = await this.prisma.competitionRegistration.findFirst({
      where: { competitionId, userId },
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
   * 公开报名码校验：一个赛事一个报名码，扫码后报名人自己选组别。
   * 已发出的旧码（组别报名码、学生组报名码）仍然有效，进入后预选对应组别。
   */
  async verifyRegistrationCode(code: string) {
    const normalized = normalizeRegistrationCode(code);
    if (!normalized) throw new NotFoundException('报名码无效或已停用');
    const visible = { registrationCodeEnabled: true, isPublished: true, approvalStatus: TournamentApprovalStatus.APPROVED, isArchived: false };
    const include = {
      events: { orderBy: [{ entrantType: 'asc' as const }, { type: 'asc' as const }] },
      registrationGroups: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
    };
    let preselectedGroupId: string | null = null;
    let tournament = await this.prisma.tournament.findFirst({ where: { ...visible, registrationCode: normalized }, include });
    if (!tournament) {
      const legacyGroup = await this.prisma.tournamentGroup.findUnique({ where: { registrationCode: normalized } });
      tournament = await this.prisma.tournament.findFirst({
        where: { ...visible, ...(legacyGroup ? { id: legacyGroup.tournamentId } : { schoolRegistrationCode: normalized }) },
        include,
      });
      if (tournament) preselectedGroupId = legacyGroup?.id ?? legacyGroupId(tournament.id, EntrantType.SCHOOL);
    }
    if (!tournament) {
      throw new NotFoundException('报名码无效或已停用，请向组委会确认');
    }
    const found = tournament;
    const groups = found.registrationGroups.filter((group) => group.enabled && found.events.some((event) => event.groupId === group.id));
    // 极少数旧赛事没有组别记录，仍走原来的学生报名表。
    const legacyEvents = found.events.filter((event) => !event.groupId && event.entrantType === EntrantType.SCHOOL);
    if (!groups.length && !(found.allowSchoolRegistration && legacyEvents.length)) {
      throw new ForbiddenException('本赛事暂未开放报名，请向组委会确认');
    }
    const payments = await this.prisma.tournamentPaymentSetting.findMany({
      where: { tournamentId: found.id },
      select: { groupId: true, enabled: true, singlesFee: true, doublesFee: true },
    });
    // 本组别收费标准（分）；未开启时为 null。免审核且收费时，提交后直接进入缴费页。
    const paymentFor = (groupId: string) => {
      const payment = payments.find((item) => item.groupId === groupId);
      return payment?.enabled ? { singlesFee: payment.singlesFee, doublesFee: payment.doublesFee } : null;
    };
    const eventView = (event: (typeof found.events)[number]) => ({
      id: event.id,
      type: event.type,
      label: eventDisplayLabel(event),
      isDouble: this.isDoubleEvent(event.type),
    });
    return {
      tournamentId: found.id,
      title: found.name,
      subtitle: found.subtitle,
      // 扫码报名先展示赛事简介，再选组别、填报名表。
      coverImageUrl: found.coverImageUrl,
      organizer: found.organizer,
      description: found.description ?? found.rules,
      registrationNotice: found.registrationNotice,
      maxRegistrationEvents: found.allowCrossEventRegistration ? found.maxRegistrationEvents : 1,
      needsRegistrationReview: found.needsRegistrationReview,
      registrationOpen: effectiveTournamentStatus(found) === TournamentStatus.REGISTRATION_OPEN,
      startDate: found.startDate.toISOString(),
      endDate: found.endDate.toISOString(),
      location: found.location,
      registrationStatus: this.registrationStatusText(found),
      registrationStartTime: found.registrationStartDate?.toISOString() ?? null,
      registrationEndTime: found.registrationEndDate?.toISOString() ?? null,
      groups: groups.map((group) => {
        const rule = normalizeAgeRule(group.ageRule);
        return {
          groupId: group.id,
          groupName: group.name,
          fieldTemplate: group.fieldTemplate === 'SCHOOL' ? 'SCHOOL' : 'GENERAL',
          groupFields: groupFields(group.fieldRules),
          ageRule: rule,
          ageRuleLabel: ageRuleLabel(rule),
          events: found.events.filter((event) => event.groupId === group.id).map(eventView),
          payment: paymentFor(group.id),
        };
      }),
      preselectedGroupId: groups.some((group) => group.id === preselectedGroupId) ? preselectedGroupId : null,
      // 以下字段只给没有组别记录的旧赛事（原学生报名表）使用。
      groupId: null,
      entrantType: EntrantType.SCHOOL,
      entrantTypeLabel: found.name,
      loginRequired: false,
      fieldRules: normalizeRegistrationFieldRules(found.registrationFieldRules),
      events: legacyEvents.map(eventView),
      payment: paymentFor(legacyGroupId(found.id, EntrantType.SCHOOL)),
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

  /** 重新生成赛事报名码（一个赛事一个码）：旧码和旧二维码立即失效，已提交的报名不受影响。 */
  async regenerateRegistrationCode(competitionId: string) {
    await this.findCompetition(competitionId, true);
    const code = await this.uniqueRegistrationCode();
    await this.prisma.tournament.update({
      where: { id: competitionId },
      data: { registrationCode: code, registrationCodeEnabled: true },
    });
    return { code };
  }

  /** 启停赛事报名码；停用后扫码和输入报名码都不能进入报名。 */
  async setRegistrationCodeEnabled(competitionId: string, enabled: boolean) {
    await this.findCompetition(competitionId, true);
    await this.prisma.tournament.update({
      where: { id: competitionId },
      data: { registrationCodeEnabled: enabled },
    });
    return { enabled };
  }

  private async uniqueRegistrationCode(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = generateRegistrationCode();
      const exists = await this.prisma.tournament.findFirst({
        where: { OR: [{ registrationCode: code }, { schoolRegistrationCode: code }] },
        select: { id: true },
      });
      const groupExists = this.prisma.tournamentGroup && await this.prisma.tournamentGroup.findUnique({ where: { registrationCode: code } });
      if (!exists && !groupExists) return code;
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
   * 游客报名：各组别都可使用，凭报名码提交，不要求登录。
   * userId 为空，靠 guestToken 查询结果；已登录用户仍走 submitRegistration 以绑定账号。
   */
  async publicRegister(competitionId: string, dto: PublicCompetitionRegistrationDto) {
    const competition = await this.findCompetition(competitionId, false);
    this.ensureRegistrationWindow(competition);
    return this.saveRegistration(competition, null, dto);
  }

  private async saveRegistration(
    competition: CompetitionWithRelations,
    userId: string | null,
    dto: SubmitCompetitionRegistrationDto,
  ) {
    const group = this.prisma.tournamentGroup ? await this.prisma.tournamentGroup.findFirst({ where: {
      tournamentId: competition.id, ...(dto.groupId ? { id: dto.groupId } : { legacyType: this.normalizeEntrantType(dto.entrantType) }),
    } }) : null;
    if (dto.groupId && !group) throw new BadRequestException('报名组别不存在');
    if (!group && this.normalizeEntrantType(dto.entrantType) === EntrantType.SOCIAL) {
      throw new BadRequestException('默认社会组已取消，请扫描组别报名码重新进入报名');
    }
    const entrantType = group ? (group.fieldTemplate === 'SCHOOL' ? EntrantType.SCHOOL : EntrantType.SOCIAL) : this.normalizeEntrantType(dto.entrantType);
    if (group) {
      // 一个赛事一个报名码；已发出的旧组别码、学生组码仍然有效。
      const submittedCode = normalizeRegistrationCode(dto.registrationCode);
      const codeValid = Boolean(submittedCode) && [competition.registrationCode, group.registrationCode, group.legacyType ? competition.schoolRegistrationCode : null].includes(submittedCode);
      if (!competition.registrationCodeEnabled || !codeValid) throw new ForbiddenException('报名码无效或已停用');
      if (!group.enabled) throw new ForbiddenException(`「${group.name}」报名未开放，请向组委会确认`);
    } else {
      this.ensureRegistrationCode(competition, dto.registrationCode, entrantType);
      this.ensureChannelOpen(competition, entrantType);
    }
    const fields = groupFields(group?.fieldRules, entrantType === 'SCHOOL', !group);
    const ageRule = normalizeAgeRule(group?.ageRule);
    const own = preparePerson(dto, fields, ageRule);
    // 年龄、衣服尺寸的「必填」只在线上报名时检查；后台录入和导入没有这两列，不拦。
    const requireExtras = (person: PreparedPerson, label = '') => {
      if (fields.age === 'required' && person.ageValue == null) throw new BadRequestException(`请填写${label}年龄，或填写身份证号自动计算`);
      if (fields.shirtSize === 'required' && !person.shirtSize) throw new BadRequestException(`请填写${label}衣服尺寸`);
    };
    requireExtras(own);
    if (fields.email === 'required' && !dto.guestEmail?.trim()) throw new BadRequestException('请填写邮箱');
    const rules: RegistrationFieldRules = group ? { SCHOOL: fields, SOCIAL: fields } : normalizeRegistrationFieldRules(competition.registrationFieldRules);

    const contact = dto.contact?.trim() ?? '';
    if (!contact) throw new BadRequestException('请填写联系方式');
    const school = dto.school?.trim() ?? '';
    if (!school) throw new BadRequestException(entrantType === EntrantType.SOCIAL ? '请填写单位/俱乐部' : '请填写学校');

    const studentId = group || entrantType === EntrantType.SCHOOL
      ? this.resolveGroupField(dto.studentId, rules, EntrantType.SCHOOL, 'studentId', '学号')
      : null;
    const college = group || entrantType === EntrantType.SCHOOL
      ? this.resolveGroupField(dto.college, rules, EntrantType.SCHOOL, 'college', '学院')
      : null;
    const majorGrade = group || entrantType === EntrantType.SCHOOL
      ? this.resolveGroupField(dto.majorGrade, rules, EntrantType.SCHOOL, 'majorGrade', '年级专业')
      : null;
    const className = [college, majorGrade].filter(Boolean).join(' ') || null;

    const submittedEventIds = [...new Set(dto.items.map((item) => item.eventId.trim()))];
    if (submittedEventIds.length !== dto.items.length) {
      throw new BadRequestException('报名项目不能重复');
    }

    const name = dto.name.trim();
    const personKey = createHash('sha256').update(`${name}\0${normalizeContact(contact)}`).digest('hex');
    const ownRegistration = userId ? await this.prisma.competitionRegistration.findFirst({
      where: { competitionId: competition.id, userId, name, contact },
      include: { user: true, eventItems: { include: { event: true } } },
    }) : null;
    // 扫码报名大多是游客，没有账号可认人：同一赛事里姓名和联系方式都相同的游客报名视为同一个人，
    // 再次提交时与登录用户一样走「追加项目」，否则兼项永远报不上第二项。
    const existing = ownRegistration ?? await this.findGuestRegistration(competition.id, name, contact);
    // 追加到游客报名时只新增项目，本人信息沿用第一次报名：不能凭姓名和手机号改掉别人的资料，
    // 也不绕过「报名信息修改截止时间」。
    const guestAppendTarget =
      existing && !existing.userId && existing.status === RegistrationStatus.APPROVED ? existing : null;

    if (existing?.status === RegistrationStatus.PENDING) {
      throw new ConflictException('你已提交报名，正在等待审核；审核通过后可再次提交，追加新的项目');
    }
    if (existing && (existing.entrantType !== entrantType || (group && existing.groupId && existing.groupId !== group.id))) {
      throw new ConflictException(
        `你已报名${entrantTypeLabel(existing.entrantType)}，不能重复报名${entrantTypeLabel(entrantType)}`,
      );
    }

    await this.ensureNoDuplicateRegistration(competition.id, entrantType, {
      studentId,
      name,
      contact,
    }, existing?.id);

    const existingApprovedItems = existing?.status === RegistrationStatus.APPROVED ? existing.eventItems : [];
    const existingApprovedEventIds = existingApprovedItems.map((item) => item.eventId);
    const eventIds = [...new Set([...existingApprovedEventIds, ...submittedEventIds])];
    const maxRegistrationEvents = competition.allowCrossEventRegistration ? competition.maxRegistrationEvents : 1;
    if (eventIds.length > maxRegistrationEvents) {
      if (!existingApprovedItems.length) {
        throw new BadRequestException(`最多选择 ${maxRegistrationEvents} 个报名项目`);
      }
      const remaining = maxRegistrationEvents - existingApprovedItems.length;
      throw new BadRequestException(
        `本赛事每人最多报名 ${maxRegistrationEvents} 个项目，你已报名${this.eventItemLabels(existingApprovedItems)}，` +
          (remaining > 0 ? `最多还能追加 ${remaining} 个` : '不能再追加'),
      );
    }

    const events = competition.events.filter((event) => eventIds.includes(event.id));
    if (events.length !== eventIds.length) {
      throw new BadRequestException('存在无效的报名项目');
    }
    if (events.some((event) => group ? event.groupId !== group.id : event.entrantType !== entrantType || (event.groupId && event.groupId !== legacyGroupId(competition.id, entrantType)))) {
      throw new BadRequestException('报名项目与报名组别不一致');
    }

    const gender = own.gender;
    if (guestAppendTarget && gender !== guestAppendTarget.gender) {
      throw new BadRequestException(
        `性别与第一次报名时不一致（第一次报名填写的是${guestAppendTarget.gender === Gender.MALE ? '男' : '女'}）`,
      );
    }
    // 搭档学校、学院等没填时取本人的；追加到游客报名时取第一次报名登记的。
    const fallback = guestAppendTarget
      ? {
          school: guestAppendTarget.school?.trim() || school,
          college: guestAppendTarget.college,
          majorGrade: guestAppendTarget.majorGrade,
          className: guestAppendTarget.className,
        }
      : { school, college, majorGrade, className };
    const qualifications = new Map<string, ReturnType<typeof itemEligibility>>();
    const partners = new Map<string, ReturnType<typeof preparePerson>>();
    for (const item of dto.items) {
      const event = events.find((current) => current.id === item.eventId.trim());
      if (!event) {
        throw new BadRequestException('存在无效的报名项目');
      }
      const partner = this.isDoubleEvent(event.type) ? preparePerson({ gender: item.partnerGender ?? null, identityNumber: item.partnerIdentityNumber, age: item.partnerAge, shirtSize: item.partnerShirtSize }, fields, ageRule, '搭档') : null;
      if (partner) {
        if (!item.partnerName?.trim() || !item.partnerContact?.trim()) throw new BadRequestException('请填写搭档姓名和联系方式');
        requireExtras(partner, '搭档');
        partners.set(item.eventId.trim(), partner);
        item.partnerGender = partner.gender ?? undefined;
      }
      qualifications.set(item.eventId.trim(), itemEligibility(event.type, own, partner, ageRule, group?.ruleVersion ?? 1));
      if (group && partner) {
        item.partnerStudentId = this.resolveGroupField(item.partnerStudentId, rules, entrantType, 'studentId', '搭档学号') ?? undefined;
        item.partnerCollege = this.resolveGroupField(item.partnerCollege, rules, entrantType, 'college', '搭档学院') ?? undefined;
        item.partnerMajorGrade = this.resolveGroupField(item.partnerMajorGrade, rules, entrantType, 'majorGrade', '搭档年级专业') ?? undefined;
      }
      this.ensurePartnerFields(event.type, item, entrantType, rules, fallback);
    }

    const newItems = dto.items.filter((item) => !existingApprovedEventIds.includes(item.eventId.trim()));
    if (existingApprovedItems.length && !newItems.length) {
      throw new ConflictException(`你已报名${this.eventItemLabels(existingApprovedItems)}，请选择新的报名项目`);
    }

    const qualificationPending = [...qualifications.values()].some(q => q.status === 'PENDING');
    const itemData = (item: SubmitCompetitionRegistrationDto['items'][number]) => ({
      ...this.registrationItemData(item, entrantType, fallback, Boolean(group)),
      partnerIdentityData: partners.get(item.eventId.trim())?.identity ?? Prisma.DbNull,
      partnerAge: partners.get(item.eventId.trim())?.ageValue ?? null,
      partnerShirtSize: partners.get(item.eventId.trim())?.shirtSize ?? null,
      eligibility: qualifications.get(item.eventId.trim()),
    });
    const nextStatus = competition.needsRegistrationReview || qualificationPending
      ? RegistrationStatus.PENDING
      : RegistrationStatus.APPROVED;
    const baseData = {
      groupId: group?.id ?? null,
      personKey,
      identityData: own.identity ?? Prisma.DbNull,
      eligibility: { status: qualificationPending ? 'PENDING' : 'PASSED', ruleVersion: group?.ruleVersion ?? 1 },
      entrantType,
      studentId,
      college,
      majorGrade,
      name,
      gender,
      school,
      className,
      contact,
      age: own.ageValue,
      shirtSize: own.shirtSize,
      remark: dto.remark?.trim() || null,
      guestEmail: fields.email === 'hidden' ? null : dto.guestEmail?.trim() || null,
    };

    const registration = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Tournament WHERE id = ${competition.id} FOR UPDATE`;
      const concurrent = await tx.competitionRegistration.findFirst({ where: { competitionId: competition.id, personKey, ...(existing ? { id: { not: existing.id } } : {}) } });
      if (concurrent) throw new ConflictException('该选手已提交报名，请勿重复提交');
      await this.ensureIdentityNotCrossGroup(tx, competition.id, group?.id ?? null, [own.identity, ...[...partners.values()].map(p => p.identity)].filter(Boolean).map(p => p!.fingerprint), existing?.id, submittedEventIds);
      if (existing) {
        if (existing.status === RegistrationStatus.APPROVED) {
          const updated = await tx.competitionRegistration.update({
            where: { id: existing.id },
            data: {
              ...(guestAppendTarget ? {} : baseData),
              status: qualificationPending ? RegistrationStatus.PENDING : RegistrationStatus.APPROVED,
              eligibility: { status: qualificationPending ? 'PENDING' : 'PASSED' },
              rejectReason: null,
              eventItems: {
                create: newItems.map((item) => itemData(item)),
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
          if (!qualificationPending) await this.createApprovedRegistrationRecords(
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
              create: dto.items.map((item) => itemData(item)),
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
            create: dto.items.map((item) => itemData(item)),
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
    }).catch((error: unknown) => {
      // 连点两次「追加」时，后一次会撞上同一份报名里项目不能重复的唯一约束。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该项目已报名，请勿重复提交');
      }
      throw error;
    });

    if (registration.status === RegistrationStatus.APPROVED) {
      // 免审核赛事提交即通过，按"审核通过"通知
      this.notifyRegistrationEmail(registration, 'registration_approved');
    } else if (registration.status === RegistrationStatus.PENDING) {
      this.notifyRegistrationEmail(registration, 'registration_submitted');
    }

    const appended = existing?.status === RegistrationStatus.APPROVED;
    return {
      message: appended
        ? '已追加报名项目。'
        : nextStatus === RegistrationStatus.PENDING ? '报名已提交，请等待管理员审核。' : '报名已提交并自动通过。',
      appended,
      registration: this.toCompetitionRegistrationView(registration),
      // 游客凭报名编号查询和缴费；追加到游客报名时仍是第一次报名的编号。
      guestToken: registration.guestToken ?? null,
    };
  }

  /**
   * 游客没有账号，靠「同一赛事 + 姓名 + 联系方式」认出同一个人。只对上学号不算，
   * 免得凭别人的学号就能往别人的报名里加项目。联系方式按缴费查询的规则去掉空格、横线再比。
   */
  private async ensureIdentityNotCrossGroup(tx: Prisma.TransactionClient, tournamentId: string, groupId: string | null, fingerprints: string[], excludeId?: string, eventIds: string[] = [], excludeRegistrationIds: string[] = []) {
    for (const fingerprint of new Set(fingerprints)) {
      const applications = await tx.competitionRegistration.findMany({ where: { competitionId: tournamentId,
        status: { notIn: ['REMOVED', 'REJECTED'] }, ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [{ identityData: { path: '$.fingerprint', equals: fingerprint } }, { eventItems: { some: { partnerIdentityData: { path: '$.fingerprint', equals: fingerprint } } } }],
      }, select: { groupId: true, eventItems: { select: { eventId: true } } } });
      if (applications.some(row => row.eventItems.some(item => eventIds.includes(item.eventId)))) throw new ConflictException('该证件对应选手已报名相同项目');
      if (applications.some(row => row.groupId !== groupId)) throw new ConflictException('该证件对应选手已在其他组别报名');
      const entries = await tx.registration.findMany({ where: { event: { tournamentId }, status: 'APPROVED',
        ...(excludeRegistrationIds.length ? { id: { notIn: excludeRegistrationIds } } : {}),
        OR: [{ identityData: { path: '$.fingerprint', equals: fingerprint } }, { partnerIdentityData: { path: '$.fingerprint', equals: fingerprint } }],
      }, include: { event: true } });
      if (entries.some(row => row.competitionRegistrationId !== excludeId && eventIds.includes(row.eventId))) throw new ConflictException('该证件对应选手已报名相同项目');
      if (entries.some(row => row.competitionRegistrationId !== excludeId && row.event.groupId !== groupId)) throw new ConflictException('该证件对应选手已在其他组别参赛');
      const teams = await tx.teamMember.findMany({ where: { identityData: { path: '$.fingerprint', equals: fingerprint }, team: { teamCompetition: { tournamentId } } }, include: { team: { include: { teamCompetition: true } } } });
      if (teams.some(row => row.team.teamCompetition.groupId !== groupId)) throw new ConflictException('该证件对应选手已在其他组别团体赛报名');
    }
  }

  private async findGuestRegistration(competitionId: string, name: string, contact: string) {
    const target = normalizeContact(contact);
    if (!name || !target) return null;
    const candidates = await this.prisma.competitionRegistration.findMany({
      where: {
        competitionId,
        userId: null,
        name,
        status: { in: [RegistrationStatus.APPROVED, RegistrationStatus.PENDING] },
      },
      include: {
        user: true,
        eventItems: {
          include: {
            event: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const matches = candidates.filter((item) => normalizeContact(item.contact) === target);
    return matches.find((item) => item.status === RegistrationStatus.APPROVED) ?? matches[0] ?? null;
  }

  private eventItemLabels(items: Array<{ event: { type: EventType; groupLabel?: string | null } }>) {
    return items.map((item) => eventDisplayLabel(item.event)).join('、');
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
            group: true,
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
        registrationCode: competition.registrationCode,
        schoolRegistrationCode: competition.schoolRegistrationCode,
        schoolRegistrationCodeEnabled: competition.schoolRegistrationCodeEnabled,
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
          include: { registrations: true, group: true },
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
          include: { registrations: true, group: true },
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
    const existing = await this.prisma.tournament.findUnique({
      where: { id },
      select: { name: true, photoAccessToken: true, approvalStatus: true },
    });
    if (!existing) {
      throw new NotFoundException('赛事不存在');
    }
    // 存量兼容：已经发出过图片二维码的赛事始终可以再次查看；审核门槛只拦第一次生成。
    if (existing.photoAccessToken) {
      return {
        competitionId: id,
        title: existing.name,
        accessToken: existing.photoAccessToken,
        path: `/tupiannicai/${existing.photoAccessToken}`,
      };
    }
    if (existing.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('赛事审核通过后才能生成图片二维码');
    }
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
    const group = event.groupId ? await this.prisma.tournamentGroup.findUnique({ where: { id: event.groupId } }) : null;
    const players = dto.players.map((item, index) =>
      this.normalizeAdminBatchPlayer(item, index + 1, event, rules, group),
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

    if (group) {
      const rows = await this.createAdminGroupEntries(competition, event, group, players, reviewedById);
      return { createdCount: rows.length, pendingCount: rows.filter(row => row.status === 'PENDING').length,
        schoolCount: players.filter(p => p.entrantType === 'SCHOOL').length, socialCount: players.filter(p => p.entrantType === 'SOCIAL').length };
    }

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
      if (this.isDoubleEvent(event.type) && item.partnerName) {
        secondaryPlayerId = randomUUID();
        playerRows.push({
          id: secondaryPlayerId,
          name: item.partnerName,
          gender: item.partnerGender ?? null,
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
    const group = event.groupId ? await this.prisma.tournamentGroup.findUnique({ where: { id: event.groupId } }) : null;
    const player = this.normalizeAdminBatchPlayer(dto, 1, event, rules, group);
    if (player.entrantType !== event.entrantType) {
      throw new BadRequestException('报名组别与项目组别不一致');
    }
    await this.ensureNoExistingEventStudentIds(event.id, [player]);
    await this.ensureNoExistingEventSocialContacts(event.id, [player]);

    if (group) {
      const rows = await this.createAdminGroupEntries(competition, event, group, [player], reviewedById);
      return this.toCompetitionRegistrationView(rows[0]);
    }
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
      if (isDouble && player.partnerName) {
        const secondary = await tx.player.create({
          data: {
            name: player.partnerName,
            gender: player.partnerGender ?? null,
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
    if (event.groupId) {
      return this.createAdminPlayer(competitionId, {
        eventId: event.id, entrantType: event.entrantType,
        name: player1.name, gender: player1.gender ?? undefined, school: player1.affiliation, contact: player1.contact ?? '',
        partnerName: player2?.name, partnerGender: player2?.gender ?? undefined,
        partnerSchool: player2?.affiliation, partnerContact: player2?.contact ?? undefined, teamName: teamName ?? undefined,
      }, reviewedById);
    }
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
      groupId: registration.event.groupId,
      identity: identityView(registration.identityData),
      partnerIdentity: identityView(registration.partnerIdentityData),
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
    const group = targetEvent.groupId ? await this.prisma.tournamentGroup.findUnique({ where: { id: targetEvent.groupId } }) : null;
    // 未提交证件字段表示保留旧资料（沿用库里存的哈希和出生日期）；显式空字符串表示清空，重新进入资格核验。
    const editDto = { ...dto };
    const player = this.normalizeAdminBatchPlayer(editDto, 1, targetEvent, rules, group, {
      own: registration.identityData,
      partner: registration.partnerIdentityData,
    });
    if (player.entrantType !== targetEvent.entrantType) {
      throw new BadRequestException('报名组别与项目组别不一致');
    }

    const application = registration.competitionRegistration;
    const siblings = application?.registrations ?? [];
    const groupChanging = (registration.event.groupId ?? registration.event.entrantType) !== (targetEvent.groupId ?? targetEvent.entrantType);
    const changingEvent = targetEvent.id !== registration.eventId;
    const keepManual = (original: typeof registration, next: NormalizedAdminBatchPlayer, eventUnchanged: boolean) => {
      const snapshot = original.eligibility;
      if (!groupChanging && eventUnchanged && snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && snapshot.status === 'MANUAL'
        && next.name === original.player1.name && next.gender === original.player1.gender
        && (next.partnerName ?? '') === (original.player2?.name ?? '') && (next.partnerGender ?? null) === (original.player2?.gender ?? null)
        && dto.identityNumber === undefined && dto.partnerIdentityNumber === undefined) {
        next.eligibility = snapshot as unknown as ReturnType<typeof itemEligibility>;
      }
    };
    keepManual(registration, player, !changingEvent);

    // 同一份报名表里的其他项目：改组别时转到另一组的同名项目，否则留在原项目。
    const siblingTargets = siblings.map((sibling) => {
      if (!groupChanging) return { sibling, target: sibling.event };
      const target = competition.events.find(
        (event) => (event.groupId ?? event.entrantType) === (targetEvent.groupId ?? targetEvent.entrantType) && event.type === sibling.event.type,
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
        checkGender(target.type, player.gender, sibling.player2?.gender ?? null);
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

    const siblingQualifications = new Map<string, NormalizedAdminBatchPlayer>();
    for (const { sibling, target } of siblingTargets) {
      const normalized = this.normalizeAdminBatchPlayer({ ...editDto, entrantType: target.entrantType,
        partnerName: sibling.player2?.name, partnerGender: sibling.player2?.gender ?? undefined,
        partnerContact: sibling.player2?.contact ?? sibling.partnerPhone ?? undefined,
        // 搭档证件沿用该项目自己存的信息，不用本次编辑提交的搭档证件。
        partnerIdentityNumber: undefined,
        partnerStudentId: sibling.partnerStudentId ?? undefined, partnerCollege: sibling.partnerCollege ?? undefined,
        partnerMajorGrade: sibling.partnerMajorGrade ?? undefined, partnerSchool: sibling.partnerSchool ?? undefined,
      }, 1, target, rules, group, { own: registration.identityData, partner: sibling.partnerIdentityData });
      keepManual({ ...registration, ...sibling }, normalized, target.id === sibling.eventId);
      siblingQualifications.set(sibling.id, normalized);
    }
    const qualificationPending = player.eligibility?.status === 'PENDING' || [...siblingQualifications.values()].some(p => p.eligibility?.status === 'PENDING');
    if (qualificationPending && !application) throw new BadRequestException('历史手工报名转入本组时，请补充符合规则的证件和性别；也可通过本组报名入口重新提交并人工核验');
    const movedSiblings = siblingTargets.filter(({ sibling, target }) => sibling.eventId !== target.id);
    const changedEventIds = [
      ...(qualificationPending ? [registration.eventId, ...siblings.map(s => s.eventId)] : []),
      ...(changingEvent ? [registration.eventId, targetEvent.id] : []),
      ...movedSiblings.flatMap(({ sibling, target }) => [sibling.eventId, target.id]),
    ];
    const isDouble = this.isDoubleEvent(targetEvent.type);
    const logAction = groupChanging ? 'GROUP_CHANGE' : 'EVENT_CHANGE';

    const { updated, redrawEvents } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Tournament WHERE id = ${competitionId} FOR UPDATE`;
      await this.ensureIdentityNotCrossGroup(tx, competitionId, targetEvent.groupId, [player.identityData?.fingerprint, player.partnerIdentityData?.fingerprint, ...[...siblingQualifications.values()].map(p => p.partnerIdentityData?.fingerprint)].filter(Boolean) as string[], application?.id, targetEventIds, [registration.id, ...siblings.map(s => s.id)]);
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
      if (isDouble && player.partnerName) {
        if (registration.player2Id) {
          await tx.player.update({
            where: { id: registration.player2Id },
            data: {
              name: player.partnerName,
              gender: player.partnerGender ?? null,
              affiliation: player.partnerSchool ?? player.school,
              contact: player.partnerContact ?? null,
            },
          });
          secondaryId = registration.player2Id;
        } else {
          const secondary = await tx.player.create({
            data: {
              name: player.partnerName,
              gender: player.partnerGender ?? null,
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
          identityData: player.identityData ?? Prisma.DbNull,
          partnerIdentityData: player.partnerIdentityData ?? Prisma.DbNull,
          eligibility: player.eligibility,
          status: player.eligibility?.status === 'PENDING' ? RegistrationStatus.PENDING : RegistrationStatus.APPROVED,
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
            identityData: player.identityData ?? Prisma.DbNull,
            partnerIdentityData: siblingQualifications.get(sibling.id)?.partnerIdentityData ?? Prisma.DbNull,
            eligibility: siblingQualifications.get(sibling.id)?.eligibility,
            status: siblingQualifications.get(sibling.id)?.eligibility?.status === 'PENDING' ? RegistrationStatus.PENDING : RegistrationStatus.APPROVED,
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
            // 第三方没有学号、学院和年级专业。
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
            groupId: targetEvent.groupId,
            personKey: createHash('sha256').update(`${player.name}\0${normalizeContact(player.contact)}`).digest('hex'),
            identityData: player.identityData ?? Prisma.DbNull,
            eligibility: { status: qualificationPending ? 'PENDING' : 'PASSED' },
            status: qualificationPending ? RegistrationStatus.PENDING : RegistrationStatus.APPROVED,
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
          partnerIdentityData: player.partnerIdentityData ?? Prisma.DbNull,
          eligibility: player.eligibility,
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
        for (const { sibling, target } of siblingTargets) {
          const item = findItem(sibling.eventId);
          if (!item) continue;
          const toSchool = target.entrantType === EntrantType.SCHOOL;
          await tx.competitionRegistrationEventItem.update({
            where: { id: item.id },
            data: {
              eventId: target.id,
              partnerIdentityData: siblingQualifications.get(sibling.id)?.partnerIdentityData ?? Prisma.DbNull,
              eligibility: siblingQualifications.get(sibling.id)?.eligibility,
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

  async verifyEligibility(id: string, dto: VerifyEligibilityDto, operatorId: string) {
    if (!dto.note.trim()) throw new BadRequestException('请填写线下核验依据');
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM CompetitionRegistration WHERE id = ${id} FOR UPDATE`;
      const application = await tx.competitionRegistration.findUnique({ where: { id }, include: { user: true, eventItems: { include: { event: true } } } });
      if (!application) throw new NotFoundException('报名不存在');
      if (application.status !== RegistrationStatus.PENDING) throw new BadRequestException('仅待审核报名可进行资格核验');
      const gender = dto.gender ?? application.gender;
      for (const item of application.eventItems) {
        const partnerGender = dto.partnerGenders?.[item.id] ?? item.partnerGender;
        if (checkGender(item.event.type, gender, partnerGender) === 'PENDING') throw new BadRequestException('请确认本人及双打搭档的性别');
        const previous = item.eligibility && typeof item.eligibility === 'object' && !Array.isArray(item.eligibility) ? item.eligibility : {};
        await tx.competitionRegistrationEventItem.update({ where: { id: item.id }, data: {
          partnerGender,
          eligibility: { ...previous, status: 'MANUAL', gender: 'MANUAL',
            age: previous.age === 'PENDING' ? 'MANUAL' : previous.age ?? 'NOT_REQUIRED',
            partnerAge: previous.partnerAge === 'PENDING' ? 'MANUAL' : previous.partnerAge ?? 'NOT_REQUIRED',
            verifiedBy: operatorId, verifiedAt: new Date().toISOString(), note: dto.note.trim() },
        } });
      }
      return tx.competitionRegistration.update({ where: { id }, data: { gender, eligibility: { status: 'MANUAL', verifiedBy: operatorId, verifiedAt: new Date().toISOString() } },
        include: { user: true, eventItems: { include: { event: true } } } });
    });
    return this.toCompetitionRegistrationView(result);
  }

  async approveRegistration(competitionRegistrationId: string, reviewedById?: string) {
    const competitionRegistration = await this.ensureCompetitionRegistration(competitionRegistrationId);
    if (competitionRegistration.eventItems.some(item => isPendingEligibility(item.eligibility))) throw new BadRequestException('存在待核验的年龄或性别，请先完成资格核验');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM CompetitionRegistration WHERE id = ${competitionRegistration.id} FOR UPDATE`;
      const latest = await tx.competitionRegistration.findUniqueOrThrow({ where: { id: competitionRegistration.id }, include: { eventItems: true } });
      if (latest.eventItems.some(item => isPendingEligibility(item.eligibility))) throw new BadRequestException('请先完成资格核验');
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

      for (const entry of existingRegularRegistrations) {
        const item = registration.eventItems.find(item => item.eventId === entry.eventId);
        if (!item) continue;
        await tx.player.update({ where: { id: entry.player1Id }, data: { gender: registration.gender } });
        if (entry.player2Id) await tx.player.update({ where: { id: entry.player2Id }, data: { gender: item.partnerGender } });
        await tx.registration.update({ where: { id: entry.id }, data: { gender: registration.gender,
          identityData: registration.identityData ?? Prisma.DbNull, partnerIdentityData: item.partnerIdentityData ?? Prisma.DbNull,
          eligibility: item.eligibility ?? Prisma.DbNull } });
      }
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
      }
      const missingEventIds = registration.eventItems.filter(item => !existingRegularRegistrations.some(r => r.eventId === item.eventId)).map(item => item.eventId);
      if (missingEventIds.length) await this.createApprovedRegistrationRecords(tx, registration, reviewedById ?? null, missingEventIds);

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
          personKey: null,
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
          personKey: null,
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
    // 第三方游客没有账号，跳过邮件；不能因为 user 为空抛错。
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
            group: true,
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
    const enabled = entrantType === EntrantType.SCHOOL && competition.schoolRegistrationCodeEnabled;
    if (!enabled) {
      throw new ForbiddenException(`${entrantTypeLabel(entrantType)}报名已关闭`);
    }
    const expected = registrationCodeFor(competition, entrantType);
    if (!expected && !competition.registrationCode) {
      throw new ForbiddenException(`${entrantTypeLabel(entrantType)}报名未开放`);
    }
    // 赛事报名码和旧的学生组报名码都认。
    if (![expected, competition.registrationCode].includes(normalizeRegistrationCode(code))) {
      throw new ForbiddenException('报名码无效或已停用，请向组委会确认');
    }
  }

  private ensureChannelOpen(competition: CompetitionWithRelations, entrantType: EntrantType) {
    if (entrantType === EntrantType.SCHOOL && !competition.allowSchoolRegistration) {
      throw new ForbiddenException('本赛事未开放学生组报名');
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
    customFields = false,
  ) {
    const hasPartner = Boolean(item.partnerName?.trim() || item.partnerContact?.trim());
    return {
      eventId: item.eventId.trim(),
      partnerName: item.partnerName?.trim() || null,
      partnerGender: item.partnerGender ? this.normalizeGender(item.partnerGender) : null,
      partnerStudentId: hasPartner && (customFields || entrantType === EntrantType.SCHOOL)
        ? item.partnerStudentId?.trim() || null
        : null,
      partnerSchool: hasPartner ? item.partnerSchool?.trim() || fallback.school : null,
      partnerCollege: hasPartner && (customFields || entrantType === EntrantType.SCHOOL)
        ? item.partnerCollege?.trim() || fallback.college
        : null,
      partnerMajorGrade: hasPartner && (customFields || entrantType === EntrantType.SCHOOL)
        ? item.partnerMajorGrade?.trim() || fallback.majorGrade
        : null,
      partnerClassName: hasPartner && (customFields || entrantType === EntrantType.SCHOOL)
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
      select: { id: true, entrantType: true, userId: true },
    });
    if (duplicate) {
      const label = entrantTypeLabel(duplicate.entrantType);
      // 姓名 + 联系方式都对上的游客报名在前面已当作「追加」处理，走到这里多半是只有学号对上。
      throw new ConflictException(
        duplicate.userId
          ? `该选手已用账号在本赛事${label}报名；如需兼报其他项目，请登录该账号后提交`
          : `该选手已在本赛事${label}报名，不能重复报名；如需兼报其他项目，请填写与第一次报名时相同的姓名和联系方式`,
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
            gender: item.partnerGender ?? null,
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
          identityData: registration.identityData ?? Prisma.DbNull,
          partnerIdentityData: item.partnerIdentityData ?? Prisma.DbNull,
          eligibility: item.eligibility ?? Prisma.DbNull,
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

  private async createAdminGroupEntries(competition: CompetitionWithRelations, event: CompetitionWithRelations['events'][number], group: TournamentGroup, players: NormalizedAdminBatchPlayer[], operatorId?: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Tournament WHERE id = ${competition.id} FOR UPDATE`;
      const results: CompetitionRegistrationWithRelations[] = [];
      for (const player of players) {
        const personKey = createHash('sha256').update(`${player.name}\0${normalizeContact(player.contact)}`).digest('hex');
        const previous = await tx.competitionRegistration.findFirst({ where: { competitionId: competition.id, status: { notIn: ['REMOVED', 'REJECTED'] }, OR: [{ personKey }, { name: player.name, contact: player.contact }] }, include: { eventItems: true } });
        if (previous && previous.groupId !== group.id) throw new ConflictException(`第${player.row}行：选手已在其他组别报名`);
        if (previous?.eventItems.some(item => item.eventId === event.id)) throw new ConflictException(`第${player.row}行：该项目已报名`);
        const max = competition.allowCrossEventRegistration ? competition.maxRegistrationEvents : 1;
        if ((previous?.eventItems.length ?? 0) >= max) throw new BadRequestException(`第${player.row}行：超过兼项数量限制`);
        await this.ensureIdentityNotCrossGroup(tx, competition.id, group.id, [player.identityData?.fingerprint, player.partnerIdentityData?.fingerprint].filter(Boolean) as string[], previous?.id, [event.id]);
        const pending = player.eligibility?.status === 'PENDING' || previous?.status === 'PENDING';
        const item = { eventId: event.id, partnerName: player.partnerName ?? null, partnerGender: player.partnerGender ?? null,
          partnerContact: player.partnerContact ?? null, partnerSchool: player.partnerSchool ?? null, partnerStudentId: player.partnerStudentId ?? null,
          partnerCollege: player.partnerCollege ?? null, partnerMajorGrade: player.partnerMajorGrade ?? null, partnerClassName: player.partnerClassName ?? null,
          teamName: player.teamName ?? null, partnerIdentityData: player.partnerIdentityData ?? Prisma.DbNull, eligibility: player.eligibility };
        const data = { groupId: group.id, personKey, entrantType: player.entrantType, name: player.name, gender: player.gender, school: player.school,
          studentId: player.studentId ?? null, college: player.college ?? null, majorGrade: player.majorGrade ?? null,
          className: player.className ?? null, contact: player.contact, identityData: player.identityData ?? Prisma.DbNull,
          status: pending ? RegistrationStatus.PENDING : RegistrationStatus.APPROVED, eligibility: { status: pending ? 'PENDING' : 'PASSED' },
          reviewedAt: pending ? null : new Date(), reviewedById: pending ? null : operatorId ?? null };
        const include = { user: true, eventItems: { include: { event: true } } } as const;
        const application = previous
          ? await tx.competitionRegistration.update({ where: { id: previous.id }, data: { ...data, eventItems: { create: item } }, include })
          : await tx.competitionRegistration.create({ data: { ...data, competitionId: competition.id, guestToken: randomBytes(24).toString('base64url'), eventItems: { create: item } }, include });
        if (!pending) await this.createApprovedRegistrationRecords(tx, application, operatorId ?? null, [event.id]);
        results.push(application);
      }
      return results;
    }, { timeout: 30000, maxWait: 10000 });
  }

  private normalizeAdminBatchPlayer(
    item: AdminBatchCompetitionPlayerDto,
    rowNumber: number,
    event: { type: EventType; entrantType: EntrantType },
    rules: RegistrationFieldRules,
    group?: TournamentGroup | null,
    /** 编辑已有报名时，库里已存的本人/搭档证件信息；未提交证件号时沿用。 */
    stored?: { own?: Prisma.JsonValue | null; partner?: Prisma.JsonValue | null },
  ): NormalizedAdminBatchPlayer {
    const fields = groupFields(group?.fieldRules, event.entrantType === 'SCHOOL', !group);
    const ageRule = normalizeAgeRule(group?.ageRule);
    const own = preparePerson(item, fields, ageRule, '本人', stored?.own);
    if (group) rules = { SCHOOL: fields, SOCIAL: fields };
    const entrantType = item.entrantType
      ? this.normalizeEntrantType(item.entrantType)
      : item.social
        ? EntrantType.SOCIAL
        : event.entrantType;
    const row = item.row ?? rowNumber;
    const name = this.requiredBatchField(item.name, row, '姓名');
    const gender = own.gender;
    const school = this.requiredBatchField(item.school, row, entrantType === EntrantType.SOCIAL ? '单位' : '学校');
    const contact = this.requiredBatchField(item.contact, row, '联系方式');
    const isSchool = entrantType === EntrantType.SCHOOL;
    const studentId = isSchool || group ? this.batchGroupField(item.studentId, rules, 'studentId', '学号', row) : undefined;
    const college = isSchool || group ? this.batchGroupField(item.college, rules, 'college', '学院', row) : undefined;
    const majorGrade = isSchool || group ? this.batchGroupField(item.majorGrade, rules, 'majorGrade', '年级专业', row) : undefined;
    const className = [college, majorGrade].filter(Boolean).join(' ')
      || item.className?.trim()
      || undefined;

    const base: NormalizedAdminBatchPlayer = {
      social: !isSchool,
      entrantType,
      identityData: own.identity,
      eligibility: undefined,
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
        base.eligibility = itemEligibility(event.type, own, null, ageRule, group?.ruleVersion ?? 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : '性别填写有误';
        throw new BadRequestException(`第 ${row} 行：${message}`);
      }
      return base;
    }

    const partnerName = this.requiredBatchField(item.partnerName, row, isSchool ? '搭档姓名' : '队友姓名');
    const partner = preparePerson({ gender: item.partnerGender ?? null, identityNumber: item.partnerIdentityNumber }, fields, ageRule, '搭档', stored?.partner);
    const partnerGender = partner.gender;
    const partnerContact = this.requiredBatchField(item.partnerContact, row, isSchool ? '搭档联系方式' : '队友联系方式');
    const partnerSchool = item.partnerSchool?.trim() || school;
    let partnerStudentId: string | undefined;
    let partnerCollege: string | undefined;
    let partnerMajorGrade: string | undefined;
    let partnerClassName: string | undefined;
    if (isSchool || group) {
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
      base.eligibility = itemEligibility(event.type, own, partner, ageRule, group?.ruleVersion ?? 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : '双打性别填写有误';
      throw new BadRequestException(`第 ${row} 行：${message}`);
    }

    return {
      ...base,
      partnerIdentityData: partner.identity,
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
    if (state === 'hidden') return undefined;
    if (trimmed) return trimmed;
    if (state === 'required') {
      throw new BadRequestException(`第 ${row} 行缺少${label}`);
    }
    return undefined;
  }

  // 第三方人员没有学号，同一项目内按「姓名 + 联系方式」判重。
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

  private requiredBatchField(value: string | null | undefined, rowNumber: number, label: string) {
    const trimmed = value?.trim();
    if (!trimmed) throw new BadRequestException(`第 ${rowNumber} 行缺少${label}`);
    return trimmed;
  }

  private normalizeBatchGender(
    value: string | null | undefined,
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
        groupId: event.groupId,
        groupFields: event.group ? groupFields(event.group.fieldRules) : null,
        ageRule: event.group ? normalizeAgeRule(event.group.ageRule) : null,
        label: eventDisplayLabel(event),
        isDouble: this.isDoubleEvent(event.type),
      })),
      description: competition.description ?? competition.rules,
      registrationNotice: competition.registrationNotice,
      maxRegistrationEvents: competition.maxRegistrationEvents,
      allowCrossEventRegistration: competition.allowCrossEventRegistration,
      needsRegistrationReview: competition.needsRegistrationReview,
      allowSchoolRegistration: competition.allowSchoolRegistration,
      fieldRules,
      channels: [
        {
          entrantType: EntrantType.SCHOOL,
          label: entrantTypeLabel(EntrantType.SCHOOL),
          enabled: competition.allowSchoolRegistration
            && competition.events.some((event) => event.entrantType === EntrantType.SCHOOL),
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
      viewCount: competition.viewCount ?? 0,
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
      groupId: registration.groupId,
      eligibility: registration.eligibility,
      identity: identityView(registration.identityData),
      entrantTypeLabel: registration.eventItems[0]?.event.groupLabel ?? entrantTypeLabel(registration.entrantType),
      studentId: registration.studentId ?? '',
      college: registration.college ?? '',
      majorGrade: registration.majorGrade ?? '',
      name: registration.name,
      gender: registration.gender,
      genderLabel: registration.gender === Gender.MALE ? '男' : registration.gender === Gender.FEMALE ? '女' : '未填写',
      school: registration.school ?? '',
      className: registration.className ?? '',
      contact: registration.contact ?? '',
      phone: registration.contact ?? '',
      age: registration.age ?? null,
      shirtSize: registration.shirtSize ?? '',
      remark: registration.remark ?? '',
      items: registration.eventItems.map((item) => ({
        id: item.id,
        eventId: item.eventId,
        eventType: item.event.type,
        eventName: eventDisplayLabel(item.event),
        eligibility: item.eligibility,
        partnerIdentity: identityView(item.partnerIdentityData),
        partnerName: item.partnerName,
        partnerGender: item.partnerGender,
        partnerGenderLabel: item.partnerGender === Gender.MALE ? '男' : item.partnerGender === Gender.FEMALE ? '女' : null,
        partnerStudentId: item.partnerStudentId,
        partnerSchool: item.partnerSchool,
        partnerCollege: item.partnerCollege,
        partnerMajorGrade: item.partnerMajorGrade,
        partnerClassName: item.partnerClassName,
        partnerContact: item.partnerContact,
        partnerAge: item.partnerAge ?? null,
        partnerShirtSize: item.partnerShirtSize ?? '',
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
          genderLabel: registration.player2.gender === Gender.MALE ? '男' : registration.player2.gender === Gender.FEMALE ? '女' : '未填写',
          school: registration.partnerSchool ?? eventItem?.partnerSchool ?? registration.player2.affiliation ?? school,
          college: registration.partnerCollege ?? eventItem?.partnerCollege ?? '',
          majorGrade: registration.partnerMajorGrade ?? eventItem?.partnerMajorGrade ?? '',
          className: registration.partnerClassName ?? eventItem?.partnerClassName ?? '',
          phone: registration.partnerPhone ?? eventItem?.partnerContact ?? registration.player2.contact ?? '',
          age: eventItem?.partnerAge ?? null,
          shirtSize: eventItem?.partnerShirtSize ?? '',
        }
      : null;
    return {
      id: registration.id,
      competitionRegistrationId: registration.competitionRegistrationId,
      competitionId: registration.event.tournamentId,
      groupId: registration.event.groupId,
      eventId: registration.eventId,
      email: registration.competitionRegistration?.user?.email ?? registration.competitionRegistration?.guestEmail ?? '',
      entrantType,
      entrantTypeLabel: registration.event.groupLabel || entrantTypeLabel(entrantType),
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
      // 年龄、衣服尺寸只在线上报名里收集，后台直接录入的选手为空。
      age: registration.competitionRegistration?.age ?? null,
      shirtSize: registration.competitionRegistration?.shirtSize ?? '',
      gender,
      genderLabel: gender === Gender.MALE ? '男' : gender === Gender.FEMALE ? '女' : '未填写',
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

  /**
   * 前台参赛名单（无需登录）只公开姓名、性别、单位和打码后的联系方式。
   * 单位：学生组是学校，第三方是报名时填的单位。
   * 学号、学院、年级、邮箱、年龄、衣服尺寸、备注等一律不返回——接口返回的数据任何人都能看到，
   * 不能只靠页面不显示。
   */
  private toPublicPlayerView(registration: RegistrationWithRelations) {
    const view = this.toRegistrationView(registration);
    return {
      id: view.id,
      eventId: view.eventId,
      eventType: view.eventType,
      eventName: view.eventName,
      name: view.primaryName,
      primaryName: view.primaryName,
      gender: view.gender,
      genderLabel: view.genderLabel,
      unit: view.school.trim(),
      phone: maskContact(view.phone),
      partner: view.partner
        ? {
            name: view.partner.name,
            gender: view.partner.gender,
            genderLabel: view.partner.genderLabel,
            unit: view.partner.school.trim(),
            phone: maskContact(view.partner.phone),
          }
        : null,
    };
  }

  private groupPlayers(registrations: RegistrationWithRelations[]) {
    const players = registrations.map((registration) => this.toPublicPlayerView(registration));
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
      // 新前端按 eventId 分组，不同组别的同名项目不会混在一起。
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

  private ensureRegistrationGender(eventType: EventType, primaryGender: Gender | null, partnerGenderValue?: string | null) {
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
    if (!item.partnerName?.trim() || !item.partnerContact?.trim()) {
      throw new BadRequestException('双打项目必须填写搭档姓名和联系方式');
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
