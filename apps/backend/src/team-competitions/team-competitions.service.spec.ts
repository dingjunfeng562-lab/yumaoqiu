import { PrismaService } from '../prisma/prisma.service';
import { TeamCompetitionsService } from './team-competitions.service';
import { Prisma } from '@prisma/client';

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

describe('TeamCompetitionsService official scores and live group rankings', () => {
  function setup(playAllMatches = true) {
    const competition = { format: 'ROUND_ROBIN', winThreshold: 3, playAllMatches, items: [] };
    const members = ['a', 'b'].map(teamId => ({ teamId, team: { name: teamId },
      wins: 0, losses: 0, matchesWon: 0, matchesLost: 0, netMatches: 0, groupRank: null as number | null }));
    const encounter = { id: 'tie', groupId: 'group', stage: 'GROUP', team1Id: 'a', team2Id: 'b',
      winnerTeamId: null as string | null, team1Wins: 0, team2Wins: 0, status: 'PENDING', teamCompetition: competition,
      matches: [1, 2, 3, 4, 5].map(matchNo => ({ id: `child${matchNo}`, matchNo, status: 'PENDING', winnerSide: null as number | null, games: [] as Array<{ side1Score: number; side2Score: number }> })) };
    const tx = {
      match: {
        findUnique: jest.fn(async () => ({ teamMatch: encounter })),
        updateMany: jest.fn(async ({ where, data }) => {
          encounter.matches.filter(child => where.id.in.includes(child.id)).forEach(child => Object.assign(child, data));
          return { count: where.id.in.length };
        }),
      },
      teamMatch: {
        findUnique: jest.fn(async () => encounter),
        findMany: jest.fn(async () => [encounter]),
        update: jest.fn(async ({ data }) => Object.assign(encounter, data)),
      },
      teamGroup: { findUniqueOrThrow: jest.fn(async () => ({ teamCompetition: competition })) },
      teamGroupMember: {
        findMany: jest.fn(async () => members),
        update: jest.fn(async ({ where, data }) => Object.assign(members.find(row => row.teamId === where.groupId_teamId.teamId)!, data)),
      },
    };
    const service = new TeamCompetitionsService({} as PrismaService);
    async function finish(index: number, side: number) {
      Object.assign(encounter.matches[index], { status: 'COMPLETED', winnerSide: side,
        games: [{ side1Score: side === 1 ? 21 : 11, side2Score: side === 2 ? 21 : 11 }] });
      await service.updateTeamMatchAggregate(tx as unknown as Prisma.TransactionClient, encounter.matches[index].id);
    }
    return { tx, service, encounter, members, finish };
  }

  it('counts 3:0 immediately while keeping later children playable, and never counts their results', async () => {
    const { tx, service, encounter, members, finish } = setup();
    await finish(0, 1); await finish(1, 1);
    expect(members[0]).toMatchObject({ wins: 0, groupRank: null });
    await finish(2, 1);
    expect(encounter).toMatchObject({ status: 'LIVE', winnerTeamId: 'a', team1Wins: 3, team2Wins: 0 });
    expect(members[0]).toMatchObject({ wins: 1, matchesWon: 3, netMatches: 30, groupRank: 1 });
    expect(encounter.matches.slice(3).map(child => child.status)).toEqual(['PENDING', 'PENDING']);
    await finish(3, 2); await finish(4, 2);
    expect(encounter).toMatchObject({ status: 'COMPLETED', team1Wins: 3, team2Wins: 0 });
    expect(members[0]).toMatchObject({ wins: 1, matchesWon: 3, netMatches: 30 });
    expect(encounter.matches.filter(child => child.winnerSide === 2)).toHaveLength(2);
    await service.updateTeamMatchAggregate(tx as unknown as Prisma.TransactionClient, 'child5');
    expect(members[0].wins).toBe(1);
  });

  it('keeps the losing official item in a 3:1 score and ignores a fourth win', async () => {
    const { encounter, members, finish } = setup();
    for (const [index, side] of [1, 2, 1, 1, 1].entries()) await finish(index, side);
    expect(encounter).toMatchObject({ team1Wins: 3, team2Wins: 1 });
    expect(members[0]).toMatchObject({ wins: 1, matchesWon: 3, matchesLost: 1, netMatches: 20 });
  });

  it('still cancels remaining children when play-all is disabled', async () => {
    const { encounter, finish } = setup(false);
    await finish(0, 1); await finish(1, 1); await finish(2, 1);
    expect(encounter.status).toBe('COMPLETED');
    expect(encounter.matches.slice(3).map(child => child.status)).toEqual(['CANCELLED', 'CANCELLED']);
  });
});

describe('TeamCompetitionsService team names', () => {
  function setup(clash: { id: string } | null = null) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      team: {
        findFirst: jest.fn().mockResolvedValue(clash),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'newTeam', ...data })),
      },
      teamCompetition: { findUnique: jest.fn().mockResolvedValue({ isPublished: false }) },
      teamMatch: { count: jest.fn().mockResolvedValue(0), deleteMany: jest.fn() },
      player: { create: jest.fn().mockResolvedValue({ id: 'p9' }) },
    };
    const prisma = {
      teamCompetition: { findUnique: jest.fn().mockResolvedValue({ id: 'comp1', items: [] }) },
      player: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', name: '张三', gender: 'MALE', teamMembers: [] }]) },
      team: {
        findUnique: jest.fn().mockResolvedValue({ id: 'team2', teamCompetitionId: 'comp1', members: [] }),
        findFirst: jest.fn().mockResolvedValue(clash),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'team2', ...data })),
      },
      $transaction: jest.fn().mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const service = new TeamCompetitionsService(prisma as unknown as PrismaService);
    return { service, prisma, tx };
  }

  it('rejects adding a team whose name is already taken with 409 instead of a database error', async () => {
    const { service, tx } = setup({ id: 'team1' });
    await expect(service.createTeam('comp1', { name: '护理一队', affiliation: '护理', playerIds: ['p1'] }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('“护理一队”') });
    expect(tx.team.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { teamCompetitionId: 'comp1', name: '护理一队' } }));
    expect(tx.team.create).not.toHaveBeenCalled();
    expect(tx.teamMatch.deleteMany).not.toHaveBeenCalled();
  });

  it('trims the team name before checking and saving it', async () => {
    const { service, tx } = setup();
    await service.createTeam('comp1', { name: '  护理三队 ', affiliation: '护理', playerIds: ['p1'] });
    expect(tx.team.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { teamCompetitionId: 'comp1', name: '护理三队' } }));
    expect(tx.team.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: '护理三队' }) }));
  });

  it('rejects a blank team name with 400', async () => {
    const { service, tx } = setup();
    await expect(service.createTeam('comp1', { name: '   ', affiliation: '护理', playerIds: ['p1'] }))
      .rejects.toMatchObject({ status: 400 });
    expect(tx.team.create).not.toHaveBeenCalled();
  });

  it('rejects renaming a team to another team\'s name but ignores the team itself', async () => {
    const { service, prisma } = setup({ id: 'team1' });
    await expect(service.updateTeam('team2', { name: '护理一队' })).rejects.toMatchObject({ status: 409 });
    expect(prisma.team.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamCompetitionId: 'comp1', name: '护理一队', id: { not: 'team2' } },
    }));
    expect(prisma.team.update).not.toHaveBeenCalled();
  });

  it('updates other fields without a name check', async () => {
    const { service, prisma } = setup({ id: 'team1' });
    await service.updateTeam('team2', { affiliation: '临床' });
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
    expect(prisma.team.update).toHaveBeenCalledWith(expect.objectContaining({ data: { affiliation: '临床' } }));
  });

  it('turns a unique-index race on rename into 409', async () => {
    const { service, prisma } = setup();
    prisma.team.update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }));
    await expect(service.updateTeam('team2', { name: '护理一队' })).rejects.toMatchObject({ status: 409 });
  });

  it('rejects importing a single team under a taken name before creating any player', async () => {
    const { service, tx } = setup({ id: 'team1' });
    await expect(service.importTeamPlayers('comp1', { teamName: '护理一队', affiliation: '护理', players: [{ name: '李四', gender: 'MALE' }] } as never))
      .rejects.toMatchObject({ status: 409 });
    expect(tx.player.create).not.toHaveBeenCalled();
    expect(tx.team.create).not.toHaveBeenCalled();
  });
});

describe('团体赛出场项目：最多 7 项，同一项目可以重复', () => {
  it('同一项目可以重复出现（三单两双），按出场顺序排好；出场顺序重复仍然报错', () => {
    const service = new TeamCompetitionsService({} as PrismaService) as unknown as {
      normalizeItems(items: Array<{ eventType: string; sortOrder: number }>): Array<{ eventType: string; sortOrder: number }>;
    };
    const items = [
      { eventType: 'MENS_SINGLES', sortOrder: 3 },
      { eventType: 'MENS_SINGLES', sortOrder: 1 },
      { eventType: 'MENS_DOUBLES', sortOrder: 2 },
      { eventType: 'MENS_DOUBLES', sortOrder: 4 },
      { eventType: 'MENS_SINGLES', sortOrder: 5 },
    ];
    expect(service.normalizeItems(items).map((item) => `${item.sortOrder}.${item.eventType}`)).toEqual([
      '1.MENS_SINGLES', '2.MENS_DOUBLES', '3.MENS_SINGLES', '4.MENS_DOUBLES', '5.MENS_SINGLES',
    ]);
    expect(() => service.normalizeItems([{ eventType: 'MENS_SINGLES', sortOrder: 1 }, { eventType: 'WOMENS_SINGLES', sortOrder: 1 }]))
      .toThrow('出场顺序 1 重复');
  });

  it('请求里的出场项目超过 7 项会被拒绝，7 项可以', async () => {
    const { plainToInstance } = await import('class-transformer');
    const { validate } = await import('class-validator');
    const { UpdateTeamCompetitionDto, TEAM_ITEM_MAX } = await import('./dto/team-competition.dto');
    const items = (n: number) => Array.from({ length: n }, (_, index) => ({ eventType: 'MENS_SINGLES', sortOrder: index + 1 }));
    expect(TEAM_ITEM_MAX).toBe(7);
    const ok = await validate(plainToInstance(UpdateTeamCompetitionDto, { items: items(7) }));
    expect(ok.filter((error) => error.property === 'items')).toHaveLength(0);
    const tooMany = await validate(plainToInstance(UpdateTeamCompetitionDto, { items: items(8) }));
    expect(tooMany.find((error) => error.property === 'items')?.constraints).toHaveProperty('arrayMaxSize');
  });
});
