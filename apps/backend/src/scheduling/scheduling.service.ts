import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AutoScheduleDto, ClearScheduleDto, CreateVenueDto, UpdateMatchScheduleDto, UpdateVenueDto } from './dto/scheduling.dto';
import {
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

type RegistrationView = {
  id: string;
  name: string;
  affiliation: string;
  playerIds: string[];
};

type ScheduleMatch = {
  id: string;
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
  type: 'VENUE' | 'PLAYER' | 'DEPENDENCY' | 'UNSCHEDULED';
  matchIds: string[];
  message: string;
};

type BusyInterval = {
  start: number;
  end: number;
};

type DailyWindow = {
  startMinutes: number;
  endMinutes: number;
};

@Injectable()
export class SchedulingService {
  constructor(private prisma: PrismaService) {}

  listVenues(tournamentId: string) {
    return this.prisma.venue.findMany({
      where: { tournamentId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createVenue(tournamentId: string, dto: CreateVenueDto) {
    await this.ensureTournament(tournamentId);
    return this.prisma.venue.create({
      data: {
        tournamentId,
        name: dto.name,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateVenue(id: string, dto: UpdateVenueDto) {
    await this.ensureVenue(id);
    return this.prisma.venue.update({
      where: { id },
      data: dto,
    });
  }

  async removeVenue(id: string) {
    const venue = await this.ensureVenue(id);
    const linkedMatches = await this.prisma.match.count({ where: { venueId: id } });
    if (linkedMatches > 0) {
      return this.prisma.venue.update({
        where: { id },
        data: { isActive: false },
      });
    }
    return this.prisma.venue.delete({ where: { id: venue.id } });
  }

  async getSchedule(tournamentId: string, eventId?: string) {
    await this.ensureTournament(tournamentId);
    const [venues, matches] = await Promise.all([
      this.listVenues(tournamentId),
      this.loadScheduleMatches(tournamentId, eventId),
    ]);
    const conflicts = this.detectConflicts(matches);
    const conflictMap = new Map<string, ConflictItem[]>();
    for (const conflict of conflicts) {
      for (const matchId of conflict.matchIds) {
        const list = conflictMap.get(matchId) ?? [];
        list.push(conflict);
        conflictMap.set(matchId, list);
      }
    }

    return {
      venues,
      matches: matches.map((match) => ({
        ...match,
        scheduledAt: match.scheduledAt?.toISOString() ?? null,
        startedAt: match.startedAt?.toISOString() ?? null,
        finishedAt: match.finishedAt?.toISOString() ?? null,
        conflicts: conflictMap.get(match.id) ?? [],
      })),
      conflicts,
    };
  }

  async autoSchedule(dto: AutoScheduleDto) {
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

    const startAt = new Date(dto.startAt);
    if (Number.isNaN(startAt.getTime())) throw new BadRequestException('开始时间无效');
    const matchMinutes = dto.matchMinutes ?? tournament.defaultMatchMinutes;
    const breakMinutes = dto.breakMinutes ?? tournament.breakMinutes;
    const dailyWindow = this.parseDailyWindow(tournament.dailyStartTime, tournament.dailyEndTime);
    if (dailyWindow.endMinutes - dailyWindow.startMinutes < matchMinutes) {
      throw new BadRequestException('每日比赛时段不足以安排一场比赛');
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
      where: {
        event: {
          tournamentId: dto.tournamentId,
          ...(dto.eventId ? { id: dto.eventId } : {}),
        },
      },
      include: { event: true },
      orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
    });
    if (!scopeMatches.length) throw new BadRequestException('暂无可排程场次，请先完成抽签编排');

    const matchMap = new Map(
      scopeMatches
        .filter((match) => match.eventId)
        .map((match) => [this.matchKey(match.eventId!, match.roundNo, match.matchNo), match]),
    );
    const invalidCompletedIds = scopeMatches
      .filter(
        (match) =>
          match.status === MatchStatus.COMPLETED && !this.dependenciesReady(match, matchMap),
      )
      .map((match) => match.id);
    const allScheduled = await this.loadScheduleMatches(dto.tournamentId);
    const adjustableIds = new Set(
      [
        ...scopeMatches
          .filter((match) => match.status === MatchStatus.PENDING)
          .map((match) => match.id),
        ...invalidCompletedIds,
      ],
    );
    const anchors = allScheduled.filter(
      (match) => !adjustableIds.has(match.id) && Boolean(match.scheduledAt),
    );

    // 借场:本次排程限定了「固定场地」(venueIds)时,其余启用场地里已经被其他项目占用、
    // 之后空出来的时段可供本次溢出的场次借用——前提仍是落在每日时段内且选手不冲突。
    // 只借「已经有其他项目落位」的场地(anchoredVenueIds),避免把尚未排程项目预留的空场抢走。
    const homeVenueIds = new Set(venues.map((venue) => venue.id));
    const anchoredVenueIds = new Set(
      anchors.map((anchor) => anchor.venueId).filter((id): id is string => Boolean(id)),
    );
    const borrowVenues = dto.venueIds?.length
      ? (
          await this.prisma.venue.findMany({
            where: { tournamentId: dto.tournamentId, isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          })
        ).filter((venue) => !homeVenueIds.has(venue.id) && anchoredVenueIds.has(venue.id))
      : [];

    const venueBusy = new Map<string, BusyInterval[]>(
      [...venues, ...borrowVenues].map((venue) => [venue.id, []]),
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
    for (const anchor of anchors) {
      if (!anchor.eventId || !anchor.scheduledAt) continue;
      scheduledEndByKey.set(
        this.matchKey(anchor.eventId, anchor.roundNo, anchor.matchNo),
        this.addMinutes(anchor.scheduledAt, anchor.durationMinutes + breakMinutes).getTime(),
      );
    }

    const schedulableMatches = scopeMatches
      .filter((match) => match.status === MatchStatus.PENDING)
      .sort((a, b) => {
        const stagePriority = (dto.prioritizeSecondStage ?? true)
          ? Number(!isSecondStageFormalRoundNo(a.roundNo)) -
            Number(!isSecondStageFormalRoundNo(b.roundNo))
          : 0;
        const aRank = eventTypeRank.get(a.event?.type ?? '') ?? Number.MAX_SAFE_INTEGER;
        const bRank = eventTypeRank.get(b.event?.type ?? '') ?? Number.MAX_SAFE_INTEGER;
        return stagePriority || aRank - bRank || a.roundNo - b.roundNo || a.matchNo - b.matchNo;
      });

    const updates: Array<{ matchId: string; venueId: string; scheduledAt: Date; minutes: number }> = [];
    for (const match of schedulableMatches) {
      const playerIds = [
        ...this.playerIds(registrationMap.get(match.side1Id!)),
        ...this.playerIds(registrationMap.get(match.side2Id!)),
      ];
      const perMatchMinutes = matchMinutes;
      const dependencyReleaseTime = this.dependencyReleaseTime(match, matchMap, scheduledEndByKey);
      const earliestMatchStart = Math.max(earliestScheduleStart, dependencyReleaseTime);
      const candidates = [
        ...venues.map((venue) => ({ venue, isBorrow: false })),
        ...borrowVenues.map((venue) => ({ venue, isBorrow: true })),
      ]
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
      // 借场后仍排不下(超出赛事结束日期)的场次留空,交由冲突检测标记为「待排程」,不再中断整批排程。
      if (!candidates.length) continue;
      // 先比「最早能排到哪一天」:固定场地只要当天还排得下,就优先用固定场地;
      // 只有当固定场地会把这场挤到更晚的某一天、而借用场地当天还排得下时,才借场。
      // 同一天内再优先固定场地、然后比最早时间、最后比场地序号。
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

    const resetData: Prisma.MatchUncheckedUpdateManyInput = {
      venueId: null,
      scheduledAt: null,
      durationMinutes: matchMinutes,
    };

    await this.prisma.$transaction([
      this.prisma.match.updateMany({
        where: { id: { in: [...adjustableIds] } },
        data: resetData,
      }),
      this.prisma.match.updateMany({
        where: { id: { in: invalidCompletedIds } },
        data: {
          status: MatchStatus.PENDING,
          winnerSide: null,
        },
      }),
      ...updates.map((update) =>
        this.prisma.match.update({
          where: { id: update.matchId },
          data: {
            venueId: update.venueId,
            scheduledAt: update.scheduledAt,
            durationMinutes: update.minutes,
          },
        }),
      ),
    ]);

    return this.getSchedule(dto.tournamentId, dto.eventId);
  }

  /**
   * 取消场地排程:把所选范围内「未开始」场次的场地与时间清空,使其回到待排程状态。
   * 自动排程的逆操作。只清空 PENDING 场次,已完赛 / 进行中的场次(及其结果、所在场地)保持不动,
   * 这样清空后重新自动排程时它们仍作为锚点被避让。durationMinutes(单场预估时长)保留。
   */
  async clearSchedule(dto: ClearScheduleDto) {
    await this.ensureTournament(dto.tournamentId);
    const matches = await this.prisma.match.findMany({
      where: {
        status: MatchStatus.PENDING,
        event: {
          tournamentId: dto.tournamentId,
          ...(dto.eventId ? { id: dto.eventId } : {}),
        },
      },
      select: { id: true },
    });
    const ids = matches.map((match) => match.id);
    if (ids.length) {
      await this.prisma.match.updateMany({
        where: { id: { in: ids } },
        data: { venueId: null, scheduledAt: null },
      });
    }
    return this.getSchedule(dto.tournamentId, dto.eventId);
  }

  async updateMatchSchedule(matchId: string, dto: UpdateMatchScheduleDto) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { event: true },
    });
    if (!match) throw new NotFoundException('场次不存在');

    if (dto.venueId) {
      const venue = await this.prisma.venue.findUnique({ where: { id: dto.venueId } });
      if (!venue || !venue.isActive || (match.eventId && match.event && venue.tournamentId !== match.event.tournamentId)) {
        throw new BadRequestException('请选择当前赛事下已启用的场地');
      }
    }

    await this.prisma.match.update({
      where: { id: matchId },
      data: {
        ...(dto.venueId !== undefined ? { venueId: dto.venueId } : {}),
        ...(dto.scheduledAt !== undefined
          ? { scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null }
          : {}),
        ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
      },
    });

    const fallbackTournamentId = match.event?.tournamentId ?? (await this.resolveTeamMatchTournamentId(match.teamMatchId));
    return this.getSchedule(fallbackTournamentId, match.eventId ?? undefined);
  }

  private async loadScheduleMatches(tournamentId: string, eventId?: string) {
    const matches = await this.prisma.match.findMany({
      where: {
        event: {
          tournamentId,
          ...(eventId ? { id: eventId } : {}),
        },
      },
      include: {
        event: true,
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
      return {
        id: match.id,
        eventId: match.eventId,
        eventType: match.event?.type ?? 'TEAM_COMPETITION',
        eventTypeLabel: match.event ? (EVENT_TYPE_LABELS[match.event.type] ?? match.event.type) : '团体赛',
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

      // Future-round matches are allowed to lack side1/side2 — they will be
      // filled by advanceSingleEliminationWinner once upstream finishes. Only
      // surface UNSCHEDULED when neither a time slot nor a venue is assigned,
      // so admins still see what's truly waiting for a manual / auto slot.
      const lacksSchedule = !match.scheduledAt || !match.venueId;
      if (lacksSchedule) {
        conflicts.push({
          type: 'UNSCHEDULED',
          matchIds: [match.id],
          message: `${match.eventTypeLabel} ${match.round} 第${match.matchNo}场尚未分配时间和场地`,
        });
      }
    }

    const scheduled = matches.filter((match) => match.scheduledAt && match.venueId);

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

  private parseDailyWindow(startTime: string, endTime: string): DailyWindow {
    const startMinutes = this.timeToMinutes(startTime);
    const endMinutes = this.timeToMinutes(endTime);
    if (endMinutes <= startMinutes) {
      throw new BadRequestException('每日比赛结束时间必须晚于开始时间');
    }
    return { startMinutes, endMinutes };
  }

  private timeToMinutes(value: string) {
    const [hour, minute] = value.split(':').map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      throw new BadRequestException('每日比赛时段设置无效');
    }
    return hour * 60 + minute;
  }

  private normalizeToDailyWindow(timestamp: number, matchMinutes: number, window: DailyWindow) {
    const date = new Date(timestamp);
    const minutes = date.getHours() * 60 + date.getMinutes();
    if (minutes < window.startMinutes) {
      return this.withMinutesOfDay(date, window.startMinutes).getTime();
    }
    if (minutes + matchMinutes > window.endMinutes) {
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      return this.withMinutesOfDay(nextDay, window.startMinutes).getTime();
    }
    return timestamp;
  }

  private withMinutesOfDay(date: Date, minutes: number) {
    const next = new Date(date);
    next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return next;
  }

  private endOfDay(date: Date) {
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return end;
  }

  // 把时间戳折算成「本地自然日」的可比较序号,用于判断两个候选是否落在不同的比赛日。
  private dayKey(timestamp: number) {
    const date = new Date(timestamp);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
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
    return [...(match.side1?.playerIds ?? []), ...(match.side2?.playerIds ?? [])];
  }

  private playerIds(registration: any) {
    if (!registration) return [];
    return [registration.player1Id, registration.player2Id].filter(Boolean) as string[];
  }

  private async registrationMap(ids: Array<string | null>) {
    const compactIds = [...new Set(ids.filter(Boolean) as string[])];
    if (!compactIds.length) return new Map<string, any>();
    const registrations = await this.prisma.registration.findMany({
      where: { id: { in: compactIds } },
      include: { player1: true, player2: true },
    });
    return new Map(registrations.map((registration) => [registration.id, registration]));
  }

  private registrationView(registration: any): RegistrationView | null {
    if (!registration) return null;
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
