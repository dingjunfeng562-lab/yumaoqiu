import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntrantType, EventType, Prisma, Tournament } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ageRuleLabel, groupFields, normalizeAgeRule } from '../common/age-eligibility';
import { generateRegistrationCode } from '../common/registration-code';
import { normalizeRegistrationFieldRules } from '../common/entrant';
import { eventEntryCounts, groupEntrantCounts } from '../common/registration-capacity';
import { defaultTeamCompetitionName } from '../common/team-competition-label';
import { SaveRegistrationGroupDto } from './registration-groups.dto';

export function legacyGroupId(tournamentId: string, type: EntrantType) { return `${tournamentId}_${type}`; }

/** 各项目名额：只接受 1 以上的整数或 null（不限）；没传的项目不在结果里，保存时保持原值。 */
function normalizeEventCaps(value: SaveRegistrationGroupDto['eventCaps']) {
  const caps = new Map<EventType, number | null>();
  if (!value || typeof value !== 'object') return caps;
  const types = Object.values(EventType) as string[];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!types.includes(key)) continue;
    if (raw === null || raw === undefined) {
      caps.set(key as EventType, null);
      continue;
    }
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100000) {
      throw new BadRequestException('项目名额需填 1 以上的整数，留空表示不限');
    }
    caps.set(key as EventType, limit);
  }
  return caps;
}

/**
 * 赛事唯一的默认组别是学生组，ID 固定，报名码与赛事上的兼容字段同步；
 * 已有自定义字段和年龄条件不被旧表单覆盖。默认社会组已取消，第三方报名请新建自定义组别。
 */
export async function ensureLegacyGroups(tx: Prisma.TransactionClient, tournament: Tournament) {
  const rules = normalizeRegistrationFieldRules(tournament.registrationFieldRules);
  const type = EntrantType.SCHOOL;
  const id = legacyGroupId(tournament.id, type);
  // 没开学生组的赛事不建默认学生组，免得出现一个空组别、还占用「学生组」这个组名。
  const needed = await tx.tournamentGroup.findUnique({ where: { id }, select: { id: true } })
    || tournament.schoolRegistrationCode
    || tournament.allowSchoolRegistration && await tx.event.count({ where: { tournamentId: tournament.id, entrantType: type } })
    || await tx.event.count({ where: { tournamentId: tournament.id, entrantType: type, groupId: null } })
    || await tx.competitionRegistration.count({ where: { competitionId: tournament.id, entrantType: type, groupId: null } });
  if (!needed) return;
  const channel = {
    registrationCode: tournament.schoolRegistrationCode,
    registrationCodeEnabled: tournament.schoolRegistrationCodeEnabled,
    enabled: tournament.allowSchoolRegistration,
  };
  await tx.tournamentGroup.upsert({
    where: { id },
    create: { id, tournamentId: tournament.id, name: '学生组', legacyType: type,
      fieldTemplate: type, sortOrder: 0, ...channel,
      fieldRules: groupFields(rules.SCHOOL, true, true), ageRule: { mode: 'NONE' } },
    update: channel,
  });
  await tx.event.updateMany({ where: { tournamentId: tournament.id, entrantType: type, groupId: null }, data: { groupId: id } });
  await tx.teamCompetition.updateMany({ where: { tournamentId: tournament.id, entrantType: type, groupId: null }, data: { groupId: id } });
  await tx.tournamentPaymentSetting.updateMany({ where: { tournamentId: tournament.id, entrantType: type, groupId: null }, data: { groupId: id } });
  await tx.competitionRegistration.updateMany({ where: { competitionId: tournament.id, entrantType: type, groupId: null }, data: { groupId: id } });
}

export async function saveRegistrationGroup(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  dto: SaveRegistrationGroupDto,
  groupId?: string,
) {
  const name = dto.name.trim();
  if (!name) throw new BadRequestException('请填写组别名称');
  const current = groupId ? await tx.tournamentGroup.findFirst({ where: { id: groupId, tournamentId }, include: { events: true } }) : null;
  if (groupId && !current) throw new NotFoundException('组别不存在');
  // 不再让管理员选字段模板：收集学号的组按学生处理（学号查重、统计高校），否则按第三方处理。
  // 默认学生组始终按学生处理；没传学号规则的旧客户端沿用它传来的模板。
  const studentIdRule = (dto.fieldRules as Record<string, unknown> | undefined)?.studentId;
  const fieldTemplate = current?.legacyType === EntrantType.SCHOOL ? 'SCHOOL'
    : studentIdRule !== undefined ? (studentIdRule === 'hidden' ? 'GENERAL' : 'SCHOOL')
    : dto.fieldTemplate === 'SCHOOL' ? 'SCHOOL' : 'GENERAL';
  const fieldRules = groupFields(dto.fieldRules, fieldTemplate === 'SCHOOL');
  const ageRule = normalizeAgeRule(dto.ageRule);
  if (await tx.tournamentGroup.findFirst({ where: { tournamentId, name, ...(groupId ? { id: { not: groupId } } : {}) } })) throw new ConflictException('本赛事已存在同名组别');
  const hasPeople = current && ((await tx.competitionRegistration.count({ where: { groupId } })) +
    (await tx.registration.count({ where: { event: { groupId } } })) +
    (await tx.team.count({ where: { teamCompetition: { groupId } } })));
  if (hasPeople && (JSON.stringify(normalizeAgeRule(current.ageRule)) !== JSON.stringify(ageRule) || current.fieldTemplate !== fieldTemplate || JSON.stringify(groupFields(current.fieldRules)) !== JSON.stringify(fieldRules))) {
    throw new ConflictException('本组已有报名，不能直接修改资格条件或字段规则；可新增组别，或仅修改名称、启停及收费');
  }
  // 内部仍用 EntrantType.SOCIAL 表示第三方（非学生、免登录）报名。
  const entrantType = fieldTemplate === 'SCHOOL' ? EntrantType.SCHOOL : EntrantType.SOCIAL;
  // 报名码改为一个赛事一个码，组别不再单独生成码；已有的旧组别码保留，扫旧码仍能进入并预选本组。
  // 名额随时可以改（已有报名也能改）：改小到比已报的还少时，已报上的不受影响，只是不能再报新的。
  const maxEntrants = dto.maxEntrants === undefined ? current?.maxEntrants ?? null : dto.maxEntrants;
  const eventCaps = normalizeEventCaps(dto.eventCaps);
  const data = { name, categoryLabel: dto.categoryLabel?.trim() || null, fieldTemplate,
    enabled: dto.enabled, registrationCodeEnabled: dto.registrationCodeEnabled ?? current?.registrationCodeEnabled ?? true, fieldRules, ageRule, maxEntrants };
  const group = current
    ? await tx.tournamentGroup.update({ where: { id: current.id }, data: { ...data, ruleVersion: current.ruleVersion + (hasPeople ? 0 : 1) } })
    : await tx.tournamentGroup.create({ data: { ...data, tournamentId, sortOrder: await tx.tournamentGroup.count({ where: { tournamentId } }) } });
  const removed = current?.events.filter(event => !dto.eventTypes.includes(event.type)) ?? [];
  for (const event of removed) {
    const used = await tx.event.findUniqueOrThrow({ where: { id: event.id }, include: { _count: { select: { registrations: true, competitionRegistrationItems: true, matches: true, drawBrackets: true } } } });
    if (Object.values(used._count).some(Boolean)) throw new ConflictException('已有报名或比赛的项目不能移除');
    await tx.event.delete({ where: { id: event.id } });
  }
  for (const type of dto.eventTypes) {
    const cap = eventCaps.get(type);
    await tx.event.upsert({ where: { tournamentId_groupId_type: { tournamentId, groupId: group.id, type } },
      create: { tournamentId, groupId: group.id, type, entrantType, groupLabel: name, format: 'SINGLE_ELIMINATION', scoringRule: 'TWENTYONE_BO3', scoringMode: 'STANDARD_GOLDEN', maxEntries: cap ?? null },
      update: { groupLabel: name, entrantType, ...(cap === undefined ? {} : { maxEntries: cap }) } });
  }
  await tx.teamCompetition.updateMany({ where: { groupId: group.id }, data: { entrantType } });
  // 团体赛名称跟着组别走：组别改名时，自动名称「旧组别名团体赛」一起改；早期手填的名称不动。
  if (current && current.name !== name) {
    await tx.teamCompetition.updateMany({
      where: { groupId: group.id, name: defaultTeamCompetitionName(current.name) },
      data: { name: defaultTeamCompetitionName(name) },
    });
  }
  await tx.tournamentPaymentSetting.upsert({ where: { tournamentId_groupId: { tournamentId, groupId: group.id } },
    create: { tournamentId, groupId: group.id, entrantType, enabled: dto.paymentEnabled ?? false,
      singlesFee: dto.singlesFee ?? 0, doublesFee: dto.doublesFee ?? 0, teamFee: dto.teamFee ?? 0, instructions: dto.paymentInstructions?.trim() || null },
    update: { entrantType, enabled: dto.paymentEnabled, singlesFee: dto.singlesFee, doublesFee: dto.doublesFee, teamFee: dto.teamFee, instructions: dto.paymentInstructions?.trim() || null } });
  if (group.legacyType === EntrantType.SCHOOL) {
    const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const legacyRules = normalizeRegistrationFieldRules(tournament.registrationFieldRules);
    const registrationFieldRules = { SCHOOL: { ...legacyRules.SCHOOL, ...fieldRules } };
    await tx.tournament.update({ where: { id: tournamentId }, data: { registrationFieldRules,
      allowSchoolRegistration: group.enabled, schoolRegistrationCodeEnabled: group.registrationCodeEnabled, schoolRegistrationCode: group.registrationCode } });
  }
  return group;
}

async function newRegistrationGroupCode(tx: Prisma.TransactionClient) {
  for (let i = 0; i < 20; i++) {
    const code = generateRegistrationCode();
    if (!(await tx.tournamentGroup.findUnique({ where: { registrationCode: code } })) &&
        !(await tx.tournament.findFirst({ where: { OR: [{ registrationCode: code }, { schoolRegistrationCode: code }] } }))) return code;
  }
  throw new ConflictException('报名码生成失败，请重试');
}

@Injectable()
export class RegistrationGroupsService {
  constructor(private prisma: PrismaService) {}

  async list(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('赛事不存在');
    const groups = await this.prisma.tournamentGroup.findMany({
      where: { tournamentId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { events: true, paymentSettings: true, _count: { select: { applications: true, teamCompetitions: true } } },
    });
    // 组别卡片上显示「已报 N 人」和各项目「已报 N 人/队」，口径与扫码报名的名额检查一致。
    const [entryCounts, entrantCounts] = await Promise.all([
      eventEntryCounts(this.prisma, groups.flatMap(group => group.events.map(event => event.id))),
      groupEntrantCounts(this.prisma, groups.map(group => group.id)),
    ]);
    return groups.map(group => ({ ...group,
      events: group.events.map(event => ({ ...event, entryCount: entryCounts.get(event.id) ?? 0 })),
      entrantCount: entrantCounts.get(group.id) ?? 0,
      fieldRules: groupFields(group.fieldRules),
      ageRule: normalizeAgeRule(group.ageRule), ageRuleLabel: ageRuleLabel(normalizeAgeRule(group.ageRule)),
      payment: group.paymentSettings[0] ?? null }));
  }

  async save(tournamentId: string, dto: SaveRegistrationGroupDto, groupId?: string) {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Tournament WHERE id = ${tournamentId} FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('赛事不存在');
      return saveRegistrationGroup(tx, tournamentId, dto, groupId);
    });
  }

  async regenerate(tournamentId: string, groupId: string) {
    return this.prisma.$transaction(async tx => {
      const group = await tx.tournamentGroup.findFirst({ where: { id: groupId, tournamentId } });
      if (!group) throw new NotFoundException('组别不存在');
      const registrationCode = await newRegistrationGroupCode(tx);
      const result = await tx.tournamentGroup.update({ where: { id: groupId }, data: { registrationCode, registrationCodeEnabled: true } });
      if (group.legacyType === EntrantType.SCHOOL) await tx.tournament.update({ where: { id: tournamentId }, data: { schoolRegistrationCode: registrationCode, schoolRegistrationCodeEnabled: true } });
      return result;
    });
  }

  /**
   * 删除组别：有报名、团体赛、抽签或比赛数据时拒绝，只能关闭本组报名。
   * 默认学生组的记录要保留（赛事上的兼容字段依赖它），只删掉它的项目并关闭报名。
   */
  async remove(tournamentId: string, groupId: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Tournament WHERE id = ${tournamentId} FOR UPDATE`;
      const group = await tx.tournamentGroup.findFirst({ where: { id: groupId, tournamentId } });
      if (!group) throw new NotFoundException('组别不存在');
      const used = (await tx.competitionRegistration.count({ where: { groupId } }))
        + (await tx.registration.count({ where: { event: { groupId } } }))
        + (await tx.teamCompetition.count({ where: { groupId } }))
        + (await tx.match.count({ where: { event: { groupId } } }))
        + (await tx.drawBracket.count({ where: { event: { groupId } } }));
      if (used) throw new ConflictException(`「${group.name}」已有报名或比赛数据，不能删除；可以关闭本组报名`);
      if (group.legacyType) {
        await tx.event.deleteMany({ where: { groupId } });
        await tx.tournamentGroup.update({ where: { id: groupId }, data: { enabled: false } });
        await tx.tournament.update({ where: { id: tournamentId }, data: { allowSchoolRegistration: false } });
      } else {
        await tx.tournamentGroup.delete({ where: { id: groupId } });
      }
      return { id: groupId, removed: true };
    });
  }

  /** 组别报名码启停（界面已改为一个赛事一个码，接口保留兼容）；默认学生组同步写回赛事上的兼容字段。 */
  async setCodeEnabled(tournamentId: string, groupId: string, enabled: boolean) {
    return this.prisma.$transaction(async tx => {
      const group = await tx.tournamentGroup.findFirst({ where: { id: groupId, tournamentId } });
      if (!group) throw new NotFoundException('组别不存在');
      const result = await tx.tournamentGroup.update({ where: { id: groupId }, data: { registrationCodeEnabled: enabled } });
      if (group.legacyType === EntrantType.SCHOOL) await tx.tournament.update({ where: { id: tournamentId }, data: { schoolRegistrationCodeEnabled: enabled } });
      return result;
    });
  }

}
