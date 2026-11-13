import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulingService, normalizePlayDates } from './scheduling.service';

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
