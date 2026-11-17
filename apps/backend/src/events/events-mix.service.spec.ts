import { BadRequestException, ConflictException } from '@nestjs/common';
import { EventsService } from './events.service';

/**
 * 设置 / 取消混编（PUT /events/:id/mix）。
 * 同一赛事、同一类（单打 / 双打）；一个单项只属于一个混编；只能在抽签前改。
 */
describe('EventsService.setMix 混编', () => {
  type Row = { id: string; tournamentId: string; type: string; groupLabel: string; mixHostId: string | null; drawn?: boolean };

  type Seed = { id: string; eventItemId: string; entrantId: string; seedNo: number };
  type Reg = { id: string; eventId: string; isSeed: boolean; seedRank: number | null };

  function setup(rows: Row[], seeds: Seed[] = [], regs: Reg[] = []) {
    const view = (row: Row | undefined) => row && ({
      ...row,
      mixMembers: rows.filter((item) => item.mixHostId === row.id).map((item) => ({ id: item.id })),
    });
    const idIn = (where: any, id: string) => !where?.id?.in || where.id.in.includes(id);
    const seedMatches = (where: any, seed: Seed) => {
      const item = where.eventItemId;
      if (typeof item === 'string' ? seed.eventItemId !== item : item?.in && !item.in.includes(seed.eventItemId)) return false;
      const eventIds = where.entrant?.eventId?.in;
      if (eventIds && !eventIds.includes(regs.find((reg) => reg.id === seed.entrantId)?.eventId)) return false;
      return idIn(where, seed.id);
    };
    const tx = {
      $queryRaw: jest.fn(async () => []),
      event: {
        findUnique: jest.fn(async ({ where }: any) => view(rows.find((row) => row.id === where.id)) ?? null),
        findMany: jest.fn(async ({ where }: any) => rows
          .filter((row) => where.id.in.includes(row.id))
          .filter((row) => !where.OR || row.drawn)
          .map(view)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          for (const row of rows) if (where.id.in.includes(row.id)) row.mixHostId = data.mixHostId;
          return { count: where.id.in.length };
        }),
      },
      drawSeedSetting: {
        findMany: jest.fn(async ({ where }: any) => seeds.filter((seed) => seedMatches(where, seed))
          .sort((a, b) => a.seedNo - b.seedNo).map((seed) => ({ ...seed }))),
        deleteMany: jest.fn(async ({ where }: any) => {
          const before = seeds.length;
          seeds.splice(0, seeds.length, ...seeds.filter((seed) => !seedMatches(where, seed)));
          return { count: before - seeds.length };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const seed = seeds.find((item) => item.id === where.id)!;
          // 和数据库一样：同一单项里种子号唯一。
          if (seeds.some((item) => item !== seed && item.eventItemId === seed.eventItemId && item.seedNo === data.seedNo)) {
            throw new Error('Unique constraint failed on (eventItemId, seedNo)');
          }
          Object.assign(seed, data);
          return seed;
        }),
      },
      registration: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const hit = regs.filter((reg) => idIn(where, reg.id));
          for (const reg of hit) Object.assign(reg, data);
          return { count: hit.length };
        }),
        update: jest.fn(async ({ where, data }: any) => Object.assign(regs.find((reg) => reg.id === where.id)!, data)),
      },
    };
    const prisma = {
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      event: { findUniqueOrThrow: jest.fn(async () => ({ tournamentId: 't1' })) },
    };
    const service = new EventsService(prisma as any);
    jest.spyOn(service, 'findByTournament').mockResolvedValue([] as any);
    return { service, rows, tx, seeds, regs };
  }

  const event = (id: string, type: string, groupLabel: string, extra: Partial<Row> = {}): Row => ({
    id, tournamentId: 't1', type, groupLabel, mixHostId: null, ...extra,
  });

  it('不同组别、不同性别的单打可以编在一起', async () => {
    const { service, rows } = setup([
      event('host', 'MENS_SINGLES', '高一组'),
      event('m1', 'MENS_SINGLES', '高二高三组'),
      event('w1', 'WOMENS_SINGLES', '高一组'),
    ]);
    await service.setMix('host', ['m1', 'w1']);
    expect(rows.find((row) => row.id === 'm1')?.mixHostId).toBe('host');
    expect(rows.find((row) => row.id === 'w1')?.mixHostId).toBe('host');
  });

  it('单打和双打不能编在一起', async () => {
    const { service } = setup([event('host', 'MENS_SINGLES', '高一组'), event('d1', 'MENS_DOUBLES', '高一组')]);
    await expect(service.setMix('host', ['d1'])).rejects.toThrow(new BadRequestException('单打只能和单打混编，双打只能和双打混编'));
  });

  it('只能编同一赛事的单项', async () => {
    const { service } = setup([event('host', 'MENS_SINGLES', '高一组'), event('x', 'MENS_SINGLES', '高一组', { tournamentId: 't2' })]);
    await expect(service.setMix('host', ['x'])).rejects.toThrow(BadRequestException);
  });

  it('已经抽签的单项不能设置混编', async () => {
    const { service, rows } = setup([event('host', 'MENS_SINGLES', '高一组'), event('m1', 'MENS_SINGLES', '高二高三组', { drawn: true })]);
    await expect(service.setMix('host', ['m1'])).rejects.toThrow(/已经抽签/);
    expect(rows.find((row) => row.id === 'm1')?.mixHostId).toBeNull();
  });

  it('主项目已经抽签也不能改', async () => {
    const { service } = setup([event('host', 'MENS_SINGLES', '高一组', { drawn: true }), event('m1', 'MENS_SINGLES', '高二高三组')]);
    await expect(service.setMix('host', ['m1'])).rejects.toThrow(ConflictException);
  });

  it('一个单项只能属于一个混编', async () => {
    const { service } = setup([
      event('host', 'MENS_SINGLES', '高一组'),
      event('other', 'MENS_SINGLES', '高三组'),
      event('m1', 'MENS_SINGLES', '高二组', { mixHostId: 'other' }),
    ]);
    await expect(service.setMix('host', ['m1'])).rejects.toThrow(/已并入其他混编/);
    // 别的混编的主项目也不能并进来
    await expect(service.setMix('host', ['other'])).rejects.toThrow(/另一个混编的主项目/);
    // 并入别处的单项不能再做主项目
    await expect(service.setMix('m1', ['host'])).rejects.toThrow(/不能再做主项目/);
  });

  it('取消混编：并入项目恢复独立', async () => {
    const { service, rows } = setup([
      event('host', 'MENS_SINGLES', '高一组'),
      event('m1', 'MENS_SINGLES', '高二高三组', { mixHostId: 'host' }),
    ]);
    await service.setMix('host', []);
    expect(rows.find((row) => row.id === 'm1')?.mixHostId).toBeNull();
  });

  it('移出单项：去掉指向它选手的种子，剩下的种子从 1 重新连续编号，移出的选手按自己单项的种子恢复', async () => {
    const regs: Reg[] = [
      { id: 'rH1', eventId: 'host', isSeed: true, seedRank: 2 },
      { id: 'rM1', eventId: 'm1', isSeed: true, seedRank: 1 },
      { id: 'rM2', eventId: 'm1', isSeed: false, seedRank: null },
      { id: 'rW1', eventId: 'w1', isSeed: true, seedRank: 3 },
    ];
    const seeds: Seed[] = [
      { id: 's1', eventItemId: 'host', entrantId: 'rM1', seedNo: 1 },
      { id: 's2', eventItemId: 'host', entrantId: 'rH1', seedNo: 2 },
      { id: 's3', eventItemId: 'host', entrantId: 'rW1', seedNo: 3 },
      // m1 并入混编前自己设过的种子
      { id: 'own', eventItemId: 'm1', entrantId: 'rM2', seedNo: 1 },
    ];
    const { service, rows } = setup([
      event('host', 'MENS_SINGLES', '高一组'),
      event('m1', 'MENS_SINGLES', '高二高三组', { mixHostId: 'host' }),
      event('w1', 'WOMENS_SINGLES', '高一组', { mixHostId: 'host' }),
    ], seeds, regs);

    await service.setMix('host', ['w1']);

    expect(rows.find((row) => row.id === 'm1')?.mixHostId).toBeNull();
    expect(rows.find((row) => row.id === 'w1')?.mixHostId).toBe('host');
    expect(seeds.filter((seed) => seed.eventItemId === 'host').map((seed) => [seed.entrantId, seed.seedNo]))
      .toEqual([['rH1', 1], ['rW1', 2]]);
    expect(Object.fromEntries(regs.map((reg) => [reg.id, [reg.isSeed, reg.seedRank]]))).toEqual({
      rH1: [true, 1],
      rW1: [true, 2],
      rM1: [false, null],
      rM2: [true, 1],
    });
  });
});
