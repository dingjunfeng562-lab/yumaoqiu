import { MatchStatus, Prisma } from '@prisma/client';
import { MatchOperationLogService, type MatchSnapshot } from './match-operation-log.service';

const base: MatchSnapshot = {
  status: MatchStatus.PENDING,
  winnerSide: null,
  scheduledAt: '2026-11-20T01:00:00.000Z',
  durationMinutes: 30,
  venue: '1号场',
  referee: null,
  score: '',
};

describe('对局操作记录', () => {
  function build(createImpl?: () => Promise<unknown>) {
    const create = jest.fn(createImpl ?? (async ({ data }: { data: unknown }) => data));
    const service = new MatchOperationLogService({ matchOperationLog: { create } } as never);
    return { service, create };
  }

  it('只记改了的字段：改前改后各一份，带操作人', async () => {
    const { service, create } = build();
    await service.record({
      matchId: 'm1',
      tournamentId: 't1',
      action: 'UPDATE_INFO',
      operator: { id: 'u1', username: 'organizer' },
      before: base,
      after: { ...base, venue: '2号场', referee: '裁判一' },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        matchId: 'm1',
        tournamentId: 't1',
        action: 'UPDATE_INFO',
        operatorId: 'u1',
        operatorName: 'organizer',
        beforeData: { venue: '1号场', referee: null },
        afterData: { venue: '2号场', referee: '裁判一' },
      },
    });
  });

  it('什么都没变就不记', async () => {
    const { service, create } = build();
    await expect(service.record({ matchId: 'm1', tournamentId: 't1', action: 'UPDATE_INFO', operator: null, before: base, after: { ...base } })).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('场次被删了（改后为空）也能记，改后写数据库 NULL', async () => {
    const { service, create } = build();
    await service.record({ matchId: 'm1', tournamentId: 't1', action: 'REOPEN', operator: null, before: base, after: null });
    expect((create.mock.calls[0] as unknown as [{ data: { afterData: unknown } }])[0].data.afterData).toBe(Prisma.DbNull);
  });

  it('记录失败不影响操作本身（不抛错）', async () => {
    const { service } = build(async () => { throw new Error('db down'); });
    await expect(service.record({ matchId: 'm1', tournamentId: 't1', action: 'COMPLETE', operator: null, before: base, after: { ...base, status: MatchStatus.COMPLETED } })).resolves.toBeNull();
  });
});
