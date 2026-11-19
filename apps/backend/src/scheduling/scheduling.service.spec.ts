import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulingService, normalizePlayDates } from './scheduling.service';
import type { AutoScheduleDto } from './dto/scheduling.dto';

type TestDailyWindow = {
  startMinutes: number;
  endMinutes: number;
  breakPeriods: Array<{ start: number; end: number }>;
};

type SchedulingInternals = {
  parseDailyWindow(
    startTime: string,
    endTime: string,
    breakPeriods?: Array<{ startTime: string; durationMinutes: number }>,
  ): TestDailyWindow;
  normalizeToDailyWindow(
    timestamp: number,
    matchMinutes: number,
    window: TestDailyWindow,
  ): number;
  longestPlayableMinutes(window: TestDailyWindow): number;
};

describe('SchedulingService daily scheduling window', () => {
  const service = new SchedulingService({} as PrismaService);
  const internals = service as unknown as SchedulingInternals;

  it('moves a match that overlaps lunch to the end of the break', () => {
    const window = internals.parseDailyWindow('08:00', '18:00', [
      { startTime: '12:00', durationMinutes: 60 },
    ]);
    const start = new Date('2026-09-26T03:30:00.000Z').getTime(); // 11:30 in Asia/Shanghai

    const result = internals.normalizeToDailyWindow(start, 60, window);

    expect(new Date(result).toISOString()).toBe('2026-09-26T05:00:00.000Z');
  });

  it('continues on the next day when the match does not fit before the daily end time', () => {
    const window = internals.parseDailyWindow('08:00', '18:00');
    const start = new Date('2026-09-26T09:30:00.000Z').getTime(); // 17:30 in Asia/Shanghai

    const result = internals.normalizeToDailyWindow(start, 60, window);

    expect(new Date(result).toISOString()).toBe('2026-09-27T00:00:00.000Z');
  });

  it('uses the longest continuous slot when validating whether a match can fit', () => {
    const window = internals.parseDailyWindow('08:00', '18:00', [
      { startTime: '12:00', durationMinutes: 60 },
      { startTime: '16:00', durationMinutes: 30 },
    ]);

    expect(internals.longestPlayableMinutes(window)).toBe(240);
  });

  it('rejects overlapping break periods', () => {
    expect(() =>
      internals.parseDailyWindow('08:00', '18:00', [
        { startTime: '12:00', durationMinutes: 60 },
        { startTime: '12:30', durationMinutes: 30 },
      ]),
    ).toThrow(BadRequestException);
  });
});

describe('manual team court adjustments', () => {
  function setup() {
    const matches = [0, 10, 20].map((minutes, index) => ({
      id: `m${index}`, matchNo: index + 1, roundNo: 1, round: 'F', teamMatchId: 'encounter', eventId: null,
      teamMatch: { teamCompetitionId: 'competition', teamCompetition: { tournamentId: 't', group: null }, team1Id: 'team1', team2Id: 'team2' },
      event: null, status: 'PENDING', startedAt: null, finishedAt: null, side1Id: null, side2Id: null,
      venueId: 'court1', venue: { name: '1号场' }, durationMinutes: 10,
      scheduleLocked: false, scheduleOverride: false, unscheduledReason: null,
      scheduledAt: new Date(Date.UTC(2026, 9, 22, 0, minutes)),
    }));
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      match: {
        findUnique: jest.fn().mockImplementation(({ where }) => matches.find(m => m.id === where.id)),
        findMany: jest.fn().mockResolvedValue(matches),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tournament: { findUnique: jest.fn().mockResolvedValue({ id: 't', breakMinutes: 10, startDate: new Date('2026-10-21T16:00:00Z'), endDate: new Date('2026-10-22T15:59:00Z'), dailyStartTime: '08:00', dailyEndTime: '18:00' }) },
      venue: { findMany: jest.fn().mockResolvedValue(['court1', 'court4'].map(id => ({ id, name: id, isActive: true, tournamentId: 't' }))) },
      teamMatch: { findUnique: jest.fn().mockResolvedValue({ teamCompetition: { tournamentId: 't' } }) },
      teamCompetition: { findMany: jest.fn().mockResolvedValue([]) },
      tournamentGroup: { findMany: jest.fn().mockResolvedValue([]) },
      event: { count: jest.fn().mockResolvedValue(0) },
      scheduleOperationLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(callback => callback(prisma));
    const gateway = { emitBracketUpdate: jest.fn() };
    const service = new SchedulingService(prisma as unknown as PrismaService, gateway as never);
    return { service, tx: prisma, matches, gateway };
  }
  it('moves every pending child while preserving times and fixes the entire encounter', async () => {
    const { service, tx, matches, gateway } = setup();
    await service.updateMatchSchedule('m0', { venueId: 'court4' });
    expect(tx.match.updateMany).toHaveBeenCalledTimes(3);
    for (const [index, [update]] of tx.match.updateMany.mock.calls.entries()) {
      expect(update.data.venueId).toBe('court4');
      expect(update.data.scheduledAt).toEqual(matches[index].scheduledAt);
      expect(update.data.scheduleLocked).toBe(true);
    }
    expect(gateway.emitBracketUpdate).toHaveBeenCalledTimes(1);
  });
  it('shifts times while preserving the zero-minute gap chosen in automatic scheduling', async () => {
    const { service, tx } = setup();
    await service.updateMatchSchedule('m0', { venueId: 'court4', scheduledAt: '2026-10-22T01:00:00.000Z' });
    expect(tx.match.updateMany.mock.calls.map(([update]) => update.data.scheduledAt.toISOString()))
      .toEqual(['2026-10-22T01:00:00.000Z', '2026-10-22T01:10:00.000Z', '2026-10-22T01:20:00.000Z']);
  });
  it('rejects changing courts after any child has started, without writes or broadcasts', async () => {
    const { service, tx, matches, gateway } = setup();
    matches[0].status = 'LIVE';
    await expect(service.updateMatchSchedule('m1', { venueId: 'court4' })).rejects.toThrow('继续使用同一场地');
    expect(tx.match.updateMany).not.toHaveBeenCalled();
    expect(gateway.emitBracketUpdate).not.toHaveBeenCalled();
  });
  it('rejects moving remaining children before the started child', async () => {
    const { service, tx, matches } = setup();
    matches[0].status = 'LIVE';
    for (const m of matches) m.scheduledAt = new Date(m.scheduledAt.getTime() + 30 * 60000);
    await expect(service.updateMatchSchedule('m1', { scheduledAt: '2026-10-22T00:00:00.000Z' })).rejects.toThrow('后续团体子项');
    expect(tx.match.updateMany).not.toHaveBeenCalled();
  });
  it('rejects an overlapping encounter on the destination court', async () => {
    const { service, tx, matches } = setup();
    matches.push({ ...matches[0], id: 'other', venueId: 'court4', teamMatchId: 'other-encounter', teamMatch: { ...matches[0].teamMatch, team1Id: 'other1', team2Id: 'other2' } });
    await expect(service.updateMatchSchedule('m0', { venueId: 'court4' })).rejects.toThrow('同一时间段');
    expect(tx.match.updateMany).not.toHaveBeenCalled();
  });
  it('detects shared participants across different courts', async () => {
    const { service, tx, matches } = setup();
    matches.push({ ...matches[0], id: 'other', teamMatchId: 'other-encounter' });
    await expect(service.updateMatchSchedule('m0', { venueId: 'court4' })).rejects.toThrow('同一选手');
    expect(tx.match.updateMany).not.toHaveBeenCalled();
  });
  it('preview never writes or broadcasts', async () => {
    const { service, tx, gateway } = setup();
    const result = await service.previewMatchSchedule('m0', { venueId: 'court4' });
    expect(result.changes).toHaveLength(3);
    expect(tx.match.updateMany).not.toHaveBeenCalled();
    expect(gateway.emitBracketUpdate).not.toHaveBeenCalled();
  });
  it('does not publish a failed transaction', async () => {
    const { service, tx, gateway } = setup();
    tx.$transaction.mockRejectedValueOnce(new Error('rollback'));
    await expect(service.updateMatchSchedule('m0', { venueId: 'court4' })).rejects.toThrow('rollback');
    expect(gateway.emitBracketUpdate).not.toHaveBeenCalled();
  });
});

describe('group play dates', () => {
  type DateInternals = {
    parseDailyWindow(startTime: string, endTime: string): TestDailyWindow;
    normalizeToDailyWindow(timestamp: number, matchMinutes: number, window: TestDailyWindow, allowedDays?: string[] | null): number;
    tournamentDays(tournament: { startDate: Date; endDate: Date }): string[];
  };
  const internals = new SchedulingService({} as PrismaService) as unknown as DateInternals;
  const window = internals.parseDailyWindow('08:00', '18:00');

  it('jumps to the start of the next allowed day', () => {
    const start = new Date('2026-09-26T01:00:00.000Z').getTime(); // 09-26 09:00 in Asia/Shanghai
    const result = internals.normalizeToDailyWindow(start, 60, window, ['2026-09-28']);
    expect(new Date(result).toISOString()).toBe('2026-09-28T00:00:00.000Z'); // 09-28 08:00
  });

  it('keeps a time that is already on an allowed day', () => {
    const start = new Date('2026-09-26T01:00:00.000Z').getTime();
    expect(internals.normalizeToDailyWindow(start, 60, window, ['2026-09-26', '2026-09-28'])).toBe(start);
  });

  it('skips disallowed days when the match no longer fits today', () => {
    const start = new Date('2026-09-26T09:30:00.000Z').getTime(); // 09-26 17:30
    const result = internals.normalizeToDailyWindow(start, 60, window, ['2026-09-26', '2026-09-28']);
    expect(new Date(result).toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });

  it('returns Infinity when no allowed day is left', () => {
    const start = new Date('2026-09-26T01:00:00.000Z').getTime();
    expect(internals.normalizeToDailyWindow(start, 60, window, ['2026-09-25'])).toBe(Number.POSITIVE_INFINITY);
  });

  it('lists every tournament day in Asia/Shanghai', () => {
    expect(internals.tournamentDays({
      startDate: new Date('2026-11-14T16:00:00.000Z'), // 11-15 00:00
      endDate: new Date('2026-11-16T15:59:59.999Z'), // 11-16 23:59
    })).toEqual(['2026-11-15', '2026-11-16']);
  });

  it('normalizes stored play dates', () => {
    expect(normalizePlayDates(['2026-11-16', '2026-11-15', '2026-11-15', 'x', 3])).toEqual(['2026-11-15', '2026-11-16']);
    expect(normalizePlayDates([])).toBeNull();
    expect(normalizePlayDates(null)).toBeNull();
  });
});

describe('scheduling with group play dates', () => {
  // 赛事 10-22、10-23 两天（比赛地时间）；乙组不限日期。每个用例自己建组别，互不影响。
  function makeGroups(g1Days: string[] | null) {
    return {
      g1: { id: 'g1', name: '甲组', restrictVenues: false, allowedVenues: [], events: [], playDates: g1Days },
      g2: { id: 'g2', name: '乙组', restrictVenues: false, allowedVenues: [], events: [], playDates: null as string[] | null },
    };
  }
  type Group = ReturnType<typeof makeGroups>['g1'];
  function baseMatch(id: string, matchNo: number, group: Group) {
    return {
      id, matchNo, roundNo: 1, round: 'R1', teamMatchId: null, teamMatch: null, teamCompetitionItem: null, eventId: `e-${group.id}`,
      event: { id: `e-${group.id}`, tournamentId: 't', groupId: group.id, type: 'MENS_SINGLES', format: 'SINGLE_ELIMINATION',
        venueRule: 'INHERIT', allowedVenues: [], defaultMatchMinutes: null, group },
      status: 'PENDING', startedAt: null, finishedAt: null, side1Id: null, side2Id: null, winnerSide: null,
      venueId: null as string | null, venue: null, durationMinutes: 30, updatedAt: new Date('2026-10-01T00:00:00Z'),
      scheduleLocked: false, scheduleOverride: false, dateOverride: false, unscheduledReason: null,
      scheduledAt: null as Date | null,
    };
  }
  type MockMatch = ReturnType<typeof baseMatch>;
  const match = (id: string, matchNo: number, group: Group, extra: Partial<MockMatch> = {}): MockMatch => ({ ...baseMatch(id, matchNo, group), ...extra });
  function setup(groups: ReturnType<typeof makeGroups>, matches: MockMatch[]) {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      match: {
        findUnique: jest.fn().mockImplementation(({ where }) => matches.find(m => m.id === where.id)),
        findMany: jest.fn().mockResolvedValue(matches),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tournament: { findUnique: jest.fn().mockResolvedValue({ id: 't', defaultMatchMinutes: 30, breakMinutes: 10,
        startDate: new Date('2026-10-21T16:00:00Z'), endDate: new Date('2026-10-23T15:59:00Z'), dailyStartTime: '08:00', dailyEndTime: '18:00' }) },
      venue: { findMany: jest.fn().mockResolvedValue([{ id: 'court1', name: '1号场', isActive: true, tournamentId: 't', sortOrder: 0 }]) },
      teamCompetition: { findMany: jest.fn().mockResolvedValue([]) },
      tournamentGroup: { findMany: jest.fn().mockResolvedValue(Object.values(groups)) },
      event: { count: jest.fn().mockResolvedValue(2) },
      scheduleOperationLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(callback => callback(prisma));
    const service = new SchedulingService(prisma as unknown as PrismaService, { emitBracketUpdate: jest.fn() } as never);
    return { service, tx: prisma };
  }
  const placed = (at: string) => ({ venueId: 'court1', scheduledAt: new Date(at) });

  it('auto schedule keeps a group on its dates and reports when they are full', async () => {
    const groups = makeGroups(['2026-10-23']);
    const { service } = setup(groups, [
      match('a1', 1, groups.g1, { durationMinutes: 600 }),
      match('a2', 2, groups.g1, { durationMinutes: 600 }),
      match('b1', 1, groups.g2),
    ]);
    const result = (await service.autoSchedule({ tournamentId: 't', startAt: '2026-10-22T00:00:00.000Z', preview: true })) as unknown as {
      preview: { matches: Array<{ id: string; scheduledAt: string | null }>; unscheduled: Array<{ matchId: string; reason: string }> };
    };
    const at = (id: string) => result.preview.matches.find(m => m.id === id)?.scheduledAt;
    expect(at('a1')).toBe('2026-10-23T00:00:00.000Z'); // 甲组只排 10-23
    expect(at('b1')).toBe('2026-10-22T00:00:00.000Z'); // 乙组不限，排在第一天
    expect(result.preview.unscheduled).toEqual([{ matchId: 'a2', reason: expect.stringContaining('甲组的比赛日期（10月23日）内已无空位') }]);
  });

  it('asks for confirmation before moving a match to a day outside the group dates', async () => {
    const groups = makeGroups(['2026-10-22']);
    const { service, tx } = setup(groups, [match('a1', 1, groups.g1, placed('2026-10-22T01:00:00Z'))]);
    await expect(service.updateMatchSchedule('a1', { scheduledAtLocal: '2026-10-23 09:00' }))
      .rejects.toThrow('所选日期不在甲组的比赛日期（10月22日）内');
    expect(tx.match.updateMany).not.toHaveBeenCalled();
  });

  it('saves a confirmed move as 临时改期 and clears it when moved back', async () => {
    const groups = makeGroups(['2026-10-22']);
    const first = setup(groups, [match('a1', 1, groups.g1, placed('2026-10-22T01:00:00Z'))]);
    await first.service.updateMatchSchedule('a1', { scheduledAtLocal: '2026-10-23 09:00', allowOutsideGroup: true });
    expect(first.tx.match.updateMany.mock.calls[0][0].data.dateOverride).toBe(true);

    const second = setup(groups, [match('a1', 1, groups.g1, { ...placed('2026-10-23T01:00:00Z'), dateOverride: true })]);
    await second.service.updateMatchSchedule('a1', { scheduledAtLocal: '2026-10-22 10:00' });
    expect(second.tx.match.updateMany.mock.calls[0][0].data.dateOverride).toBe(false);
  });

  it('does not ask again when the match stays on its current day, and keeps flagging it', async () => {
    const groups = makeGroups(['2026-10-22']);
    const { service, tx } = setup(groups, [match('a1', 1, groups.g1, placed('2026-10-23T01:00:00Z'))]);
    const schedule = await service.getSchedule('t');
    expect(schedule.tournamentDays).toEqual(['2026-10-22', '2026-10-23']);
    expect(schedule.matches[0].conflicts.map(c => c.type)).toContain('GROUP_DATE');
    await service.updateMatchSchedule('a1', { scheduledAtLocal: '2026-10-23 10:00' });
    expect(tx.match.updateMany.mock.calls[0][0].data.dateOverride).toBe(false);
  });

  it('finds the next available time only within the group dates', async () => {
    const groups = makeGroups(['2026-10-22']);
    const { service } = setup(groups, [
      match('a1', 1, groups.g1, placed('2026-10-22T01:00:00Z')),
      // 乙组占满 1 号场 10-22 全天；10-23 不是甲组的比赛日期。
      match('b1', 1, groups.g2, { ...placed('2026-10-22T00:00:00Z'), durationMinutes: 600 }),
    ]);
    await expect(service.previewMatchSchedule('a1', { venueId: 'court1', findNextAvailable: true }))
      .rejects.toThrow('甲组的比赛日期（10月22日）内没有可用时段');
  });
});

describe('auto schedule by stage, player rest and keeping placed matches', () => {
  // 赛事 10-22、10-23 两天（比赛地时间 08:00–18:00 = 00:00–10:00Z），每场 30 分钟、场间间隔 10 分钟。
  const group = { id: 'g1', name: '甲组', restrictVenues: false, allowedVenues: [], events: [], playDates: null as string[] | null };
  type Extra = Record<string, unknown>;
  function eventMatch(id: string, eventId: string, format: string, roundNo: number, matchNo: number, extra: Extra = {}) {
    return {
      id, matchNo, roundNo, round: roundNo === 0 ? 'A' : 'R1', teamMatchId: null as string | null, teamMatch: null as unknown, teamCompetitionItem: null as unknown, eventId: eventId as string | null,
      event: { id: eventId, tournamentId: 't', groupId: 'g1', type: 'MENS_SINGLES', format, venueRule: 'INHERIT', allowedVenues: [], defaultMatchMinutes: null, group } as unknown,
      status: 'PENDING', startedAt: null, finishedAt: null, side1Id: null as string | null, side2Id: null as string | null, winnerSide: null,
      venueId: null as string | null, venue: null, durationMinutes: 30, updatedAt: new Date('2026-10-01T00:00:00Z'),
      scheduleLocked: false, scheduleOverride: false, dateOverride: false, unscheduledReason: null,
      scheduledAt: null as Date | null,
      ...extra,
    };
  }
  type MockMatch = ReturnType<typeof eventMatch>;
  function teamMatch(id: string, format: string, stage: string, roundNo: number) {
    const encounter = { id: `tm-${id}`, teamCompetitionId: 'tc1', team1Id: `${id}-T1`, team2Id: `${id}-T2`, stage, roundNo,
      teamCompetition: { id: 'tc1', format, groupId: 'g1', group }, team1: { name: '甲队' }, team2: { name: '乙队' } };
    return eventMatch(id, '', 'ROUND_ROBIN', roundNo, 1, { eventId: null, event: null, teamMatchId: encounter.id, teamMatch: encounter, teamCompetitionItem: { eventType: 'MENS_DOUBLES' } });
  }
  const registrations = ['r1:p1', 'r2:p2', 'r3:p1', 'r4:p4'].map(item => {
    const [id, playerId] = item.split(':');
    return { id, player1Id: playerId, player2Id: null, player1: { name: playerId, affiliation: '' }, player2: null };
  });
  function setup(matches: MockMatch[], courts = 1) {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      match: {
        findUnique: jest.fn().mockImplementation(({ where }) => matches.find(m => m.id === where.id)),
        // 只认按单项过滤（event.id 为字符串或 { in }），其余返回全部。
        findMany: jest.fn().mockImplementation(({ where }) => {
          const id = where?.event?.id as string | { in: string[] } | undefined;
          if (!id) return matches;
          const ids = typeof id === 'string' ? [id] : id.in;
          return matches.filter(m => m.eventId && ids.includes(m.eventId));
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      registration: { findMany: jest.fn().mockResolvedValue(registrations) },
      tournament: { findUnique: jest.fn().mockResolvedValue({ id: 't', defaultMatchMinutes: 30, breakMinutes: 10,
        startDate: new Date('2026-10-21T16:00:00Z'), endDate: new Date('2026-10-23T15:59:00Z'), dailyStartTime: '08:00', dailyEndTime: '18:00' }) },
      venue: { findMany: jest.fn().mockResolvedValue(Array.from({ length: courts }, (_, i) => ({ id: `court${i + 1}`, name: `${i + 1}号场`, isActive: true, tournamentId: 't', sortOrder: i }))) },
      teamCompetition: { findMany: jest.fn().mockResolvedValue([]) },
      tournamentGroup: { findMany: jest.fn().mockResolvedValue([group]) },
      event: { count: jest.fn().mockResolvedValue(2) },
      scheduleOperationLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(callback => callback(prisma));
    const service = new SchedulingService(prisma as unknown as PrismaService, { emitBracketUpdate: jest.fn() } as never);
    return { service, tx: prisma };
  }
  type Preview = {
    scheduledCount: number; keptCount: number;
    matches: Array<{ id: string; scheduledAt: string | null; venueId: string | null }>;
    unscheduled: Array<{ matchId: string; reason: string }>;
  };
  async function preview(matches: MockMatch[], options: Partial<AutoScheduleDto>, courts = 1) {
    const { service } = setup(matches, courts);
    const result = (await service.autoSchedule({ tournamentId: 't', startAt: '2026-10-22T00:00:00.000Z', preview: true, ...options })) as unknown as { preview: Preview };
    const at = (id: string) => result.preview.matches.find(m => m.id === id)?.scheduledAt ?? null;
    return { ...result.preview, at };
  }
  const STD = 'GROUP_PLUS_KNOCKOUT_STD';

  it('仅第一阶段：排小组赛和单淘汰这类单阶段项目，不动淘汰赛', async () => {
    const result = await preview([
      eventMatch('g1', 'eA', STD, 0, 1), eventMatch('g2', 'eA', STD, 0, 2), eventMatch('k1', 'eA', STD, 1, 1),
      eventMatch('s1', 'eS', 'SINGLE_ELIMINATION', 1, 1),
    ], { scheduleStage: 'first' });
    expect(result.scheduledCount).toBe(3);
    expect(result.at('k1')).toBeNull();
    expect([result.at('g1'), result.at('g2'), result.at('s1')].every(Boolean)).toBe(true);
  });

  it('仅第二阶段：团体循环赛第 2 轮不算第二阶段，团体「小组+淘汰」的淘汰赛算', async () => {
    const result = await preview([teamMatch('rr', 'ROUND_ROBIN', 'GROUP', 2), teamMatch('ko', 'GROUP_PLUS_KNOCKOUT', 'KNOCKOUT', 3)], { scheduleStage: 'second' });
    expect(result.at('ko')).toBe('2026-10-22T00:00:00.000Z');
    expect(result.at('rr')).toBeNull();
  });

  it('紧接：淘汰赛排在本项目小组赛最后一场之后，不和小组赛同时打', async () => {
    // 两片场：g1、g2 08:00，g3 08:40；淘汰赛原来会挤进 08:40 的 2 号场，现在等 g3 打完（09:10）再隔 10 分钟。
    const result = await preview([
      eventMatch('g1', 'eA', STD, 0, 1), eventMatch('g2', 'eA', STD, 0, 2), eventMatch('g3', 'eA', STD, 0, 3), eventMatch('k1', 'eA', STD, 1, 1),
    ], {}, 2);
    expect(result.at('g3')).toBe('2026-10-22T00:40:00.000Z');
    expect(result.at('k1')).toBe('2026-10-22T01:20:00.000Z');
  });

  it('另定第二阶段开始时间：小组赛排在第一天，淘汰赛从第二天早上开始', async () => {
    const result = await preview([
      eventMatch('g1', 'eA', STD, 0, 1), eventMatch('g2', 'eA', STD, 0, 2), eventMatch('k1', 'eA', STD, 1, 1),
    ], { secondStageStartAtLocal: '2026-10-23 08:00', secondStageStartAt: '2026-10-23T00:00:00.000Z' });
    expect(result.at('g2')).toBe('2026-10-22T00:40:00.000Z');
    expect(result.at('k1')).toBe('2026-10-23T00:00:00.000Z');
  });

  it('第二阶段开始时间不能早于首日开始时间', async () => {
    const { service } = setup([eventMatch('g1', 'eA', STD, 0, 1)]);
    await expect(service.autoSchedule({ tournamentId: 't', startAt: '2026-10-22T02:00:00.000Z', secondStageStartAt: '2026-10-22T01:00:00.000Z', preview: true }))
      .rejects.toThrow('第二阶段开始时间不能早于首日开始时间');
  });

  it('本项目还有没排上的小组赛时，不排淘汰赛并说明原因', async () => {
    const result = await preview([eventMatch('g1', 'eA', STD, 0, 1), eventMatch('k1', 'eA', STD, 1, 1)], { scheduleStage: 'second' });
    expect(result.unscheduled).toEqual([{ matchId: 'k1', reason: '本项目第一阶段还有比赛没排上，请先安排第一阶段' }]);
  });

  it('只排还没安排的场次：已排好的保持原样，新场次插到空档里', async () => {
    const placed = { venueId: 'court1', scheduledAt: new Date('2026-10-22T01:00:00Z') };
    const matches = [eventMatch('a', 'eA', 'SINGLE_ELIMINATION', 1, 1, placed), eventMatch('b', 'eA', 'SINGLE_ELIMINATION', 1, 2)];
    const kept = await preview(matches, { onlyUnscheduled: true });
    expect(kept.at('a')).toBe('2026-10-22T01:00:00.000Z');
    expect(kept.at('b')).toBe('2026-10-22T00:00:00.000Z');
    expect(kept.keptCount).toBe(1);
    expect(kept.scheduledCount).toBe(1);
    // 不勾选时整体重排，a 会被挪到最早的时段。
    const all = await preview(matches, {});
    expect(all.at('a')).toBe('2026-10-22T00:00:00.000Z');
  });

  it('只排还没安排的场次但全都排好了时，提示取消勾选', async () => {
    const placed = { venueId: 'court1', scheduledAt: new Date('2026-10-22T01:00:00Z') };
    const { service } = setup([eventMatch('a', 'eA', 'SINGLE_ELIMINATION', 1, 1, placed)]);
    await expect(service.autoSchedule({ tournamentId: 't', startAt: '2026-10-22T00:00:00.000Z', onlyUnscheduled: true, preview: true }))
      .rejects.toThrow('都已安排了场地和时间');
  });

  it('运动员两场之间至少休息：兼项选手的两场按设定隔开', async () => {
    // p1 同时报了 eA（r1）和 eB（r3），两片场。
    const matches = [
      eventMatch('a', 'eA', 'SINGLE_ELIMINATION', 1, 1, { side1Id: 'r1', side2Id: 'r2' }),
      eventMatch('b', 'eB', 'SINGLE_ELIMINATION', 1, 1, { side1Id: 'r3', side2Id: 'r4' }),
    ];
    const gap = (r: { at: (id: string) => string | null }) => Math.abs(Date.parse(r.at('b')!) - Date.parse(r.at('a')!)) / 60000;
    expect(gap(await preview(matches, {}, 2))).toBe(30);
    expect(gap(await preview(matches, { playerRestMinutes: 20 }, 2))).toBe(50);
  });

  it('轮空场（已结束、只有一方）标记 isBye，赛程页写「轮空」', async () => {
    const { service } = setup([
      eventMatch('bye', 'eA', 'SINGLE_ELIMINATION', 1, 1, { status: 'COMPLETED', winnerSide: 1, side1Id: 'r1' }),
      eventMatch('real', 'eA', 'SINGLE_ELIMINATION', 1, 2, { side1Id: 'r2', side2Id: 'r4' }),
    ]);
    const schedule = await service.getSchedule('t');
    const byId = new Map(schedule.matches.map(m => [m.id, m.isBye]));
    expect(byId.get('bye')).toBe(true);
    expect(byId.get('real')).toBe(false);
  });

  it('轮次：只排选中的淘汰赛轮次，其余留待下次', async () => {
    const SE = 'SINGLE_ELIMINATION';
    const result = await preview([
      eventMatch('q1', 'eA', SE, 1, 1, { round: 'QF' }), eventMatch('q2', 'eA', SE, 1, 2, { round: 'QF' }),
      eventMatch('s1', 'eA', SE, 2, 1, { round: 'SF' }), eventMatch('f', 'eA', SE, 3, 1, { round: 'F' }),
    ], { rounds: ['QF'] }, 2);
    expect(result.scheduledCount).toBe(2);
    expect(result.at('q1')).toBe('2026-10-22T00:00:00.000Z');
    expect(result.at('s1')).toBeNull();
    expect(result.at('f')).toBeNull();
  });

  it('轮次：小组赛 F 组不是决赛；没有所选轮次时提示', async () => {
    const { service } = setup([eventMatch('gF', 'eA', 'GROUP_PLUS_KNOCKOUT_STD', 0, 1, { round: 'F' })]);
    await expect(service.autoSchedule({ tournamentId: 't', startAt: '2026-10-22T00:00:00.000Z', rounds: ['F'], preview: true }))
      .rejects.toThrow('当前范围没有所选轮次的场次');
  });

  it('多个项目一起排淘汰赛时按轮次大小统一排：先 1/8 决赛再 1/4 决赛（不按 roundNo）', async () => {
    // eA 8 签的首轮是 1/4 决赛，eB 16 签的首轮是 1/8 决赛，roundNo 都是 1。
    const result = await preview([
      eventMatch('aQF', 'eA', 'SINGLE_ELIMINATION', 1, 1, { round: 'QF' }),
      eventMatch('bR1', 'eB', 'SINGLE_ELIMINATION', 1, 1, { round: 'R1' }),
    ], {});
    expect(result.at('bR1')).toBe('2026-10-22T00:00:00.000Z');
    expect(result.at('aQF')).toBe('2026-10-22T00:40:00.000Z');
  });

  it('查询场次时最后按 id 排序，保证预览指纹稳定（多个项目 roundNo、matchNo 相同时）', async () => {
    const { service, tx } = setup([eventMatch('a', 'eA', 'SINGLE_ELIMINATION', 1, 1), eventMatch('b', 'eB', 'SINGLE_ELIMINATION', 1, 1)]);
    await service.autoSchedule({ tournamentId: 't', startAt: '2026-10-22T00:00:00.000Z', eventIds: ['eA', 'eB'], preview: true });
    for (const [args] of tx.match.findMany.mock.calls) expect(args.orderBy).toContainEqual({ id: 'asc' });
  });

  it('多选单项：只排选中的单项', async () => {
    const result = await preview([eventMatch('a', 'eA', 'SINGLE_ELIMINATION', 1, 1), eventMatch('b', 'eB', 'SINGLE_ELIMINATION', 1, 1)], { eventIds: ['eB'] });
    expect(result.matches.map(m => m.id)).toEqual(['b']);
    expect(result.at('b')).toBe('2026-10-22T00:00:00.000Z');
  });
});
