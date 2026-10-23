import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { TeamCompetitionsController } from '../team-competitions/team-competitions.controller';
import { DrawsController } from '../draws/draws.controller';
import { ResultsResetController } from '../common/results-reset.controller';

describe('ROOT action boundaries', () => {
  const prisma = {
    teamCompetition: { findUnique: jest.fn().mockResolvedValue({ tournamentId: 'owned' }) },
    tournament: { findFirst: jest.fn().mockResolvedValue({ id: 'owned' }) },
  };
  const guard = new RolesGuard(new Reflector(), prisma as never);
  function context(controller: any, action: string, role = 'ADMIN', permissions = ['TEAMS', 'DRAWS']) {
    return { getClass: () => controller, getHandler: () => controller.prototype[action],
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'admin', role, permissions }, params: { id: 'owned-team' } }) }),
    } as ExecutionContext;
  }
  it.each([
    [TeamCompetitionsController, 'approveClearDrawRequest'], [TeamCompetitionsController, 'rejectClearDrawRequest'],
    [DrawsController, 'approveRedrawRequest'], [DrawsController, 'rejectRedrawRequest'], [DrawsController, 'clearAllDraws'],
    [ResultsResetController, 'resetTeam'], [ResultsResetController, 'resetEvent'],
  ])('rejects feature-authorized admins for %p.%s', async (controller, action) => {
    expect(await guard.canActivate(context(controller, action))).toBe(false);
    expect(await guard.canActivate(context(controller, action, 'ROOT'))).toBe(true);
  });
  it('retains normal team access for the owner', async () => {
    expect(await guard.canActivate(context(TeamCompetitionsController, 'clearDraw'))).toBe(true);
  });
});
