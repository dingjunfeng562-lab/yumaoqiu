import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { MatchManagementController } from '../match-management/match-management.controller';

/**
 * 裁判员对局管理下放给管理员：需要「对局管理」功能权限（管理员默认有），
 * 只能管自己创建的赛事——带赛事 id 或场次 id 的接口都要查归属。
 */
describe('裁判员对局管理的权限', () => {
  const prisma = {
    tournament: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; submittedById: string } }) =>
        (where.id === 'own-t' && where.submittedById === 'admin' ? { id: 'own-t' } : null)),
    },
    match: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === 'own-m') return { event: { tournamentId: 'own-t' }, teamMatch: null };
        if (where.id === 'other-m') return { event: { tournamentId: 'other-t' }, teamMatch: null };
        return null;
      }),
    },
  };
  const guard = new RolesGuard(new Reflector(), prisma as never);
  const context = (action: string, params: Record<string, string>, user: Record<string, unknown>) => ({
    getClass: () => MatchManagementController,
    getHandler: () => (MatchManagementController.prototype as unknown as Record<string, unknown>)[action],
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
  }) as unknown as ExecutionContext;
  const admin = { id: 'admin', role: 'ADMIN' }; // 没单独设置过权限 = 默认权限，含「对局管理」

  it('管理员默认就能用：看自己的赛事、改自己赛事的场次、看操作记录', async () => {
    await expect(guard.canActivate(context('getOverview', { tournamentId: 'own-t' }, admin))).resolves.toBe(true);
    for (const action of ['updateMatch', 'correctScore', 'completeMatch', 'reopenMatch', 'releaseReferee', 'listMatchLogs']) {
      await expect(guard.canActivate(context(action, { id: 'own-m' }, admin))).resolves.toBe(true);
    }
  });

  it('别人的赛事、别人赛事的场次：不让看也不让改', async () => {
    await expect(guard.canActivate(context('getOverview', { tournamentId: 'other-t' }, admin))).rejects.toBeInstanceOf(NotFoundException);
    for (const action of ['updateMatch', 'correctScore', 'completeMatch', 'reopenMatch', 'releaseReferee', 'listMatchLogs']) {
      await expect(guard.canActivate(context(action, { id: 'other-m' }, admin))).rejects.toBeInstanceOf(NotFoundException);
    }
    await expect(guard.canActivate(context('updateMatch', { id: 'missing' }, admin))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('列表和跨赛事搜索不带赛事 id：只看功能权限（范围在服务里按 tournamentScope 过滤）', async () => {
    await expect(guard.canActivate(context('listTournaments', {}, admin))).resolves.toBe(true);
    await expect(guard.canActivate(context('searchMatches', {}, admin))).resolves.toBe(true);
  });

  it('单独设置过权限、没勾「对局管理」的管理员不能用', async () => {
    const limited = { id: 'admin', role: 'ADMIN', permissions: ['SCORING', 'DRAWS'] };
    await expect(guard.canActivate(context('getOverview', { tournamentId: 'own-t' }, limited))).resolves.toBe(false);
    await expect(guard.canActivate(context('listTournaments', {}, limited))).resolves.toBe(false);
  });

  it('裁判、选手账号不能用', async () => {
    await expect(guard.canActivate(context('listTournaments', {}, { id: 'r', role: 'REFEREE' }))).resolves.toBe(false);
    await expect(guard.canActivate(context('updateMatch', { id: 'own-m' }, { id: 'p', role: 'PLAYER' }))).resolves.toBe(false);
  });

  it('超级管理员什么赛事都能管', async () => {
    const root = { id: 'root', role: 'ROOT' };
    await expect(guard.canActivate(context('getOverview', { tournamentId: 'other-t' }, root))).resolves.toBe(true);
    await expect(guard.canActivate(context('reopenMatch', { id: 'other-m' }, root))).resolves.toBe(true);
  });
});
