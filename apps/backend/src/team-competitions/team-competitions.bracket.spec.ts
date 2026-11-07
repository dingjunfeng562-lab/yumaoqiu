import { PrismaService } from '../prisma/prisma.service';
import { TeamCompetitionsService } from './team-competitions.service';

type Encounter = {
  id: string; teamCompetitionId: string; round: string; roundNo: number; matchNo: number; stage: string;
  team1Id: string | null; team2Id: string | null;
};

describe('TeamCompetitionsService bronze playoff advancement', () => {
  function setup() {
    const base = { teamCompetitionId: 'comp', stage: 'KNOCKOUT' };
    const encounters: Encounter[] = [
      { ...base, id: 'qf1', round: 'QF', roundNo: 1, matchNo: 1, team1Id: 'a', team2Id: 'x' },
      { ...base, id: 'sf1', round: 'SF', roundNo: 2, matchNo: 1, team1Id: 'a', team2Id: 'b' },
      { ...base, id: 'sf2', round: 'SF', roundNo: 2, matchNo: 2, team1Id: 'c', team2Id: 'd' },
      { ...base, id: 'final', round: 'F', roundNo: 3, matchNo: 1, team1Id: null, team2Id: null },
      { ...base, id: 'bronze', round: 'BRONZE', roundNo: 3, matchNo: 2, team1Id: null, team2Id: null },
    ];
    const byId = (id: string) => encounters.find(encounter => encounter.id === id)!;
    const tx = {
      $queryRaw: jest.fn(async () => []),
      teamMatch: {
        findUnique: jest.fn(async ({ where }: { where: { teamCompetitionId_roundNo_matchNo: { roundNo: number; matchNo: number } } }) => {
          const key = where.teamCompetitionId_roundNo_matchNo;
          return encounters.find(encounter => encounter.roundNo === key.roundNo && encounter.matchNo === key.matchNo) ?? null;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Encounter> }) => Object.assign(byId(where.id), data)),
      },
      match: { count: jest.fn(async () => 0), createMany: jest.fn(async () => ({ count: 1 })) },
    };
    const service = new TeamCompetitionsService({} as PrismaService);
    const advance = (encounterId: string, winnerTeamId: string) =>
      (service as unknown as { advanceTeamWinner: (...args: unknown[]) => Promise<void> })
        .advanceTeamWinner(tx, byId(encounterId), winnerTeamId, [{ id: 'item1' }]);
    return { tx, byId, advance };
  }

  it('sends semifinal losers into the bronze match and creates its sub-items once both are known', async () => {
    const { tx, byId, advance } = setup();
    await advance('sf1', 'a');
    expect(byId('final')).toMatchObject({ team1Id: 'a', team2Id: null });
    expect(byId('bronze')).toMatchObject({ team1Id: 'b', team2Id: null });

    await advance('sf2', 'd');
    expect(byId('final')).toMatchObject({ team1Id: 'a', team2Id: 'd' });
    expect(byId('bronze')).toMatchObject({ team1Id: 'b', team2Id: 'c' });
    const created = tx.match.createMany.mock.calls.map(call => (call as unknown as [{ data: Array<{ teamMatchId: string }> }])[0].data[0].teamMatchId);
    expect(created.sort()).toEqual(['bronze', 'final']);
  });

  it('does not touch the bronze match from earlier rounds', async () => {
    const { byId, advance } = setup();
    await advance('qf1', 'a');
    expect(byId('bronze')).toMatchObject({ team1Id: null, team2Id: null });
  });
});

describe('TeamCompetitionsService forfeits without lineups', () => {
  function setup(child: Record<string, unknown> = {}, encounter: Record<string, unknown> = {}) {
    const tx = {
      $queryRaw: jest.fn(async () => []),
      match: {
        findUnique: jest.fn(async () => ({ teamMatchId: 'tm', eventId: null, teamMatch: { teamCompetitionId: 'comp' } })),
        findUniqueOrThrow: jest.fn(async () => ({
          id: 'm', matchNo: 3, status: 'PENDING', lineupLocked: false, side1Id: null, side2Id: null, ...child,
          teamMatch: { status: 'PENDING', team1Id: 'a', team2Id: 'b', matches: [], ...encounter },
        })),
      },
    };
    return { service: new TeamCompetitionsService({} as PrismaService), tx: tx as never };
  }

  it('lets an item be forfeited when a side cannot field a lineup', async () => {
    const { service, tx } = setup();
    await expect(service.prepareScoring(tx, 'm', { forfeiting: true })).resolves.toBeUndefined();
  });

  it('still requires locked lineups to play the item', async () => {
    const { service, tx } = setup();
    await expect(service.prepareScoring(tx, 'm', { starting: true })).rejects.toThrow('请先填齐并锁定本项双方名单');
  });

  it('requires both teams to be known before a forfeit', async () => {
    const { service, tx } = setup({}, { team2Id: null });
    await expect(service.prepareScoring(tx, 'm', { forfeiting: true })).rejects.toThrow('双方队伍确定后才能判弃权');
  });

  it('refuses a forfeit once the team encounter is over', async () => {
    const { service, tx } = setup({}, { status: 'COMPLETED' });
    await expect(service.prepareScoring(tx, 'm', { forfeiting: true })).rejects.toThrow('团体对阵已结束');
  });
});
