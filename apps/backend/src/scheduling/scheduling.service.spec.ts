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
