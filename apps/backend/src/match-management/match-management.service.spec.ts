import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MatchStatus, Role } from '@prisma/client';
import { MatchManagementService } from './match-management.service';

type FakeMatch = {
  id: string;
  status: MatchStatus;
  refereeId: string | null;
};

const ADMIN = { id: 'admin-1', role: Role.ADMIN, username: 'organizer' };
const ROOT = { id: 'root-1', role: Role.ROOT, username: 'root' };

/**
 * 只搭 release-referee / 指派裁判需要的依赖：
 * match.findUnique 同时供 requireMatchRef（取赛事）和 clearReferee（取状态）使用，
 * 所以返回值把两边的字段都带上。操作记录用替身，只看有没有记、记了什么。
 */
function buildService(initial: FakeMatch, referees: Record<string, { role: Role; managerId: string | null }> = {}) {
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
  const user = { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => referees[where.id] ?? null) };
  const gateway = { emitBracketUpdate: jest.fn() };
  const scoring = { assignReferee: jest.fn(async (_id: string, refereeId: string) => { state.refereeId = refereeId; }) };
  const operationLog = {
    snapshot: jest.fn(async () => ({ status: state.status, winnerSide: null, scheduledAt: null, durationMinutes: 30, venue: null, referee: state.refereeId, score: '' })),
    record: jest.fn(async () => null),
  };
  const service = new MatchManagementService(
    { match, user } as never,
    scoring as never,
    {} as never,
    gateway as never,
    operationLog as never,
  );
  return { service, state, match, gateway, scoring, operationLog };
}

describe('MatchManagementService releaseReferee', () => {
  it('未开始的比赛可以直接解除，并广播对局更新、记操作记录', async () => {
    const { service, state, match, gateway, operationLog } = buildService({
      id: 'm1',
      status: MatchStatus.PENDING,
      refereeId: 'referee-1',
    });

    await expect(service.releaseReferee('m1', {}, ADMIN)).resolves.toEqual({
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
    expect(operationLog.record).toHaveBeenCalledWith(expect.objectContaining({
      matchId: 'm1',
      tournamentId: 'tournament-1',
      action: 'RELEASE_REFEREE',
      operator: { id: 'admin-1', username: 'organizer' },
    }));
  });

  it('进行中的比赛不带 force 时拒绝，且不改数据、不记录', async () => {
    const { service, state, match, gateway, operationLog } = buildService({
      id: 'm2',
      status: MatchStatus.LIVE,
      refereeId: 'referee-1',
    });

    await expect(
      service.releaseReferee('m2', {}, ADMIN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(state.refereeId).toBe('referee-1');
    expect(match.update).not.toHaveBeenCalled();
    expect(gateway.emitBracketUpdate).not.toHaveBeenCalled();
    expect(operationLog.record).not.toHaveBeenCalled();
  });

  it('进行中的比赛确认后（force）可以解除', async () => {
    const { service, state } = buildService({
      id: 'm3',
      status: MatchStatus.LIVE,
      refereeId: 'referee-1',
    });

    await expect(
      service.releaseReferee('m3', { force: true }, ADMIN),
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
      service.releaseReferee('m4', { force: true }, ADMIN),
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
      service.releaseReferee('m5', {}, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('本来就没有裁判时是幂等的，不写库、不广播、不记录', async () => {
    const { service, match, gateway, operationLog } = buildService({
      id: 'm6',
      status: MatchStatus.PENDING,
      refereeId: null,
    });

    await expect(service.releaseReferee('m6', {}, ADMIN)).resolves.toEqual({
      released: false,
    });
    expect(match.update).not.toHaveBeenCalled();
    expect(gateway.emitBracketUpdate).not.toHaveBeenCalled();
    expect(operationLog.record).not.toHaveBeenCalled();
  });

  it('PATCH 清空 refereeId 走同一套校验：进行中同样被拦下', async () => {
    const { service, match } = buildService({
      id: 'm7',
      status: MatchStatus.LIVE,
      refereeId: 'referee-1',
    });

    await expect(
      service.updateMatch('m7', { refereeId: null }, ADMIN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(match.update).not.toHaveBeenCalled();
  });
});

describe('MatchManagementService 指派裁判的范围', () => {
  const referees = {
    'my-referee': { role: Role.REFEREE, managerId: 'admin-1' },
    'other-referee': { role: Role.REFEREE, managerId: 'admin-2' },
    'a-player': { role: Role.PLAYER, managerId: 'admin-1' },
  };

  it('管理员可以指派自己名下的裁判，并记一条「改时间 / 场地 / 裁判」', async () => {
    const { service, state, scoring, operationLog } = buildService({ id: 'm8', status: MatchStatus.PENDING, refereeId: null }, referees);
    await expect(service.updateMatch('m8', { refereeId: 'my-referee' }, ADMIN)).resolves.toEqual({ ok: true });
    expect(scoring.assignReferee).toHaveBeenCalledWith('m8', 'my-referee');
    expect(state.refereeId).toBe('my-referee');
    expect(operationLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE_INFO' }));
  });

  it.each(['other-referee', 'a-player', 'missing'])('管理员不能指派 %s（别人名下的裁判、不是裁判、不存在），什么都不改', async (refereeId) => {
    const { service, scoring, operationLog, gateway } = buildService({ id: 'm9', status: MatchStatus.PENDING, refereeId: null }, referees);
    await expect(service.updateMatch('m9', { refereeId }, ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    expect(scoring.assignReferee).not.toHaveBeenCalled();
    expect(operationLog.record).not.toHaveBeenCalled();
    expect(gateway.emitBracketUpdate).not.toHaveBeenCalled();
  });

  it('超级管理员可以指派任何裁判', async () => {
    const { service, scoring } = buildService({ id: 'm10', status: MatchStatus.PENDING, refereeId: null }, referees);
    await expect(service.updateMatch('m10', { refereeId: 'other-referee' }, ROOT)).resolves.toEqual({ ok: true });
    expect(scoring.assignReferee).toHaveBeenCalledWith('m10', 'other-referee');
  });
});
