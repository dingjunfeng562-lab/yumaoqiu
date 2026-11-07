import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulingService } from './scheduling.service';

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
