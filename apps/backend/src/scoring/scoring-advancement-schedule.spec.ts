import { ScoringService } from './scoring.service';

/**
 * 淘汰赛晋级 / 撤回晋级只改下一轮的签位，不动已排好的场地和时间。
 *
 * 赛前把全部轮次一次排好（1/4、半决赛、决赛、季军赛都有场地和时间）。以前胜者一晋级，
 * 下一轮那场的 venueId / scheduledAt 就被清空，1/4 决赛决出人选后从秩序表、对阵表里消失。
 */
describe('ScoringService 晋级不动下一轮排程', () => {
  const VENUE = 'venue-1';
  const AT = new Date('2026-11-16T10:15:00.000Z');

  function scheduled(id: string, round: string, roundNo: number, matchNo: number) {
    return {
      id, eventId: 'event-1', round, roundNo, matchNo, status: 'PENDING',
      side1Id: null, side2Id: null, venueId: VENUE, scheduledAt: AT,
    };
  }

  function setup(matches: ReturnType<typeof scheduled>[]) {
    const updates: { id: string; data: Record<string, unknown> }[] = [];
    const matchesOf = (where: any) => matches.filter((m) =>
      m.eventId === where.eventId
      && m.roundNo === where.roundNo
      && (where.matchNo === undefined || m.matchNo === where.matchNo)
      && (where.round === undefined
        || (typeof where.round === 'string' ? m.round === where.round : m.round !== where.round.not)));
    const tx = {
      match: {
        findFirst: jest.fn(async ({ where }: any) => matchesOf(where)[0] ?? null),
        findMany: jest.fn(async ({ where }: any) => matches.filter((m) =>
          m.eventId === where.eventId && m.roundNo === where.roundNo
          && where.OR.some((cond: any) => (cond.round === 'BRONZE'
            ? m.round === 'BRONZE'
            : m.matchNo === cond.matchNo && m.round !== 'BRONZE')))),
        update: jest.fn(async ({ where, data }: any) => { updates.push({ id: where.id, data }); }),
      },
    };
    const service = new ScoringService({} as any, {} as any, {} as any, {} as any) as any;
    return { service, tx, updates };
  }

  it('1/8 决赛打完：胜者填进 1/4 决赛，1/4 决赛的场地和时间不动', async () => {
    const { service, tx, updates } = setup([scheduled('qf-1', 'QF', 2, 1)]);
    await service.advanceSingleEliminationWinner(
      tx,
      { eventId: 'event-1', round: 'R1', roundNo: 1, matchNo: 1, side1Id: 'a', side2Id: 'b' },
      1,
    );
    expect(updates).toEqual([{ id: 'qf-1', data: { side1Id: 'a' } }]);
  });

  it('半决赛打完：胜者进决赛、负者进季军赛，两场的场地和时间都不动', async () => {
    const { service, tx, updates } = setup([
      scheduled('final', 'F', 4, 1),
      scheduled('bronze', 'BRONZE', 4, 2),
    ]);
    await service.advanceSingleEliminationWinner(
      tx,
      { eventId: 'event-1', round: 'SF', roundNo: 3, matchNo: 2, side1Id: 'c', side2Id: 'd' },
      2,
    );
    expect(updates).toEqual([
      { id: 'final', data: { side2Id: 'd' } },
      { id: 'bronze', data: { side2Id: 'c' } },
    ]);
  });

  it('重开 / 改到分不出胜负：只撤回下一轮的签位，不清空场地和时间', async () => {
    const { service, tx, updates } = setup([
      scheduled('final', 'F', 4, 1),
      scheduled('bronze', 'BRONZE', 4, 2),
    ]);
    await service.clearSingleEliminationAdvancement(tx, { eventId: 'event-1', roundNo: 3, matchNo: 1 });
    expect(updates).toEqual([
      { id: 'final', data: { side1Id: null } },
      { id: 'bronze', data: { side1Id: null } },
    ]);
  });
});
