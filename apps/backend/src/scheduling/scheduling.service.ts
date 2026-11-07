import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Format, MatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCompetitionsService } from '../team-competitions/team-competitions.service';
import { AutoScheduleDto, ClearScheduleDto, CreateVenueDto, UpdateMatchScheduleDto, UpdateVenueDto, SaveGroupVenuesDto } from './dto/scheduling.dto';
import { ScoringGateway } from '../scoring/scoring.gateway';
import {
  SECOND_STAGE_FORMAL_ROUND_NO_BASE,
  isSecondStageFormalRoundNo,
  secondStageDependencyMatchNos,
  secondStageFormalRoundNo,
} from '../common/second-stage-bracket';

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

type ScheduleStage = NonNullable<AutoScheduleDto['scheduleStage']>;

type RegistrationView = {
  id: string;
  name: string;
  affiliation: string;
  playerIds: string[];
};

type ScheduleMatch = {
  id: string;
  groupId: string | null;
  groupName: string | null;
  scheduleLocked: boolean;
  scheduleOverride: boolean;
  unscheduledReason: string | null;
  allowedVenueIds: string[] | null;
  team1Id?: string | null;
  team2Id?: string | null;
  teamMatchId?: string | null;
  team1Name?: string | null;
  team2Name?: string | null;
  eventId: string | null;
  eventType: string;
  eventTypeLabel: string;
  round: string;
  roundNo: number;
  matchNo: number;
  // 单个场地内按时间顺序的连续场次序号（第1场、第2场…）；未分配场地时为 null。
  venueSequence: number | null;
  side1Id: string | null;
  side2Id: string | null;
  side1: RegistrationView | null;
  side2: RegistrationView | null;
  status: MatchStatus;
  venueId: string | null;
  venueName: string | null;
  scheduledAt: Date | null;
  durationMinutes: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  dependenciesReady: boolean;
  dependencyMatchIds: string[];
  scheduleStatus: 'WAITING_SCHEDULE' | 'PENDING' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
};

type ConflictItem = {
  type: 'VENUE' | 'PLAYER' | 'DEPENDENCY' | 'UNSCHEDULED' | 'GROUP_VENUE';
  matchIds: string[];
  message: string;
};

type BusyInterval = {
  start: number;
  end: number;
};

type DailyBreakInterval = {
  start: number;
  end: number;
};

type DailyWindow = {
  startMinutes: number;
  endMinutes: number;
  breakPeriods: DailyBreakInterval[];
};

const SCHEDULE_TIME_ZONE = 'Asia/Shanghai';
const SCHEDULE_TIME_ZONE_OFFSET_MINUTES = 8 * 60;

const scheduleDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHEDULE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

@Injectable()
export class SchedulingService {
  constructor(private prisma: PrismaService, @Optional() private gateway?: ScoringGateway) {}

  // Every schedule mutation in a tournament is serialized. Notifications run
  // only after commit, so subscribers never fetch a partially applied schedule.
  private async withScheduleTransaction<T>(tournamentId: string, work: (service: SchedulingService) => Promise<T>, notify = true) {
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Tournament WHERE id = ${tournamentId} FOR UPDATE`;
      return work(new SchedulingService(tx as PrismaService));
    }, { maxWait: 10000, timeout: 60000 });
    if (notify) this.gateway?.emitBracketUpdate({ tournamentId });
    return result;
  }

  private async audit(tournamentId: string, action: string, before: unknown, after: unknown, actorId?: string) {
    await this.prisma.scheduleOperationLog.create({ data: {
      tournamentId, action, actorId,
      before: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
      after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue,
    } });
  }

  async getScheduleLogs(tournamentId: string) {
    const logs = await this.prisma.scheduleOperationLog.findMany({ where: { tournamentId }, orderBy: { createdAt: 'desc' }, take: 50 });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(logs.flatMap(log => log.actorId ? [log.actorId] : []))] } }, select: { id: true, username: true } });
    return logs.map(log => ({ ...log, actorName: log.actorId ? users.find(user => user.id === log.actorId)?.username ?? '已删除用户' : '系统' }));
  }

  async getGroupVenues(tournamentId: string) {
    await this.ensureTournament(tournamentId);
    const groups = await this.prisma.tournamentGroup.findMany({
      where: { tournamentId }, include: { allowedVenues: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return groups.map(group => ({
      groupId: group.id, name: group.name, restrictVenues: group.restrictVenues,
      venueIds: group.allowedVenues.map(v => v.venueId).sort(),
    }));
  }

  async saveGroupVenues(tournamentId: string, dto: SaveGroupVenuesDto, actorId?: string) {
    return this.withScheduleTransaction(tournamentId, async service => {
      const before = await service.getGroupVenues(tournamentId);
      const venues = await service.listVenues(tournamentId);
      const groupIds = new Set(before.map(group => group.groupId));
      if (new Set(dto.groups.map(g => g.groupId)).size !== dto.groups.length) throw new BadRequestException('组别不能重复');
      for (const rule of dto.groups) {
        if (!groupIds.has(rule.groupId)) throw new BadRequestException('组别必须属于当前赛事');
        if (rule.restrictVenues && !rule.venueIds.length) throw new BadRequestException('指定场地模式至少选择一片场地');
        if (rule.venueIds.some(id => !venues.some(v => v.id === id && v.isActive))) throw new BadRequestException('请选择当前赛事已启用的场地');
        await service.prisma.tournamentGroup.update({ where: { id: rule.groupId }, data: { restrictVenues: rule.restrictVenues } });
        await service.prisma.groupVenue.deleteMany({ where: { groupId: rule.groupId } });
        if (rule.restrictVenues) await service.prisma.groupVenue.createMany({ data: [...new Set(rule.venueIds)].map(venueId => ({ groupId: rule.groupId, venueId })) });
      }
      const groups = await service.getGroupVenues(tournamentId);
      const matches = await service.loadScheduleMatches(tournamentId);
      const affected = matches.filter(m => m.status === MatchStatus.PENDING && m.venueId && m.allowedVenueIds && !m.allowedVenueIds.includes(m.venueId) && !m.scheduleOverride);
      await service.audit(tournamentId, 'GROUP_VENUES', before, groups, actorId);
      return { groups, affectedMatchCount: affected.length };
    }, false);
  }

  listVenues(tournamentId: string) {
    return this.prisma.venue.findMany({
      where: { tournamentId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createVenue(tournamentId: string, dto: CreateVenueDto) {
    return this.withScheduleTransaction(tournamentId, async service => {
      await service.ensureTournament(tournamentId);
      return service.prisma.venue.create({ data: { tournamentId, name: dto.name, sortOrder: dto.sortOrder ?? 0 } });
    });
  }

  async updateVenue(id: string, dto: UpdateVenueDto) {
    const venue = await this.ensureVenue(id);
    return this.withScheduleTransaction(venue.tournamentId, service => service.prisma.venue.update({
      where: { id },
      data: dto,
    }));
  }

  async removeVenue(id: string) {
    const venue = await this.ensureVenue(id);
    return this.withScheduleTransaction(venue.tournamentId, async service => {
      const linkedMatches = await service.prisma.match.count({ where: { venueId: id } });
      if (linkedMatches > 0) return service.prisma.venue.update({ where: { id }, data: { isActive: false } });
      return service.prisma.venue.delete({ where: { id: venue.id } });
    });
  }

  async getSchedule(tournamentId: string, eventId?: string) {
    await this.ensureTournament(tournamentId);
    const [venues, allMatches, groups] = await Promise.all([
      this.listVenues(tournamentId),
      this.loadScheduleMatches(tournamentId),
      this.getGroupVenues(tournamentId),
    ]);
    const matches = eventId ? allMatches.filter(m => m.eventId === eventId) : allMatches;
    const visibleIds = new Set(matches.map(m => m.id));
    const conflicts = this.detectConflicts(allMatches).filter(c => c.matchIds.some(id => visibleIds.has(id)));
    const conflictMap = new Map<string, ConflictItem[]>();
    for (const conflict of conflicts) {
      for (const matchId of conflict.matchIds) {
        const list = conflictMap.get(matchId) ?? [];
        list.push(conflict);
        conflictMap.set(matchId, list);
      }
    }

    return {
      groups,
      teamCourtLimits: eventId ? [] : await this.teamCourtLimits(tournamentId),
      venues,
      matches: matches.map((match) => ({
        ...match,
        scheduledAt: match.scheduledAt?.toISOString() ?? null,
        scheduledAtLocal: match.scheduledAt ? this.formatScheduleDateTime(match.scheduledAt) : null,
        startedAt: match.startedAt?.toISOString() ?? null,
        finishedAt: match.finishedAt?.toISOString() ?? null,
        conflicts: conflictMap.get(match.id) ?? [],
      })),
      conflicts,
    };
  }

  private async teamCourtLimits(tournamentId: string) {
    const competitions = await this.prisma.teamCompetition.findMany({
      where: { tournamentId }, include: { _count: { select: { teams: true, teamMatches: true } } },
    });
    const eventCount = await this.prisma.event.count({ where: { tournamentId } });
    return competitions.filter(c => c.format === 'ROUND_ROBIN' && c._count.teams >= 2 && c._count.teamMatches > 0)
      .map(c => ({ competitionId: c.id, name: c.name, teamCount: c._count.teams,
        maxCourts: Math.floor(c._count.teams / 2), canAdjust: competitions.length === 1 && eventCount === 0 }));
  }

  async autoSchedule(dto: AutoScheduleDto, actorId?: string) {
    return this.withScheduleTransaction(dto.tournamentId, service => service.autoScheduleInternal(dto, actorId), !dto.preview);
  }

  private async autoScheduleInternal(dto: AutoScheduleDto, actorId?: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: dto.tournamentId },
      select: {
        defaultMatchMinutes: true,
        breakMinutes: true,
        dailyStartTime: true,
        dailyEndTime: true,
        startDate: true,
        endDate: true,
      },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');

    const startAt = this.parseScheduleDate(dto.startAt, dto.startAtLocal, '开始时间无效');
    const matchMinutes = dto.matchMinutes ?? tournament.defaultMatchMinutes;
    const breakMinutes = dto.breakMinutes ?? tournament.breakMinutes;
    const dailyWindow = this.parseDailyWindow(
      dto.dailyStartTime ?? tournament.dailyStartTime,
      dto.dailyEndTime ?? tournament.dailyEndTime,
      dto.breakPeriods,
    );
    if (dto.overrideMatchMinutes && this.longestPlayableMinutes(dailyWindow) < matchMinutes) {
      throw new BadRequestException('每日可排程时段不足以安排一场比赛，请调整起止时间或休息时段');
    }
    const earliestScheduleStart = Math.max(
      startAt.getTime(),
      this.withMinutesOfDay(tournament.startDate, dailyWindow.startMinutes).getTime(),
    );

    const venueWhere: Prisma.VenueWhereInput = {
      tournamentId: dto.tournamentId,
      isActive: true,
      ...(dto.venueIds?.length ? { id: { in: dto.venueIds } } : {}),
    };
    const venues = await this.prisma.venue.findMany({
      where: venueWhere,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (!venues.length) throw new BadRequestException('请先维护至少一个可用场地');
    if (dto.venueIds?.length && venues.length !== new Set(dto.venueIds).size) {
      throw new BadRequestException('所选场地必须来自当前赛事且处于启用状态');
    }

    const scopeMatches = await this.prisma.match.findMany({
      where: this.tournamentMatches(dto.tournamentId, dto.eventId),
      include: { event: true, teamMatch: { include: { teamCompetition: true } } },
      orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
    });
    if (!scopeMatches.length) throw new BadRequestException('暂无可排程场次，请先完成抽签编排');
    const courtLimits = dto.eventId ? [] : await this.teamCourtLimits(dto.tournamentId);
    const limitsByCompetition = new Map(courtLimits.map(limit => [limit.competitionId, limit.maxCourts]));
    const scheduleStage: ScheduleStage = dto.scheduleStage ?? 'all';
    const targetMatches = scopeMatches.filter((match) =>
      this.isScheduleStageMatch(match.event?.format ?? null, match.roundNo, scheduleStage),
    );
    if (!targetMatches.length) {
      throw new BadRequestException(
        scheduleStage === 'second'
          ? '当前范围暂无第二阶段可排程场次'
          : scheduleStage === 'first'
            ? '当前范围暂无第一阶段可排程场次'
            : '当前范围暂无可排程场次',
      );
    }

    const matchMap = new Map(
      scopeMatches
        .filter((match) => match.eventId)
        .map((match) => [this.matchKey(match.eventId!, match.roundNo, match.matchNo), match]),
    );
    const groups = await this.getGroupVenues(dto.tournamentId);
    const groupMap = new Map(groups.map(group => [group.groupId, group]));
    const groupFor = (match: (typeof scopeMatches)[number]) => groupMap.get(match.event?.groupId ?? match.teamMatch?.teamCompetition.groupId ?? '');
    const eligibleVenues = (match: (typeof scopeMatches)[number]) => {
      const rule = groupFor(match);
      return venues.filter(venue => !rule?.restrictVenues || rule.venueIds.includes(venue.id));
    };
    const allScheduled = await this.loadScheduleMatches(dto.tournamentId);
    const fingerprint = createHash('sha256').update(JSON.stringify({ tournament, groups, venues,
      matches: allScheduled, scopeMatches,
      options: { ...dto, preview: undefined, fingerprint: undefined },
    })).digest('hex');
    if (dto.fingerprint && dto.fingerprint !== fingerprint) throw new ConflictException('赛程、场地或规则已变化，请重新预览后应用');
    const adjustableIds = new Set(targetMatches.filter(match => match.status === MatchStatus.PENDING && !match.startedAt && !match.scheduleLocked).map(match => match.id));
    const anchors = allScheduled.filter(match => !adjustableIds.has(match.id) && Boolean(match.scheduledAt) && match.status !== MatchStatus.CANCELLED);
    const reasons = new Map<string, string>();
    const venueBusy = new Map<string, BusyInterval[]>(
      (await this.listVenues(dto.tournamentId)).map((venue) => [venue.id, []]),
    );
    const playerBusy = new Map<string, BusyInterval[]>();
    for (const anchor of anchors) {
      const endAt = this.addMinutes(anchor.scheduledAt!, anchor.durationMinutes).getTime();
      if (anchor.venueId && venueBusy.has(anchor.venueId)) {
        this.addBusyInterval(venueBusy, anchor.venueId, {
          start: anchor.scheduledAt!.getTime(),
          end: this.addMinutes(anchor.scheduledAt!, anchor.durationMinutes + breakMinutes).getTime(),
        });
      }
      for (const playerId of this.matchPlayerIds(anchor)) {
        this.addBusyInterval(playerBusy, playerId, {
          start: anchor.scheduledAt!.getTime(),
          end: endAt,
        });
      }
    }

    const registrationMap = await this.registrationMap(
      scopeMatches.flatMap((match) => [match.side1Id, match.side2Id]),
    );
    const eventTypeRank = new Map((dto.eventTypeOrder ?? []).map((type, index) => [type, index]));
    const scheduledEndByKey = new Map<string, number>();
    const teamRelease = new Map<string, number>();
    const roundRelease = new Map<string, number>();
    const teamVenue = new Map<string, string>();
    const targetTeamMatchIds = new Set(targetMatches.map(match => match.teamMatchId).filter(Boolean));
    for (const fixed of allScheduled.filter(match => match.teamMatchId && targetTeamMatchIds.has(match.teamMatchId) && match.venueId && (match.status === MatchStatus.LIVE || match.status === MatchStatus.COMPLETED || match.scheduleLocked))) {
      const currentVenue = teamVenue.get(fixed.teamMatchId!);
      if (currentVenue && currentVenue !== fixed.venueId) throw new ConflictException('同一团体对阵的已开赛子项使用了不同场地，请先核对原排程');
      teamVenue.set(fixed.teamMatchId!, fixed.venueId!);
    }
    const scopeById = new Map(scopeMatches.map(match => [match.id, match]));
    for (const anchor of anchors) {
      if (anchor.teamMatchId && anchor.scheduledAt) teamRelease.set(anchor.teamMatchId, Math.max(teamRelease.get(anchor.teamMatchId) ?? 0, this.addMinutes(anchor.scheduledAt, anchor.durationMinutes + breakMinutes).getTime()));
      const competitionId = scopeById.get(anchor.id)?.teamMatch?.teamCompetitionId;
      if (competitionId && limitsByCompetition.has(competitionId) && anchor.scheduledAt) {
        const key = `${competitionId}:${anchor.roundNo}`;
        roundRelease.set(key, Math.max(roundRelease.get(key) ?? 0, this.addMinutes(anchor.scheduledAt, anchor.durationMinutes + breakMinutes).getTime()));
      }
      if (!anchor.eventId || !anchor.scheduledAt) continue;
      scheduledEndByKey.set(
        this.matchKey(anchor.eventId, anchor.roundNo, anchor.matchNo),
        this.addMinutes(anchor.scheduledAt, anchor.durationMinutes + breakMinutes).getTime(),
      );
    }

    const schedulableMatches = targetMatches
      .filter((match) => adjustableIds.has(match.id))
      .sort((a, b) => {
        const stagePriority = (dto.prioritizeSecondStage ?? true)
          ? Number(!isSecondStageFormalRoundNo(a.roundNo)) -
            Number(!isSecondStageFormalRoundNo(b.roundNo))
          : 0;
        const aRank = eventTypeRank.get(a.event?.type ?? '') ?? Number.MAX_SAFE_INTEGER;
        const bRank = eventTypeRank.get(b.event?.type ?? '') ?? Number.MAX_SAFE_INTEGER;
        return stagePriority || aRank - bRank || a.roundNo - b.roundNo || eligibleVenues(a).length - eligibleVenues(b).length
          || (a.teamMatchId ?? '').localeCompare(b.teamMatchId ?? '') || a.matchNo - b.matchNo;
      });

    const updates: Array<{ matchId: string; venueId: string; scheduledAt: Date; minutes: number }> = [];
    // Topological selection preserves dependencies even when stage priority
    // places a later round first. Never place a dependent whose upstream did not fit.
    const remaining = [...schedulableMatches];
    while (remaining.length) {
      const index = remaining.findIndex(item => !this.dependencyMatches(item, matchMap).some(dep => remaining.some(m => m.id === dep.id)));
      if (index < 0) { for (const item of remaining) reasons.set(item.id, '前置比赛依赖异常，请核对签表'); break; }
      const [match] = remaining.splice(index, 1);
      const missingDependency = this.dependencyMatches(match, matchMap).some(dep =>
        dep.status !== MatchStatus.COMPLETED && !scheduledEndByKey.has(this.matchKey(dep.eventId!, dep.roundNo, dep.matchNo)));
      if (missingDependency) { reasons.set(match.id, '前置比赛尚未排入，请先安排前置比赛'); continue; }
      const playerIds = [
        ...this.playerIds(registrationMap.get(match.side1Id!)),
        ...this.playerIds(registrationMap.get(match.side2Id!)),
        ...[match.teamMatch?.team1Id, match.teamMatch?.team2Id].filter(Boolean).map(id => `team:${id}`),
      ];
      const perMatchMinutes = dto.overrideMatchMinutes ? matchMinutes : match.durationMinutes ?? match.event?.defaultMatchMinutes ?? matchMinutes;
      if (this.longestPlayableMinutes(dailyWindow) < perMatchMinutes) { reasons.set(match.id, '每日连续可用时段不足以容纳本场比赛'); continue; }
      const dependencyReleaseTime = this.dependencyReleaseTime(match, matchMap, scheduledEndByKey);
      const competitionId = match.teamMatch?.teamCompetitionId;
      const courtLimit = competitionId ? limitsByCompetition.get(competitionId) : undefined;
      const previousRoundEnd = competitionId && courtLimit ? roundRelease.get(`${competitionId}:${match.roundNo - 1}`) ?? 0 : 0;
      const earliestMatchStart = Math.max(earliestScheduleStart, dependencyReleaseTime, previousRoundEnd, match.teamMatchId ? teamRelease.get(match.teamMatchId) ?? 0 : 0);
      const fixedVenue = match.teamMatchId ? teamVenue.get(match.teamMatchId) : undefined;
      const allowed = eligibleVenues(match);
      // Already-started team encounters remain on their original court even
      // after a group rule changes; preserve that explicit historical exception.
      const fixed = fixedVenue ? (await this.listVenues(dto.tournamentId)).find(v => v.id === fixedVenue && v.isActive) : undefined;
      const candidates = (fixedVenue ? (fixed ? [fixed] : []) : allowed)
        .map(venue => ({ venue, isBorrow: false }))
        .filter(({ venue }) => !fixedVenue || venue.id === fixedVenue)
        .map(({ venue, isBorrow }) => ({
          venue,
          isBorrow,
          startTime: this.findEarliestStart(
            venue.id,
            earliestMatchStart,
            perMatchMinutes,
            breakMinutes,
            dailyWindow,
            tournament.endDate,
            playerIds,
            venueBusy,
            playerBusy,
          ),
        }))
        .filter(
          (
            candidate,
          ): candidate is { venue: (typeof venues)[number]; isBorrow: boolean; startTime: number } =>
            candidate.startTime !== null,
        );
      // 排不入指定场地的比赛保留待排程并给出原因。
      if (!candidates.length) {
        reasons.set(match.id, !allowed.length && !fixedVenue
          ? `${groupFor(match)?.name ?? '本组'}指定场地与本次启用场地无交集，请调整场地范围`
          : '指定场地在赛事日期和可用时段内已无空位，请增加场地或延长时间');
        continue;
      }
      // 同一可用范围内优先最早时间，再按场地序号稳定排序。
      candidates.sort(
        (a, b) =>
          this.dayKey(a.startTime) - this.dayKey(b.startTime) ||
          Number(a.isBorrow) - Number(b.isBorrow) ||
          a.startTime - b.startTime ||
          a.venue.sortOrder - b.venue.sortOrder,
      );
      const winner = candidates[0];
      const scheduledAt = new Date(winner.startTime);
      const matchEndAt = this.addMinutes(scheduledAt, perMatchMinutes).getTime();
      if (competitionId && courtLimit) {
        const key = `${competitionId}:${match.roundNo}`;
        roundRelease.set(key, Math.max(roundRelease.get(key) ?? 0, matchEndAt + breakMinutes * 60000));
      }
      if (match.teamMatchId) {
        teamRelease.set(match.teamMatchId, this.addMinutes(scheduledAt, perMatchMinutes + breakMinutes).getTime());
        teamVenue.set(match.teamMatchId, winner.venue.id);
      }

      updates.push({ matchId: match.id, venueId: winner.venue.id, scheduledAt, minutes: perMatchMinutes });
      if (match.eventId) {
        scheduledEndByKey.set(
          this.matchKey(match.eventId, match.roundNo, match.matchNo),
          this.addMinutes(scheduledAt, perMatchMinutes + breakMinutes).getTime(),
        );
      }
      this.addBusyInterval(venueBusy, winner.venue.id, {
        start: scheduledAt.getTime(),
        end: this.addMinutes(scheduledAt, perMatchMinutes + breakMinutes).getTime(),
      });
      for (const playerId of playerIds) {
        this.addBusyInterval(playerBusy, playerId, {
          start: scheduledAt.getTime(),
          end: matchEndAt,
        });
      }
    }

    const projected = allScheduled.map(match => {
      if (!adjustableIds.has(match.id)) return match;
      const update = updates.find(item => item.matchId === match.id);
      return { ...match, venueId: update?.venueId ?? null, scheduledAt: update?.scheduledAt ?? null,
        venueName: venues.find(v => v.id === update?.venueId)?.name ?? match.venueName,
        durationMinutes: update?.minutes ?? match.durationMinutes,
        scheduleLocked: false, scheduleOverride: Boolean(update && match.allowedVenueIds && !match.allowedVenueIds.includes(update.venueId)),
        unscheduledReason: reasons.get(match.id) ?? null };
    });
    // A locked downstream match must not be invalidated by a rebuilt upstream.
    const hardConflicts = this.detectPlacementConflicts(projected, breakMinutes)
      .filter(c => c.matchIds.some(id => adjustableIds.has(id)));
    if (hardConflicts.length) throw new ConflictException(hardConflicts[0].message);
    const summary = groups.map(group => {
      const items = projected.filter(m => m.groupId === group.groupId && (!dto.eventId || m.eventId === dto.eventId));
      return { ...group, scheduled: items.filter(m => m.scheduledAt && m.venueId).length,
        unscheduled: items.filter(m => m.status === MatchStatus.PENDING && (!m.scheduledAt || !m.venueId)).length,
        estimatedEnd: items.some(m => m.scheduledAt) ? new Date(Math.max(...items.filter(m => m.scheduledAt).map(m => this.endTime(m).getTime()))).toISOString() : null };
    });
    const preview = { fingerprint, groups: summary, scheduledCount: updates.length,
      preservedCount: targetMatches.filter(m => m.scheduleLocked).length,
      unscheduled: [...reasons].map(([matchId, reason]) => ({ matchId, reason })),
      matches: projected.filter(m => !dto.eventId || m.eventId === dto.eventId).map(m => ({ ...m, scheduledAt: m.scheduledAt?.toISOString() ?? null })),
    };
    if (dto.preview) return { preview };
    for (const match of projected.filter(m => adjustableIds.has(m.id))) {
      const original = scopeMatches.find(m => m.id === match.id)!;
      const changed = await this.prisma.match.updateMany({
        where: { id: match.id, status: MatchStatus.PENDING, startedAt: null, updatedAt: original.updatedAt },
        data: { venueId: match.venueId, scheduledAt: match.scheduledAt, durationMinutes: match.durationMinutes,
          scheduleLocked: false, scheduleOverride: match.scheduleOverride, unscheduledReason: match.unscheduledReason },
      });
      if (changed.count !== 1) throw new ConflictException('比赛状态已变化，请重新预览');
    }
    await this.prisma.tournament.update({ where: { id: dto.tournamentId }, data: {
      schedulingSettings: { dailyStartTime: dto.dailyStartTime ?? tournament.dailyStartTime,
        dailyEndTime: dto.dailyEndTime ?? tournament.dailyEndTime, breakMinutes, breakPeriods: (dto.breakPeriods ?? []).map(p => ({ startTime: p.startTime, durationMinutes: p.durationMinutes })) },
    } });
    await this.audit(dto.tournamentId, 'AUTO', allScheduled.filter(m => adjustableIds.has(m.id)).map(m => this.placement(m)),
      projected.filter(m => adjustableIds.has(m.id)).map(m => this.placement(m)), actorId);
    return this.getSchedule(dto.tournamentId, dto.eventId);
  }

  /**
   * 取消场地排程:把所选范围内「未开始」场次的场地与时间清空,使其回到待排程状态。
   * 自动排程的逆操作。只清空 PENDING 场次,已完赛 / 进行中的场次(及其结果、所在场地)保持不动,
   * 这样清空后重新自动排程时它们仍作为锚点被避让。durationMinutes(单场预估时长)保留。
   */
  async clearSchedule(dto: ClearScheduleDto, actorId?: string) {
    return this.withScheduleTransaction(dto.tournamentId, async service => {
      await service.ensureTournament(dto.tournamentId);
      const matches = await service.prisma.match.findMany({ where: {
        ...service.tournamentMatches(dto.tournamentId, dto.eventId), status: MatchStatus.PENDING, startedAt: null,
        ...(dto.includeLocked ? {} : { scheduleLocked: false }),
      } });
      const result = await service.prisma.match.updateMany({
        where: { id: { in: matches.map(m => m.id) }, status: MatchStatus.PENDING, startedAt: null,
          ...(dto.includeLocked ? {} : { scheduleLocked: false }) },
        data: { venueId: null, scheduledAt: null, scheduleLocked: false, scheduleOverride: false, unscheduledReason: null },
      });
      if (result.count !== matches.length) throw new ConflictException('比赛状态已变化，请刷新后重试');
      await service.audit(dto.tournamentId, 'CLEAR', matches.map(m => service.placement(m)), { includeLocked: dto.includeLocked ?? false, count: result.count }, actorId);
      return service.getSchedule(dto.tournamentId, dto.eventId);
    });
  }

  private placement(match: { id: string; venueId: string | null; scheduledAt: Date | null; durationMinutes: number; scheduleLocked: boolean }) {
    return { matchId: match.id, venueId: match.venueId, scheduledAt: match.scheduledAt, durationMinutes: match.durationMinutes, scheduleLocked: match.scheduleLocked };
  }

  private async matchTournamentId(matchId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId }, include: { event: true } });
    if (!match) throw new NotFoundException('场次不存在');
    return match.event?.tournamentId ?? this.resolveTeamMatchTournamentId(match.teamMatchId);
  }

  async previewMatchSchedule(matchId: string, dto: UpdateMatchScheduleDto) {
    const tournamentId = await this.matchTournamentId(matchId);
    const plan = await this.manualPlan(tournamentId, matchId, dto);
    return this.manualPreview(plan);
  }

  private manualPreview(plan: Awaited<ReturnType<SchedulingService['manualPlan']>>) {
    return { changes: plan.changes.map(m => ({ ...this.placement(m), venueName: m.venueName,
      scheduledAtLocal: m.scheduledAt ? this.formatScheduleDateTime(m.scheduledAt) : null })),
      conflicts: plan.conflicts, outsideGroup: plan.outsideGroup, venues: plan.venueOptions };
  }

  async updateMatchSchedule(matchId: string, dto: UpdateMatchScheduleDto, actorId?: string) {
    if (dto.findNextAvailable) throw new BadRequestException('请先预览可用时间，再保存明确的场地和时间');
    const tournamentId = await this.matchTournamentId(matchId);
    return this.withScheduleTransaction(tournamentId, async service => {
      const plan = await service.manualPlan(tournamentId, matchId, dto);
      if (plan.conflicts.length) throw new ConflictException(plan.conflicts[0].message);
      if (plan.outsideGroup && !dto.allowOutsideGroup) throw new BadRequestException('所选场地超出组别范围，请勾选“允许本场临时借场”后保存');
      for (const match of plan.changes) {
        const original = plan.before.find(m => m.id === match.id)!;
        const result = await service.prisma.match.updateMany({ where: {
          id: match.id, status: MatchStatus.PENDING, startedAt: null,
          venueId: original.venueId, scheduledAt: original.scheduledAt, durationMinutes: original.durationMinutes,
          scheduleLocked: original.scheduleLocked,
        }, data: { venueId: match.venueId, scheduledAt: match.scheduledAt, durationMinutes: match.durationMinutes,
          scheduleLocked: match.scheduleLocked, scheduleOverride: match.scheduleOverride, unscheduledReason: null } });
        if (result.count !== 1) throw new ConflictException('比赛安排或状态已变化，请刷新后重试');
      }
      await service.audit(tournamentId, 'MANUAL', plan.before.map(m => service.placement(m)), plan.changes.map(m => ({ ...service.placement(m), scheduleOverride: m.scheduleOverride })), actorId);
      return service.getSchedule(tournamentId);
    });
  }

  private async manualPlan(tournamentId: string, matchId: string, dto: UpdateMatchScheduleDto) {
    const [tournament, all, venues] = await Promise.all([
      this.ensureTournament(tournamentId), this.loadScheduleMatches(tournamentId), this.listVenues(tournamentId),
    ]);
    const selected = all.find(m => m.id === matchId);
    if (!selected) throw new NotFoundException('场次不存在');
    if (selected.status !== MatchStatus.PENDING || selected.startedAt) throw new ConflictException('只能调整尚未开始的比赛');
    const related = (selected.teamMatchId ? all.filter(m => m.teamMatchId === selected.teamMatchId) : [selected]).sort((a,b) => a.matchNo - b.matchNo);
    const before = related.filter(m => m.status === MatchStatus.PENDING && !m.startedAt);
    const fixed = related.filter(m => m.status === MatchStatus.LIVE || m.status === MatchStatus.COMPLETED || m.startedAt);
    const fixedIds = new Set(fixed.map(m => m.venueId).filter(Boolean));
    if (fixedIds.size > 1) throw new ConflictException('已开赛团体子项使用不同场地，请核对原排程');
    const fixedVenue = [...fixedIds][0];
    const venueId = dto.venueId !== undefined ? dto.venueId : fixedVenue ?? selected.venueId;
    if (fixedVenue && venueId !== fixedVenue) throw new ConflictException('团体对阵已有子项开赛，后续子项须继续使用同一场地');
    if (venueId && !venues.some(v => v.id === venueId && v.isActive)) throw new BadRequestException('请选择当前赛事已启用的场地');
    const settings = (tournament.schedulingSettings ?? {}) as { dailyStartTime?: string; dailyEndTime?: string; breakMinutes?: number; breakPeriods?: AutoScheduleDto['breakPeriods'] };
    const gap = settings.breakMinutes ?? tournament.breakMinutes;
    const window = this.parseDailyWindow(settings.dailyStartTime ?? tournament.dailyStartTime, settings.dailyEndTime ?? tournament.dailyEndTime, settings.breakPeriods);
    const parsed = dto.scheduledAt !== undefined || dto.scheduledAtLocal !== undefined
      ? this.parseNullableScheduleDate(dto.scheduledAt, dto.scheduledAtLocal, '比赛时间无效') : undefined;
    const reflow = parsed !== undefined || (dto.durationMinutes !== undefined && dto.durationMinutes !== selected.durationMinutes);
    const gaps = new Map(before.map((m, i) => {
      const next = before[i + 1];
      return [m.id, m.scheduledAt && next?.scheduledAt ? Math.max(0, (next.scheduledAt.getTime() - this.endTime(m).getTime()) / 60000) : gap];
    }));
    const ids = new Set(before.map(m => m.id));
    const others = all.filter(m => !ids.has(m.id));
    const lockOnly = dto.venueId === undefined && dto.scheduledAt === undefined && dto.scheduledAtLocal === undefined && dto.durationMinutes === undefined && dto.scheduleLocked !== undefined;
    const project = (court: string | null, start: Date | null | undefined, forceReflow = reflow) => {
      let cursor = start === undefined ? before[0].scheduledAt : start;
      return before.map(item => {
        const durationMinutes = item.id === matchId ? dto.durationMinutes ?? item.durationMinutes : item.durationMinutes;
        const scheduledAt = forceReflow ? cursor ?? null : item.scheduledAt;
        const full = Boolean(court && scheduledAt);
        const outside = Boolean(court && item.allowedVenueIds && !item.allowedVenueIds.includes(court));
        const match = { ...item, venueId: court, venueName: venues.find(v => v.id === court)?.name ?? null, scheduledAt, durationMinutes,
          scheduleLocked: full && (dto.scheduleLocked ?? true), scheduleOverride: outside && (dto.allowOutsideGroup === true || (item.scheduleOverride && item.venueId === court)), unscheduledReason: null };
        if (cursor) cursor = this.addMinutes(cursor, durationMinutes + (gaps.get(item.id) ?? gap));
        return match;
      });
    };
    const validate = (changes: ScheduleMatch[]): ConflictItem[] => {
      if (lockOnly) return [];
      const conflicts = this.detectPlacementConflicts([...others, ...changes], gap).filter(c => c.matchIds.some(id => ids.has(id)));
      if (selected.teamMatchId && changes[0]?.scheduledAt) {
        const lastFixed = fixed.filter(m => m.scheduledAt).sort((a, b) => this.endTime(b).getTime() - this.endTime(a).getTime())[0];
        const preservedGap = lastFixed?.scheduledAt && before[0]?.scheduledAt
          ? Math.max(0, before[0].scheduledAt.getTime() - this.endTime(lastFixed).getTime()) : gap * 60000;
        if (lastFixed && changes[0].scheduledAt.getTime() < this.endTime(lastFixed).getTime() + preservedGap) {
          conflicts.push({ type: 'DEPENDENCY', matchIds: [lastFixed.id, changes[0].id], message: '后续团体子项不能早于已开赛子项结束时间及原有间隔' });
        }
      }
      for (const m of changes) {
        if (!m.scheduledAt) continue;
        const t = m.scheduledAt.getTime();
        if (t < this.withMinutesOfDay(tournament.startDate, window.startMinutes).getTime() || this.endTime(m).getTime() > this.endOfDay(tournament.endDate).getTime() ||
          this.longestPlayableMinutes(window) < m.durationMinutes || this.normalizeToDailyWindow(t, m.durationMinutes, window) !== t) {
          conflicts.push({ type: 'DEPENDENCY', matchIds: [m.id], message: '比赛时间超出赛事日期、每日可用时段或跨越休息时段' });
        }
      }
      return conflicts;
    };
    let start = parsed;
    if (dto.findNextAvailable) {
      if (!venueId) throw new BadRequestException('请先选择场地');
      const minutes = before.reduce((sum, item, i) => sum + (item.id === matchId ? dto.durationMinutes ?? item.durationMinutes : item.durationMinutes) + (i < before.length - 1 ? gaps.get(item.id) ?? gap : 0), 0);
      if (minutes > this.longestPlayableMinutes(window)) throw new BadRequestException('本场团体对阵无法连续排入每日可用时段，请手动调整子项时间');
      const venueBusy = new Map<string, BusyInterval[]>([[venueId, []]]);
      const playerBusy = new Map<string, BusyInterval[]>();
      for (const m of others.filter(m => m.scheduledAt && m.status !== MatchStatus.CANCELLED)) {
        const interval = { start: m.scheduledAt!.getTime(), end: this.endTime(m).getTime() + gap * 60000 };
        if (m.venueId === venueId) this.addBusyInterval(venueBusy, venueId, interval);
        for (const player of this.matchPlayerIds(m)) this.addBusyInterval(playerBusy, player, interval);
      }
      const dependencyIds = before.flatMap(m => m.dependencyMatchIds);
      const dependencyEnd = Math.max(0, ...others.filter(m => dependencyIds.includes(m.id) || (selected.teamMatchId && m.teamMatchId === selected.teamMatchId)).filter(m => m.scheduledAt).map(m => this.endTime(m).getTime() + gap * 60000));
      const earliest = Math.max((parsed ?? before[0].scheduledAt ?? tournament.startDate).getTime(), this.withMinutesOfDay(tournament.startDate, window.startMinutes).getTime(), dependencyEnd);
      const found = this.findEarliestStart(venueId, earliest, minutes, gap, window, tournament.endDate, before.flatMap(m => this.matchPlayerIds(m)), venueBusy, playerBusy);
      if (found === null) throw new BadRequestException('赛事时间内无可用时段，请更换场地或延长时间');
      start = new Date(found);
    }
    const changes = project(venueId, start, reflow || dto.findNextAvailable);
    const conflicts = validate(changes);
    const outsideGroup = !lockOnly && changes.some(m => m.venueId && m.allowedVenueIds && !m.allowedVenueIds.includes(m.venueId) && !(before.find(b => b.id === m.id)?.scheduleOverride && before.find(b => b.id === m.id)?.venueId === m.venueId));
    const venueOptions = venues.filter(v => v.isActive).map(v => {
      const unavailable = fixedVenue && fixedVenue !== v.id ? '团体对阵已开赛，不能换场' : validate(project(v.id, start, reflow || dto.findNextAvailable))[0]?.message;
      return { id: v.id, name: v.name, inGroup: !selected.allowedVenueIds || selected.allowedVenueIds.includes(v.id), available: !unavailable, reason: unavailable ?? null };
    });
    return { before, changes, conflicts, outsideGroup, venueOptions };
  }

  private async loadScheduleMatches(tournamentId: string, eventId?: string) {
    const matches = await this.prisma.match.findMany({
      where: this.tournamentMatches(tournamentId, eventId),
      include: {
        event: { include: { group: { include: { allowedVenues: true } } } },
        teamCompetitionItem: true,
        teamMatch: { include: { team1: true, team2: true, teamCompetition: { include: { group: { include: { allowedVenues: true } } } } } },
        venue: true,
      },
      orderBy: [
        { scheduledAt: 'asc' },
        { roundNo: 'asc' },
        { matchNo: 'asc' },
      ],
    });
    const registrationMap = await this.registrationMap(
      matches.flatMap((match) => [match.side1Id, match.side2Id]),
    );
    const matchMap = new Map(
      matches
        .filter((match) => match.eventId)
        .map((match) => [this.matchKey(match.eventId!, match.roundNo, match.matchNo), match]),
    );

    // 场次按场地连续编号：matches 已按 scheduledAt 升序，故同一场地内依次为第1场、第2场……
    const venueSequence = new Map<string, number>();
    return matches.map<ScheduleMatch>((match) => {
      const dependencyMatchIds = this.dependencyMatches(match, matchMap).map((item) => item.id);
      const dependenciesReady = this.dependenciesReady(match, matchMap);
      // Dependency readiness is informational only — future-round matches can
      // be auto-scheduled before upstream finishes (autoSchedule projects the
      // release time from upstream scheduledAt + duration + break). We only
      // flag the truly inconsistent "COMPLETED without ready dependencies"
      // case as WAITING_SCHEDULE; everything else just tracks slot+time
      // assignment, which is what the bracket fill / referee actually depends
      // on.
      const hasFullSchedule = Boolean(match.scheduledAt && match.venueId);
      const scheduleStatus =
        match.status === MatchStatus.PENDING && !hasFullSchedule
          ? 'WAITING_SCHEDULE'
          : match.status === MatchStatus.COMPLETED && !dependenciesReady
            ? 'WAITING_SCHEDULE'
            : match.status;
      let venueOrder: number | null = null;
      if (match.venueId) {
        venueOrder = (venueSequence.get(match.venueId) ?? 0) + 1;
        venueSequence.set(match.venueId, venueOrder);
      }
      const group = match.event?.group ?? match.teamMatch?.teamCompetition.group;
      return {
        id: match.id,
        groupId: group?.id ?? null,
        groupName: group?.name ?? null,
        allowedVenueIds: group?.restrictVenues ? group.allowedVenues.map(v => v.venueId) : null,
        scheduleLocked: match.scheduleLocked,
        scheduleOverride: match.scheduleOverride,
        unscheduledReason: match.unscheduledReason,
        teamMatchId: match.teamMatchId,
        team1Id: match.teamMatch?.team1Id,
        team2Id: match.teamMatch?.team2Id,
        team1Name: match.teamMatch?.team1?.name,
        team2Name: match.teamMatch?.team2?.name,
        eventId: match.eventId,
        eventType: match.event?.type ?? 'TEAM_COMPETITION',
        eventTypeLabel: match.event ? (EVENT_TYPE_LABELS[match.event.type] ?? match.event.type) : `团体赛 · ${EVENT_TYPE_LABELS[match.teamCompetitionItem?.eventType ?? ''] ?? ''}`,
        round: match.round,
        roundNo: match.roundNo,
        matchNo: match.matchNo,
        venueSequence: venueOrder,
        side1Id: match.side1Id,
        side2Id: match.side2Id,
        side1: match.side1Id ? this.registrationView(registrationMap.get(match.side1Id) ?? null) : null,
        side2: match.side2Id ? this.registrationView(registrationMap.get(match.side2Id) ?? null) : null,
        status: match.status,
        venueId: match.venueId,
        venueName: match.venue?.name ?? null,
        scheduledAt: match.scheduledAt,
        durationMinutes: match.durationMinutes,
        startedAt: match.startedAt,
        finishedAt: match.finishedAt,
        dependenciesReady,
        dependencyMatchIds,
        scheduleStatus,
      };
    });
  }

  private detectConflicts(matches: ScheduleMatch[]) {
    const conflicts: ConflictItem[] = [];

    for (const match of matches) {
      // Real data inconsistency: a match was recorded as finished but the
      // upstream slot is no longer ready (e.g. an earlier match got reset).
      if (match.status === MatchStatus.COMPLETED && !match.dependenciesReady) {
        conflicts.push({
          type: 'DEPENDENCY',
          matchIds: [match.id],
          message: `${match.eventTypeLabel} ${match.round} 第${match.matchNo}场被标记为已结束，但前置比赛尚未完成`,
        });
        continue;
      }

      if (match.status !== MatchStatus.PENDING) continue;
      if (match.venueId && match.allowedVenueIds && !match.allowedVenueIds.includes(match.venueId) && !match.scheduleOverride) {
        conflicts.push({ type: 'GROUP_VENUE', matchIds: [match.id], message: `${match.groupName ?? '本组'}的场地规则已变化，本场需调整或明确设置为临时借场` });
      }

      // Future-round matches are allowed to lack side1/side2 — they will be
      // filled by advanceSingleEliminationWinner once upstream finishes. Only
      // surface UNSCHEDULED when neither a time slot nor a venue is assigned,
      // so admins still see what's truly waiting for a manual / auto slot.
      const lacksSchedule = !match.scheduledAt || !match.venueId;
      if (lacksSchedule) {
        conflicts.push({
          type: 'UNSCHEDULED',
          matchIds: [match.id],
          message: match.unscheduledReason ?? `${match.eventTypeLabel} ${match.round} 第${match.matchNo}场尚未分配时间和场地`,
        });
      }
    }

    const scheduled = matches.filter((match) => match.scheduledAt && match.venueId && match.status !== MatchStatus.CANCELLED);

    for (let i = 0; i < scheduled.length; i += 1) {
      for (let j = i + 1; j < scheduled.length; j += 1) {
        const a = scheduled[i];
        const b = scheduled[j];
        if (!this.overlaps(a, b)) continue;

        if (a.venueId && a.venueId === b.venueId) {
          conflicts.push({
            type: 'VENUE',
            matchIds: [a.id, b.id],
            message: `${a.venueName ?? '同一场地'} 同一时间段存在多场比赛`,
          });
        }

        const sharedPlayers = this.matchPlayerIds(a).filter((playerId) =>
          this.matchPlayerIds(b).includes(playerId),
        );
        if (sharedPlayers.length) {
          conflicts.push({
            type: 'PLAYER',
            matchIds: [a.id, b.id],
            message: '同一选手被安排在重叠时间段的多场比赛中',
          });
        }
      }
    }

    return conflicts;
  }

  private detectPlacementConflicts(matches: ScheduleMatch[], gap: number): ConflictItem[] {
    const conflicts = this.detectConflicts(matches).filter(c => c.type === 'VENUE' || c.type === 'PLAYER');
    const scheduled = matches.filter(m => m.scheduledAt && m.venueId && m.status !== MatchStatus.CANCELLED);
    for (const match of scheduled) {
      for (const dependencyId of match.dependencyMatchIds) {
        const dependency = matches.find(m => m.id === dependencyId);
        if (dependency && dependency.status !== MatchStatus.COMPLETED && !dependency.scheduledAt) {
          conflicts.push({ type: 'DEPENDENCY', matchIds: [dependency.id, match.id], message: '前置比赛尚未安排时间，不能安排后续比赛' });
        } else if (dependency?.scheduledAt && match.scheduledAt!.getTime() < this.endTime(dependency).getTime() + gap * 60000) {
          conflicts.push({ type: 'DEPENDENCY', matchIds: [dependency.id, match.id], message: '后续比赛早于前置比赛结束或未留足场间间隔，请调整时间或取消人工固定' });
        }
      }
    }
    for (let i = 0; i < scheduled.length; i++) {
      for (let j = i + 1; j < scheduled.length; j++) {
        const a = scheduled[i], b = scheduled[j];
        // Existing team encounter gaps are preserved by manual adjustments.
        const sameEncounter = a.teamMatchId && a.teamMatchId === b.teamMatchId;
        const overlapsWithGap = a.scheduledAt!.getTime() < this.endTime(b).getTime() + gap * 60000 && b.scheduledAt!.getTime() < this.endTime(a).getTime() + gap * 60000;
        if (!sameEncounter && a.venueId === b.venueId && overlapsWithGap && !this.overlaps(a,b)) {
          conflicts.push({ type: 'VENUE', matchIds: [a.id,b.id], message: `${a.venueName ?? '所选场地'}未留足场间间隔` });
        }
      }
    }
    return conflicts;
  }

  private findEarliestStart(
    venueId: string,
    earliest: number,
    matchMinutes: number,
    breakMinutes: number,
    dailyWindow: DailyWindow,
    tournamentEndDate: Date,
    playerIds: string[],
    venueBusy: Map<string, BusyInterval[]>,
    playerBusy: Map<string, BusyInterval[]>,
  ): number | null {
    let start = this.normalizeToDailyWindow(earliest, matchMinutes, dailyWindow);
    const latestEnd = this.endOfDay(tournamentEndDate).getTime();
    while (true) {
      if (start + matchMinutes * 60 * 1000 > latestEnd) {
        // 已无法在赛事结束日期前安排:返回 null,交由上层留空并标记为冲突。
        return null;
      }

      const venueConflict = this.findOverlap(venueBusy.get(venueId) ?? [], {
        start,
        end: start + (matchMinutes + breakMinutes) * 60 * 1000,
      });
      if (venueConflict) {
        start = this.normalizeToDailyWindow(venueConflict.end, matchMinutes, dailyWindow);
        continue;
      }

      const playerConflict = playerIds
        .flatMap((playerId) => playerBusy.get(playerId) ?? [])
        .sort((a, b) => a.start - b.start)
        .find((interval) =>
          this.intervalsOverlap(interval, {
            start,
            end: start + matchMinutes * 60 * 1000,
          }),
        );
      if (playerConflict) {
        start = this.normalizeToDailyWindow(playerConflict.end, matchMinutes, dailyWindow);
        continue;
      }

      return start;
    }
  }

  private dependencyReleaseTime<T extends {
    eventId: string | null;
    round?: string | null;
    roundNo: number;
    matchNo: number;
  }>(
    match: { eventId: string | null; round?: string | null; roundNo: number; matchNo: number },
    matchMap: Map<string, T>,
    scheduledEndByKey: Map<string, number>,
  ) {
    const dependencies = this.dependencyMatches(match, matchMap);
    if (!dependencies.length) return 0;
    return Math.max(
      ...dependencies.map((dependency) =>
        dependency.eventId
          ? scheduledEndByKey.get(this.matchKey(dependency.eventId, dependency.roundNo, dependency.matchNo)) ?? 0
          : 0,
      ),
    );
  }

  private isScheduleStageMatch(format: Format | null, roundNo: number, stage: ScheduleStage) {
    if (stage === 'all') return true;
    if (format === Format.SINGLE_ELIMINATION_PLUS_GROUP_RANKING) {
      return stage === 'first'
        ? roundNo >= 1 && roundNo < SECOND_STAGE_FORMAL_ROUND_NO_BASE
        : roundNo >= SECOND_STAGE_FORMAL_ROUND_NO_BASE;
    }
    if (stage === 'first') {
      return roundNo === 0;
    }
    if (format === Format.ROUND_ROBIN || format === Format.SINGLE_ELIMINATION) {
      return false;
    }
    return roundNo >= 1;
  }

  private parseScheduleDate(value: string, localValue: string | undefined, errorMessage: string) {
    const parsed = this.parseNullableScheduleDate(value, localValue, errorMessage);
    if (!parsed) throw new BadRequestException(errorMessage);
    return parsed;
  }

  private parseNullableScheduleDate(
    value: string | null | undefined,
    localValue: string | null | undefined,
    errorMessage: string,
  ) {
    if (localValue === null || value === null) return null;
    const local = localValue?.trim();
    if (local) {
      const parsedLocal = this.parseScheduleLocalDate(local);
      if (!parsedLocal) throw new BadRequestException(errorMessage);
      return parsedLocal;
    }
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(errorMessage);
    return parsed;
  }

  private parseScheduleLocalDate(value: string) {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4] ?? 0);
    const minute = Number(match[5] ?? 0);
    const second = Number(match[6] ?? 0);
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      return null;
    }
    return this.dateFromScheduleParts(year, month, day, hour * 60 + minute, second, 0);
  }

  private parseDailyWindow(
    startTime: string,
    endTime: string,
    breakPeriods: AutoScheduleDto['breakPeriods'] = [],
  ): DailyWindow {
    const startMinutes = this.timeToMinutes(startTime);
    const endMinutes = this.timeToMinutes(endTime);
    if (endMinutes <= startMinutes) {
      throw new BadRequestException('每日比赛结束时间必须晚于开始时间');
    }

    const parsedBreaks = (breakPeriods ?? [])
      .map((period) => {
        const start = this.timeToMinutes(period.startTime);
        const end = start + period.durationMinutes;
        if (start < startMinutes || end > endMinutes) {
          throw new BadRequestException('休息时段必须完整位于每日排程起止时间内');
        }
        return { start, end };
      })
      .sort((a, b) => a.start - b.start);

    for (let index = 1; index < parsedBreaks.length; index += 1) {
      if (parsedBreaks[index].start < parsedBreaks[index - 1].end) {
        throw new BadRequestException('休息时段不能重叠');
      }
    }

    return { startMinutes, endMinutes, breakPeriods: parsedBreaks };
  }

  private timeToMinutes(value: string) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) {
      throw new BadRequestException('每日比赛时段设置无效');
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new BadRequestException('每日比赛时段设置无效');
    }
    return hour * 60 + minute;
  }

  private normalizeToDailyWindow(timestamp: number, matchMinutes: number, window: DailyWindow) {
    let candidate = timestamp;
    while (true) {
      const date = new Date(candidate);
      const parts = this.scheduleDateParts(date);
      const minutes = parts.hour * 60 + parts.minute;
      if (minutes < window.startMinutes) {
        candidate = this.withMinutesOfDay(date, window.startMinutes).getTime();
        continue;
      }
      if (minutes + matchMinutes > window.endMinutes) {
        const nextDay = this.addScheduleDays(parts, 1);
        candidate = this.dateFromScheduleParts(
          nextDay.year,
          nextDay.month,
          nextDay.day,
          window.startMinutes,
        ).getTime();
        continue;
      }

      const overlappingBreak = window.breakPeriods.find(
        (period) => minutes < period.end && minutes + matchMinutes > period.start,
      );
      if (overlappingBreak) {
        candidate = this.withMinutesOfDay(date, overlappingBreak.end).getTime();
        continue;
      }
      return candidate;
    }
  }

  private longestPlayableMinutes(window: DailyWindow) {
    let longest = 0;
    let cursor = window.startMinutes;
    for (const period of window.breakPeriods) {
      longest = Math.max(longest, period.start - cursor);
      cursor = period.end;
    }
    return Math.max(longest, window.endMinutes - cursor);
  }

  private withMinutesOfDay(date: Date, minutes: number) {
    const parts = this.scheduleDateParts(date);
    return this.dateFromScheduleParts(parts.year, parts.month, parts.day, minutes);
  }

  private endOfDay(date: Date) {
    const parts = this.scheduleDateParts(date);
    return this.dateFromScheduleParts(parts.year, parts.month, parts.day, 23 * 60 + 59, 59, 999);
  }

  // 把时间戳折算成「比赛地自然日」的可比较序号,用于判断两个候选是否落在不同的比赛日。
  private dayKey(timestamp: number) {
    const { year, month, day } = this.scheduleDateParts(new Date(timestamp));
    return Date.UTC(year, month - 1, day);
  }

  private scheduleDateParts(date: Date) {
    const parts = new Map(scheduleDateTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]));
    const year = Number(parts.get('year') ?? date.getUTCFullYear());
    const month = Number(parts.get('month') ?? date.getUTCMonth() + 1);
    const day = Number(parts.get('day') ?? date.getUTCDate());
    const hour = Number(parts.get('hour') ?? date.getUTCHours()) % 24;
    const minute = Number(parts.get('minute') ?? date.getUTCMinutes());
    return { year, month, day, hour, minute };
  }

  private formatScheduleDateTime(date: Date) {
    const { year, month, day, hour, minute } = this.scheduleDateParts(date);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private dateFromScheduleParts(
    year: number,
    month: number,
    day: number,
    minutes: number,
    seconds = 0,
    milliseconds = 0,
  ) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return new Date(
      Date.UTC(year, month - 1, day, hour, minute, seconds, milliseconds) -
        SCHEDULE_TIME_ZONE_OFFSET_MINUTES * 60 * 1000,
    );
  }

  private addScheduleDays(parts: { year: number; month: number; day: number }, days: number) {
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    };
  }

  private findOverlap(intervals: BusyInterval[], target: BusyInterval) {
    return intervals
      .sort((a, b) => a.start - b.start)
      .find((interval) => this.intervalsOverlap(interval, target));
  }

  private intervalsOverlap(a: BusyInterval, b: BusyInterval) {
    return a.start < b.end && b.start < a.end;
  }

  private addBusyInterval(map: Map<string, BusyInterval[]>, key: string, interval: BusyInterval) {
    const intervals = map.get(key) ?? [];
    intervals.push(interval);
    intervals.sort((a, b) => a.start - b.start);
    map.set(key, intervals);
  }

  private dependenciesReady<T extends {
    eventId: string | null;
    round: string;
    roundNo: number;
    matchNo: number;
    status: MatchStatus;
    winnerSide: number | null;
  }>(
    match: { eventId: string | null; round?: string | null; roundNo: number; matchNo: number },
    matchMap: Map<string, T>,
  ) {
    if (!match.eventId) return true;
    if (isSecondStageFormalRoundNo(match.roundNo)) {
      const expectedDependencies = secondStageDependencyMatchNos(match.matchNo);
      if (!expectedDependencies.length) return true;
      const dependencies = this.dependencyMatches(match, matchMap);
      return dependencies.length === expectedDependencies.length && dependencies.every(
        (dependency) =>
          dependency?.status === MatchStatus.COMPLETED && Boolean(dependency.winnerSide),
      );
    }
    if (match.roundNo <= 1) return true;
    const dependencies = this.dependencyMatches(match, matchMap);
    return dependencies.length === 2 && dependencies.every(
      (dependency) =>
        dependency?.status === MatchStatus.COMPLETED && Boolean(dependency.winnerSide),
    );
  }

  private dependencyMatches<T extends { eventId: string | null; round?: string | null; roundNo: number; matchNo: number }>(
    match: { eventId: string | null; round?: string | null; roundNo: number; matchNo: number },
    matchMap: Map<string, T>,
  ) {
    if (!match.eventId) return [];
    if (isSecondStageFormalRoundNo(match.roundNo)) {
      return secondStageDependencyMatchNos(match.matchNo)
        .map((matchNo) =>
          matchMap.get(this.matchKey(match.eventId!, secondStageFormalRoundNo(matchNo), matchNo)),
        )
        .filter((item): item is T => Boolean(item));
    }
    if (match.roundNo <= 1) return [];
    if (match.round === 'BRONZE') {
      return [
        matchMap.get(this.matchKey(match.eventId, match.roundNo - 1, 1)),
        matchMap.get(this.matchKey(match.eventId, match.roundNo - 1, 2)),
      ].filter((item): item is T => Boolean(item));
    }
    return [
      matchMap.get(this.matchKey(match.eventId, match.roundNo - 1, match.matchNo * 2 - 1)),
      matchMap.get(this.matchKey(match.eventId, match.roundNo - 1, match.matchNo * 2)),
    ].filter((item): item is T => Boolean(item));
  }

  private matchKey(eventId: string, roundNo: number, matchNo: number) {
    return `${eventId}:${roundNo}:${matchNo}`;
  }

  private overlaps(a: ScheduleMatch, b: ScheduleMatch) {
    if (!a.scheduledAt || !b.scheduledAt) return false;
    return a.scheduledAt < this.endTime(b) && b.scheduledAt < this.endTime(a);
  }

  private endTime(match: ScheduleMatch) {
    return this.addMinutes(match.scheduledAt!, match.durationMinutes);
  }

  private addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }

  private matchPlayerIds(match: ScheduleMatch) {
    return [...(match.side1?.playerIds ?? []), ...(match.side2?.playerIds ?? []),
      ...[match.team1Id, match.team2Id].filter(Boolean).map(id => `team:${id}`)];
  }

  private playerIds(registration: any) {
    if (!registration) return [];
    if (registration.playerIds) return registration.playerIds as string[];
    return [registration.player1Id, registration.player2Id].filter(Boolean) as string[];
  }

  private async registrationMap(ids: Array<string | null>) {
    const compactIds = [...new Set(ids.filter(Boolean) as string[])];
    if (!compactIds.length) return new Map<string, any>();
    const registrations = await this.prisma.registration.findMany({
      where: { id: { in: compactIds.filter(id => !id.startsWith('lineup:')) } },
      include: { player1: true, player2: true },
    });
    const map = new Map<string, any>(registrations.map((registration) => [registration.id, registration]));
    const lineups = await new TeamCompetitionsService(this.prisma).buildLineupRegistrationMap(compactIds);
    for (const [key, value] of lineups) map.set(key, value);
    return map;
  }

  private registrationView(registration: any): RegistrationView | null {
    if (!registration) return null;
    if (registration.playerIds) return { id: registration.id, name: registration.name, affiliation: registration.affiliation, playerIds: registration.playerIds };
    return {
      id: registration.id,
      name: registration.player2
        ? `${registration.player1.name} / ${registration.player2.name}`
        : registration.player1.name,
      affiliation: registration.player2
        ? `${registration.player1.affiliation} / ${registration.player2.affiliation}`
        : registration.player1.affiliation,
      playerIds: this.playerIds(registration),
    };
  }

  private async resolveTeamMatchTournamentId(teamMatchId?: string | null) {
    if (!teamMatchId) throw new BadRequestException('无法确定该场次所属赛事');
    const teamMatch = await this.prisma.teamMatch.findUnique({
      where: { id: teamMatchId },
      include: { teamCompetition: true },
    });
    if (!teamMatch) throw new NotFoundException('团体赛对阵不存在');
    return teamMatch.teamCompetition.tournamentId;
  }

  private tournamentMatches(tournamentId: string, eventId?: string): Prisma.MatchWhereInput {
    if (eventId) return { event: { tournamentId, id: eventId } };
    return { OR: [{ event: { tournamentId } }, { teamMatch: { teamCompetition: { tournamentId } } }] };
  }

  private async ensureTournament(id: string) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id } });
    if (!tournament) throw new NotFoundException('赛事不存在');
    return tournament;
  }

  private async ensureVenue(id: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id } });
    if (!venue) throw new NotFoundException('场地不存在');
    return venue;
  }
}
