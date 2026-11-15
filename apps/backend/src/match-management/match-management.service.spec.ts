import { BadRequestException, ConflictException } from '@nestjs/common';
import { MatchStatus } from '@prisma/client';
import { MatchManagementService } from './match-management.service';

type FakeMatch = {
  id: string;
  status: MatchStatus;
  refereeId: string | null;
};

/**
 * 只搭 release-referee 需要的两个依赖：
 * match.findUnique 同时供 requireMatchRef（取赛事）和 clearReferee（取状态）使用，
 * 所以返回值把两边的字段都带上。
 */
function buildService(initial: FakeMatch) {
  const state: FakeMatch = { ...initial };
  const match = {
    findUnique: jest.fn(async () => ({
      ...state,
      eventId: 'event-1',
      event: { tournamentId: 'tournament-1' },
      teamMatch: null,
    })),
    update: jest.fn(
      async ({ data }: { data: { refereeId: string | null } }) => {
        state.refereeId = data.refereeId;
        return { ...state };
      },
    ),
  };
  const gateway = { emitBracketUpdate: jest.fn() };
  const service = new MatchManagementService(
    { match } as never,
    {} as never,
    {} as never,
    gateway as never,
  );
  return { service, state, match, gateway };
}

describe('MatchManagementService releaseReferee', () => {
  it('未开始的比赛可以直接解除，并广播对局更新', async () => {
    const { service, state, match, gateway } = buildService({
      id: 'm1',
      status: MatchStatus.PENDING,
      refereeId: 'referee-1',
    });

    await expect(service.releaseReferee('m1', {}, 'admin-1')).resolves.toEqual({
      released: true,
    });
    expect(state.refereeId).toBeNull();
    expect(match.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { refereeId: null },
    });
    expect(gateway.emitBracketUpdate).toHaveBeenCalledWith({
      tournamentId: 'tournament-1',
      eventId: 'event-1',
      matchId: 'm1',
    });
  });

  it('进行中的比赛不带 force 时拒绝，且不改数据', async () => {
    const { service, state, match, gateway } = buildService({
      id: 'm2',
      status: MatchStatus.LIVE,
      refereeId: 'referee-1',
    });

    await expect(
      service.releaseReferee('m2', {}, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(state.refereeId).toBe('referee-1');
    expect(match.update).not.toHaveBeenCalled();
    expect(gateway.emitBracketUpdate).not.toHaveBeenCalled();
  });

  it('进行中的比赛确认后（force）可以解除', async () => {
    const { service, state } = buildService({
      id: 'm3',
      status: MatchStatus.LIVE,
      refereeId: 'referee-1',
    });

    await expect(
      service.releaseReferee('m3', { force: true }, 'admin-1'),
    ).resolves.toEqual({ released: true });
    expect(state.refereeId).toBeNull();
  });

  it('已结束的比赛默认禁止解除', async () => {
    const { service, state, match } = buildService({
      id: 'm4',
      status: MatchStatus.COMPLETED,
      refereeId: 'referee-1',
    });

    await expect(
      service.releaseReferee('m4', { force: true }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(state.refereeId).toBe('referee-1');
    expect(match.update).not.toHaveBeenCalled();
  });

  it('已取消的比赛不需要解除', async () => {
    const { service } = buildService({
      id: 'm5',
      status: MatchStatus.CANCELLED,
      refereeId: 'referee-1',
    });

    await expect(
      service.releaseReferee('m5', {}, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('本来就没有裁判时是幂等的，不写库也不广播', async () => {
    const { service, match, gateway } = buildService({
      id: 'm6',
      status: MatchStatus.PENDING,
      refereeId: null,
    });

    await expect(service.releaseReferee('m6', {}, 'admin-1')).resolves.toEqual({
      released: false,
    });
    expect(match.update).not.toHaveBeenCalled();
    expect(gateway.emitBracketUpdate).not.toHaveBeenCalled();
  });

  it('PATCH 清空 refereeId 走同一套校验：进行中同样被拦下', async () => {
    const { service, match } = buildService({
      id: 'm7',
      status: MatchStatus.LIVE,
      refereeId: 'referee-1',
    });

    await expect(
      service.updateMatch('m7', { refereeId: null }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(match.update).not.toHaveBeenCalled();
  });
});
