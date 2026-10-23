import { PrismaService } from '../prisma/prisma.service';
import { TeamCompetitionsService } from './team-competitions.service';

describe('TeamCompetitionsService draw view', () => {
  function setup() {
    const competition = {
      id: 'comp1',
      tournamentId: 'tour1',
      name: '院系团体赛',
      format: 'ROUND_ROBIN',
      groupCount: 1,
      advancePerGroup: null,
      items: [],
    };
    const groups = [
      {
        id: 'group1',
        groupNo: 1,
        groupName: '循环赛',
        teams: [
          {
            teamId: 'teamA',
            wins: 1,
            losses: 0,
            matchesWon: 1,
            matchesLost: 0,
            netMatches: 1,
            groupRank: 1,
            advanced: false,
            team: { name: '一队' },
          },
        ],
      },
    ];
    const scheduledAt = new Date('2026-10-23T01:00:00.000Z');
    const groupEncounter = {
      id: 'tie-group',
      round: '第1轮',
      roundNo: 1,
      matchNo: 1,
      stage: 'GROUP',
      groupId: 'group1',
      team1Id: 'teamA',
      team2Id: 'teamB',
      team1: { id: 'teamA', name: '一队' },
      team2: { id: 'teamB', name: '二队' },
      team1Wins: 1,
      team2Wins: 0,
      status: 'LIVE',
      winnerTeamId: null,
      lineups: [
        {
          teamId: 'teamA',
          teamCompetitionItemId: 'item1',
          player1: { name: '张三' },
          player2: { name: '李四' },
        },
        {
          teamId: 'teamB',
          teamCompetitionItemId: 'item1',
          player1: { name: '王五' },
          player2: { name: '赵六' },
        },
      ],
      matches: [
        {
          id: 'child1',
          matchNo: 1,
          status: 'COMPLETED',
          lineupLocked: true,
          winnerSide: 1,
          teamCompetitionItemId: 'item1',
          teamCompetitionItem: { eventType: 'MENS_DOUBLES' },
          referee: { username: 'referee1' },
          venue: { id: 'venue1', name: '1号场' },
          scheduledAt,
          durationMinutes: 45,
          games: [
            { gameNo: 1, side1Score: 21, side2Score: 15, winnerSide: 1 },
            { gameNo: 2, side1Score: 18, side2Score: 21, winnerSide: 2 },
            { gameNo: 3, side1Score: 21, side2Score: 19, winnerSide: 1 },
          ],
        },
        {
          id: 'child2',
          matchNo: 2,
          status: 'PENDING',
          lineupLocked: false,
          winnerSide: null,
          teamCompetitionItemId: 'item2',
          teamCompetitionItem: { eventType: 'WOMENS_SINGLES' },
          referee: null,
          venue: null,
          scheduledAt: null,
          durationMinutes: 45,
          games: [],
        },
      ],
    };
    const knockoutEncounter = {
      ...groupEncounter,
      id: 'tie-knockout',
      round: 'SF',
      roundNo: 3,
      matchNo: 1,
      stage: 'KNOCKOUT',
      groupId: null,
      team1Id: null,
      team2Id: null,
      team1: null,
      team2: null,
      team1Wins: 0,
      team2Wins: 0,
      status: 'PENDING',
      lineups: [],
      matches: [],
    };
    const prisma = {
      teamCompetition: { findUnique: jest.fn().mockResolvedValue(competition) },
      teamGroup: { findMany: jest.fn().mockResolvedValue(groups) },
      teamMatch: { findMany: jest.fn().mockResolvedValue([groupEncounter, knockoutEncounter]) },
    };
    const service = new TeamCompetitionsService(prisma as unknown as PrismaService);
    return { service, prisma };
  }

  it('returns each sub-event with lineups, per-game scores and status for the draw page', async () => {
    const { service } = setup();

    const result = await service.getGroups('comp1');
    const encounter = result.groups[0].matches[0];
    const [doubles, singles] = encounter.children;

    expect(doubles.eventTypeLabel).toBe('男双');
    expect(doubles.side1Name).toBe('张三 / 李四');
    expect(doubles.side2Name).toBe('王五 / 赵六');
    expect(doubles.games.map(game => `${game.side1Score}:${game.side2Score}`)).toEqual([
      '21:15',
      '18:21',
      '21:19',
    ]);
    expect(doubles.venue).toEqual({ id: 'venue1', name: '1号场' });
    expect(doubles.referee).toBe('referee1');
    expect(singles.side1Name).toBeNull();
    expect(singles.status).toBe('PENDING');
    expect(singles.games).toEqual([]);
  });

  it('keeps knockout ties out of the group tables and exposes them separately', async () => {
    const { service } = setup();

    const result = await service.getGroups('comp1');

    expect(result.groups[0].matches).toHaveLength(1);
    expect(result.knockout).toHaveLength(1);
    expect(result.knockout[0]).toMatchObject({
      id: 'tie-knockout',
      stage: 'KNOCKOUT',
      round: 'SF',
      children: [],
    });
  });
});

describe('TeamCompetitionsService play-all recovery', () => {
  function setup(options: { knockout?: boolean } = {}) {
    const encounter = {
      id: 'tie-1',
      groupId: 'group1',
      status: 'COMPLETED',
      stage: 'GROUP',
      matches: [
        { id: 'child1', status: 'COMPLETED', startedAt: new Date(), forfeitedSide: null, games: [{}] },
        { id: 'child2', status: 'CANCELLED', startedAt: null, forfeitedSide: null, games: [] },
        { id: 'child3', status: 'CANCELLED', startedAt: new Date(), forfeitedSide: null, games: [] },
        { id: 'child4', status: 'CANCELLED', startedAt: null, forfeitedSide: 1, games: [] },
        { id: 'child5', status: 'CANCELLED', startedAt: null, forfeitedSide: null, games: [{}] },
      ],
    };
    const tx = {
      teamMatch: {
        count: jest.fn().mockResolvedValue(options.knockout ? 1 : 0),
        findMany: jest.fn().mockResolvedValue(options.knockout ? [] : [encounter]),
        update: jest.fn().mockResolvedValue({}),
      },
      match: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new TeamCompetitionsService({} as PrismaService);
    jest.spyOn(service as unknown as { recalculateGroupRankings: () => Promise<void> }, 'recalculateGroupRankings').mockResolvedValue(undefined);
    return { service, tx };
  }

  it('reopens only cancelled sub-items that never started or played', async () => {
    const { service, tx } = setup();

    const reopened = await service.reopenCancelledChildren(tx as never, 'comp1');

    expect(reopened).toBe(1);
    expect(tx.match.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['child2'] } },
      data: expect.objectContaining({ status: 'PENDING', winnerSide: null, finishedAt: null }),
    });
    expect(tx.teamMatch.update).toHaveBeenCalledWith({
      where: { id: 'tie-1' },
      data: { status: 'LIVE' },
    });
  });

  it('does not reopen group sub-items once knockout matches exist', async () => {
    const { service, tx } = setup({ knockout: true });

    const reopened = await service.reopenCancelledChildren(tx as never, 'comp1');

    expect(reopened).toBe(0);
    expect(tx.match.updateMany).not.toHaveBeenCalled();
    expect(tx.teamMatch.update).not.toHaveBeenCalled();
  });
});
