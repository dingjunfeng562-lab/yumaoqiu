import { MatchStatus, Role, TournamentStatus } from '@prisma/client';
import {
  compareAllMatches,
  countAllMatchTabs,
  needsAttention,
  pageOf,
  splitIds,
  type LightMatch,
} from './all-matches';
import { AllMatchesService } from './all-matches.service';

const NOW = Date.parse('2026-11-20T02:00:00Z'); // 北京时间 10:00
const at = (iso: string) => new Date(iso);

function light(overrides: Partial<LightMatch> & { id: string }): LightMatch {
  return {
    status: MatchStatus.PENDING,
    scheduledAt: null,
    finishedAt: null,
    venueId: null,
    refereeId: null,
    side1Id: 'a',
    side2Id: 'b',
    winnerSide: null,
    roundNo: 1,
    matchNo: 1,
    venue: null,
    ...overrides,
  };
}

describe('全部场次的纯逻辑', () => {
  it('需处理：进行中没裁判、超时 15 分钟未开始、分出胜负没结束', () => {
    expect(
      needsAttention(light({ id: '1', status: MatchStatus.LIVE }), NOW),
    ).toBe(true);
    expect(
      needsAttention(
        light({ id: '2', status: MatchStatus.LIVE, refereeId: 'r' }),
        NOW,
      ),
    ).toBe(false);
    expect(
      needsAttention(
        light({ id: '3', scheduledAt: at('2026-11-20T01:44:00Z') }),
        NOW,
      ),
    ).toBe(true);
    expect(
      needsAttention(
        light({ id: '4', scheduledAt: at('2026-11-20T01:46:00Z') }),
        NOW,
      ),
    ).toBe(false);
    // 一方待定的不算超时
    expect(
      needsAttention(
        light({
          id: '5',
          side2Id: null,
          scheduledAt: at('2026-11-20T01:00:00Z'),
        }),
        NOW,
      ),
    ).toBe(false);
    expect(
      needsAttention(
        light({
          id: '6',
          status: MatchStatus.LIVE,
          refereeId: 'r',
          winnerSide: 2,
        }),
        NOW,
      ),
    ).toBe(true);
    expect(
      needsAttention(
        light({ id: '7', status: MatchStatus.COMPLETED, winnerSide: 1 }),
        NOW,
      ),
    ).toBe(false);
  });

  it('各标签数量', () => {
    const counts = countAllMatchTabs(
      [
        light({
          id: 'live',
          status: MatchStatus.LIVE,
          refereeId: 'r',
          venueId: 'v',
          scheduledAt: at('2026-11-20T01:50:00Z'),
        }),
        light({
          id: 'todo',
          venueId: 'v',
          scheduledAt: at('2026-11-20T03:00:00Z'),
        }),
        light({ id: 'novenue', scheduledAt: at('2026-11-20T03:00:00Z') }),
        light({ id: 'notime' }),
        light({
          id: 'late',
          venueId: 'v',
          scheduledAt: at('2026-11-20T01:00:00Z'),
        }),
        light({ id: 'done', status: MatchStatus.COMPLETED, winnerSide: 1 }),
        light({ id: 'gone', status: MatchStatus.CANCELLED }),
      ],
      NOW,
    );
    expect(counts).toEqual({
      ALL: 7,
      LIVE: 1,
      PENDING: 4,
      COMPLETED: 1,
      UNSCHEDULED: 2,
      ATTENTION: 1,
      CANCELLED: 1,
    });
  });

  it('排序：进行中 → 未开始按时间（没排时间的在后）→ 已结束最近的在前 → 已取消', () => {
    const list = [
      light({ id: 'gone', status: MatchStatus.CANCELLED }),
      light({
        id: 'done-old',
        status: MatchStatus.COMPLETED,
        finishedAt: at('2026-11-19T02:00:00Z'),
      }),
      light({ id: 'notime' }),
      light({ id: 'p-later', scheduledAt: at('2026-11-20T05:00:00Z') }),
      light({
        id: 'done-new',
        status: MatchStatus.COMPLETED,
        finishedAt: at('2026-11-20T01:00:00Z'),
      }),
      light({
        id: 'p-court2',
        scheduledAt: at('2026-11-20T03:00:00Z'),
        venue: { sortOrder: 2 },
      }),
      light({
        id: 'p-court1',
        scheduledAt: at('2026-11-20T03:00:00Z'),
        venue: { sortOrder: 1 },
      }),
      light({
        id: 'live',
        status: MatchStatus.LIVE,
        scheduledAt: at('2026-11-20T09:00:00Z'),
      }),
    ];
    expect(list.sort(compareAllMatches).map((item) => item.id)).toEqual([
      'live',
      'p-court1',
      'p-court2',
      'p-later',
      'notime',
      'done-new',
      'done-old',
      'gone',
    ]);
  });

  it('分页：页码超出落到最后一页', () => {
    const list = Array.from({ length: 45 }, (_, index) => index);
    expect(pageOf(list, 2, 20)).toEqual({ page: 2, items: list.slice(20, 40) });
    expect(pageOf(list, 9, 20)).toEqual({ page: 3, items: list.slice(40) });
    expect(pageOf([], 3, 20)).toEqual({ page: 1, items: [] });
  });

  it('赛事 id 列表去空去重', () => {
    expect(splitIds(' t1, ,t2,t1 ')).toEqual(['t1', 't2']);
    expect(splitIds(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------- 服务（Prisma 替身）

type FakeMatch = {
  id: string;
  eventId: string | null;
  teamMatchId: string | null;
  teamMatch: {
    teamCompetitionId: string;
    team1Id: string;
    team2Id: string;
  } | null;
  status: MatchStatus;
  scheduledAt: Date | null;
  finishedAt: Date | null;
  venueId: string | null;
  venue: { name: string; sortOrder: number } | null;
  refereeId: string | null;
  referee: { username: string } | null;
  side1Id: string | null;
  side2Id: string | null;
  winnerSide: number | null;
  roundNo: number;
  matchNo: number;
};

const TOURNAMENTS = [
  {
    id: 't-a',
    name: '甲的公开赛',
    submittedById: 'admin-a',
    status: TournamentStatus.ONGOING,
    isArchived: false,
  },
  {
    id: 't-a-old',
    name: '甲的旧比赛',
    submittedById: 'admin-a',
    status: TournamentStatus.FINISHED,
    isArchived: false,
  },
  {
    id: 't-b',
    name: '乙的邀请赛',
    submittedById: 'admin-b',
    status: TournamentStatus.ONGOING,
    isArchived: false,
  },
];
const EVENTS = [
  {
    id: 'e-a-ms',
    tournamentId: 't-a',
    type: 'MENS_SINGLES',
    groupLabel: '甲组',
    mixHostId: null,
  },
  {
    id: 'e-a-ws',
    tournamentId: 't-a',
    type: 'WOMENS_SINGLES',
    groupLabel: null,
    mixHostId: null,
  },
  {
    id: 'e-old',
    tournamentId: 't-a-old',
    type: 'MENS_SINGLES',
    groupLabel: null,
    mixHostId: null,
  },
  {
    id: 'e-b',
    tournamentId: 't-b',
    type: 'MENS_SINGLES',
    groupLabel: null,
    mixHostId: null,
  },
];
const COMPETITIONS = [{ id: 'tc-a', tournamentId: 't-a', name: '教工团体' }];
const REGISTRATIONS = [
  { id: 'r-zhang', eventId: 'e-a-ms', names: ['张三', '一中'] },
  { id: 'r-li', eventId: 'e-a-ms', names: ['李四', '二中'] },
  { id: 'r-wang', eventId: 'e-a-ws', names: ['王五', '一中'] },
  { id: 'r-zhao', eventId: 'e-a-ws', names: ['赵六', '三中'] },
];

function m(overrides: Partial<FakeMatch> & { id: string }): FakeMatch {
  return {
    eventId: 'e-a-ms',
    teamMatchId: null,
    teamMatch: null,
    status: MatchStatus.PENDING,
    scheduledAt: null,
    finishedAt: null,
    venueId: null,
    venue: null,
    refereeId: null,
    referee: null,
    side1Id: 'r-zhang',
    side2Id: 'r-li',
    winnerSide: null,
    roundNo: 1,
    matchNo: 1,
    ...overrides,
  };
}

const court = (n: number) => ({
  venueId: `v${n}`,
  venue: { name: `${n}号场`, sortOrder: n },
});

const MATCHES: FakeMatch[] = [
  m({
    id: 'a-ms-live',
    status: MatchStatus.LIVE,
    refereeId: 'ref',
    referee: { username: '裁判小周' },
    scheduledAt: at('2026-11-20T01:30:00Z'),
    ...court(1),
    matchNo: 1,
  }),
  m({
    id: 'a-ms-next',
    scheduledAt: at('2026-11-20T03:00:00Z'),
    ...court(2),
    matchNo: 2,
  }),
  m({
    id: 'a-ms-tomorrow',
    scheduledAt: at('2026-11-21T01:00:00Z'),
    ...court(1),
    matchNo: 3,
  }),
  m({ id: 'a-ms-unsched', matchNo: 4 }),
  m({
    id: 'a-ws-done',
    eventId: 'e-a-ws',
    side1Id: 'r-wang',
    side2Id: 'r-zhao',
    status: MatchStatus.COMPLETED,
    winnerSide: 1,
    scheduledAt: at('2026-11-20T00:30:00Z'),
    finishedAt: at('2026-11-20T01:00:00Z'),
    ...court(3),
  }),
  m({
    id: 'a-team-1',
    eventId: null,
    teamMatchId: 'tm1',
    teamMatch: {
      teamCompetitionId: 'tc-a',
      team1Id: 'team-x',
      team2Id: 'team-y',
    },
    side1Id: 'lineup:1',
    side2Id: 'lineup:2',
    scheduledAt: at('2026-11-20T04:00:00Z'),
    ...court(1),
  }),
  m({
    id: 'old-1',
    eventId: 'e-old',
    status: MatchStatus.PENDING,
    scheduledAt: at('2026-10-01T01:00:00Z'),
    ...court(1),
  }),
  m({
    id: 'b-1',
    eventId: 'e-b',
    side1Id: 'r-b1',
    side2Id: 'r-b2',
    scheduledAt: at('2026-11-20T03:00:00Z'),
    ...court(1),
  }),
];

type IdIn = { in: string[] };
/** 服务里会用到的那几种 Prisma 条件（替身只认这些，认不出来就报错）。 */
type FakeWhere = {
  AND?: FakeWhere[];
  OR?: FakeWhere[];
  eventId?: IdIn;
  side1Id?: IdIn;
  side2Id?: IdIn;
  id?: IdIn;
  teamMatch?: {
    teamCompetitionId?: IdIn;
    OR?: Array<{ team1Id?: IdIn; team2Id?: IdIn }>;
  };
  scheduledAt?: { gte?: Date; lt?: Date };
  venue?: { name: { contains: string } };
  referee?: { username: { contains: string } };
};
type TournamentWhere = {
  submittedById?: string;
  isArchived?: boolean;
  status?: { not: TournamentStatus };
  id?: IdIn;
};
type InTournaments = { where: { tournamentId: IdIn } };
type RegistrationWhere = {
  where: {
    eventId: IdIn;
    OR: Array<{ player1?: { name?: { contains: string } } }>;
  };
};

function matchesWhere(match: FakeMatch, where: FakeWhere | undefined): boolean {
  if (!where) return true;
  if (where.AND) return where.AND.every((part) => matchesWhere(match, part));
  if (where.OR) return where.OR.some((part) => matchesWhere(match, part));
  if (where.eventId?.in)
    return match.eventId !== null && where.eventId.in.includes(match.eventId);
  if (where.side1Id?.in)
    return match.side1Id !== null && where.side1Id.in.includes(match.side1Id);
  if (where.side2Id?.in)
    return match.side2Id !== null && where.side2Id.in.includes(match.side2Id);
  if (where.id?.in) return where.id.in.includes(match.id);
  if (where.teamMatch) {
    const teamMatch = match.teamMatch;
    if (!teamMatch) return false;
    if (where.teamMatch.teamCompetitionId?.in)
      return where.teamMatch.teamCompetitionId.in.includes(
        teamMatch.teamCompetitionId,
      );
    if (where.teamMatch.OR) {
      return where.teamMatch.OR.some(
        (part) =>
          (part.team1Id?.in ?? []).includes(teamMatch.team1Id) ||
          (part.team2Id?.in ?? []).includes(teamMatch.team2Id),
      );
    }
    return false;
  }
  if (where.scheduledAt) {
    if (!match.scheduledAt) return false;
    const time = match.scheduledAt.getTime();
    if (where.scheduledAt.gte && time < where.scheduledAt.gte.getTime())
      return false;
    if (where.scheduledAt.lt && time >= where.scheduledAt.lt.getTime())
      return false;
    return true;
  }
  if (where.venue) {
    const keyword = where.venue.name.contains;
    return Boolean(match.venue?.name.includes(keyword));
  }
  if (where.referee) {
    const keyword = where.referee.username.contains;
    return Boolean(match.referee?.username.includes(keyword));
  }
  throw new Error(`替身不认识的条件：${JSON.stringify(where)}`);
}

function buildService() {
  const tournamentWheres: TournamentWhere[] = [];
  const prisma = {
    tournament: {
      findMany: jest.fn(({ where }: { where: TournamentWhere }) => {
        tournamentWheres.push(where);
        const status = where.status?.not;
        const ids = where.id?.in;
        return Promise.resolve(
          TOURNAMENTS.filter(
            (t) =>
              (!where.submittedById ||
                t.submittedById === where.submittedById) &&
              (where.isArchived === undefined ||
                t.isArchived === where.isArchived) &&
              (!status || t.status !== status) &&
              (!ids || ids.includes(t.id)),
          ).map(({ id, name }) => ({ id, name })),
        );
      }),
    },
    event: {
      findMany: jest.fn(({ where }: InTournaments) =>
        Promise.resolve(
          EVENTS.filter((e) => where.tournamentId.in.includes(e.tournamentId)),
        ),
      ),
    },
    teamCompetition: {
      findMany: jest.fn(({ where }: InTournaments) =>
        Promise.resolve(
          COMPETITIONS.filter((c) =>
            where.tournamentId.in.includes(c.tournamentId),
          ),
        ),
      ),
    },
    registration: {
      findMany: jest.fn(({ where }: RegistrationWhere) => {
        const keyword = where.OR[0].player1?.name?.contains ?? '';
        return Promise.resolve(
          REGISTRATIONS.filter(
            (r) =>
              where.eventId.in.includes(r.eventId) &&
              r.names.some((name) => name.includes(keyword)),
          ).map(({ id }) => ({ id })),
        );
      }),
    },
    team: { findMany: jest.fn(() => Promise.resolve([])) },
    match: {
      findMany: jest.fn(({ where }: { where: FakeWhere }) =>
        Promise.resolve(MATCHES.filter((match) => matchesWhere(match, where))),
      ),
    },
  };
  const LABELS: Record<string, string> = {
    MENS_SINGLES: '男子单打',
    WOMENS_SINGLES: '女子单打',
  };
  const matchManagement = {
    matchViewsByIds: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids.map((id) => {
          const match = MATCHES.find((item) => item.id === id) as FakeMatch;
          const event = EVENTS.find((item) => item.id === match.eventId);
          return {
            id,
            eventId: match.eventId,
            teamMatchId: match.teamMatchId,
            teamCompetitionId: match.teamMatch?.teamCompetitionId ?? null,
            eventTypeLabel: event ? LABELS[event.type] : '团体赛',
            itemTypeLabel: match.teamMatch ? '男子单打' : null,
            status: match.status,
          };
        }),
      ),
    ),
  };
  const service = new AllMatchesService(
    prisma as never,
    matchManagement as never,
  );
  return { service, prisma, tournamentWheres, matchManagement };
}

const ADMIN_A = { id: 'admin-a', role: Role.ADMIN };
const ROOT = { id: 'root', role: Role.ROOT };

describe('AllMatchesService.list', () => {
  it('管理员只看到自己赛事的场次，默认只看未结束的赛事；顺序、数量、赛事名、项目名都带上', async () => {
    const { service, tournamentWheres } = buildService();
    const result = await service.list(ADMIN_A, {}, NOW);
    expect(tournamentWheres[0]).toMatchObject({
      submittedById: 'admin-a',
      isArchived: false,
      status: { not: TournamentStatus.FINISHED },
    });
    expect(result.items.map((item) => item.id)).toEqual([
      'a-ms-live',
      'a-ms-next',
      'a-team-1',
      'a-ms-tomorrow',
      'a-ms-unsched',
      'a-ws-done',
    ]);
    expect(result.total).toBe(6);
    expect(result.counts).toEqual({
      ALL: 6,
      LIVE: 1,
      PENDING: 4,
      COMPLETED: 1,
      UNSCHEDULED: 1,
      ATTENTION: 0,
      CANCELLED: 0,
    });
    const first = result.items[0];
    expect(first).toMatchObject({
      tournamentId: 't-a',
      tournamentName: '甲的公开赛',
      projectLabel: '甲组 · 男子单打',
    });
    expect(result.items.find((item) => item.id === 'a-team-1')).toMatchObject({
      projectLabel: '团体 · 教工团体 · 男子单打',
    });
  });

  it('别人的赛事 id 传进来也看不到；去掉「只看未结束」能看到自己已结束的赛事', async () => {
    const { service } = buildService();
    const foreign = await service.list(ADMIN_A, { tournaments: 't-b' }, NOW);
    expect(foreign.items).toEqual([]);
    expect(foreign.total).toBe(0);

    const all = await service.list(ADMIN_A, { activeOnly: '0' }, NOW);
    expect(all.items.map((item) => item.id)).toContain('old-1');
    expect(all.items.map((item) => item.id)).not.toContain('b-1');
    // 旧比赛那场早过了时间、双方都有：算需处理
    expect(all.counts.ATTENTION).toBe(1);
  });

  it('超级管理员看全部赛事', async () => {
    const { service, tournamentWheres } = buildService();
    const result = await service.list(ROOT, {}, NOW);
    expect(tournamentWheres[0]).not.toHaveProperty('submittedById');
    expect(result.items.map((item) => item.id)).toContain('b-1');
    expect(result.items.find((item) => item.id === 'b-1')).toMatchObject({
      tournamentName: '乙的邀请赛',
    });
  });

  it('状态标签 + 分页', async () => {
    const { service } = buildService();
    const pending = await service.list(
      ADMIN_A,
      { tab: 'PENDING', pageSize: 20 },
      NOW,
    );
    expect(pending.items.map((item) => item.id)).toEqual([
      'a-ms-next',
      'a-team-1',
      'a-ms-tomorrow',
      'a-ms-unsched',
    ]);
    expect(pending.total).toBe(4);
    // 数量是所有标签的，不随当前标签变
    expect(pending.counts.ALL).toBe(6);

    const { service: service2, matchManagement } = buildService();
    const page = await service2.list(ADMIN_A, { pageSize: 20, page: 5 }, NOW);
    expect(page.page).toBe(1);
    expect(matchManagement.matchViewsByIds).toHaveBeenCalledTimes(1);
  });

  it('日期范围：只要这段时间里的（没排时间的不算）', async () => {
    const { service } = buildService();
    const today = await service.list(
      ADMIN_A,
      { from: '2026-11-19T16:00:00.000Z', to: '2026-11-20T16:00:00.000Z' },
      NOW,
    );
    expect(today.items.map((item) => item.id)).toEqual([
      'a-ms-live',
      'a-ms-next',
      'a-team-1',
      'a-ws-done',
    ]);
  });

  it('关键词：选手名、单位、场地、裁判、项目名、团体赛名、赛事名', async () => {
    const { service } = buildService();
    const ids = async (q: string) =>
      (await service.list(ADMIN_A, { q }, NOW)).items
        .map((item) => item.id)
        .sort();
    expect(await ids('王五')).toEqual(['a-ws-done']);
    expect(await ids('一中')).toEqual([
      'a-ms-live',
      'a-ms-next',
      'a-ms-tomorrow',
      'a-ms-unsched',
      'a-ws-done',
    ]);
    expect(await ids('3号场')).toEqual(['a-ws-done']);
    expect(await ids('小周')).toEqual(['a-ms-live']);
    expect(await ids('女单')).toEqual(['a-ws-done']);
    expect(await ids('甲组 男单')).toEqual([
      'a-ms-live',
      'a-ms-next',
      'a-ms-tomorrow',
      'a-ms-unsched',
    ]);
    expect(await ids('教工')).toEqual(['a-team-1']);
    expect(await ids('公开赛')).toHaveLength(6);
    expect(await ids('查无此人')).toEqual([]);
  });

  it('场次号按整个赛事编，和秩序册一致；没排时间场地的没有', async () => {
    const { service } = buildService();
    const result = await service.list(ADMIN_A, { tab: 'PENDING' }, NOW);
    const code = (id: string) =>
      result.items.find((item) => item.id === id)?.code;
    // 男单排了时间场地的有 live / next / tomorrow 三场，按时间编号
    expect(code('a-ms-next')).toBe('男单2');
    expect(code('a-ms-tomorrow')).toBe('男单3');
    expect(code('a-ms-unsched')).toBeNull();
    expect(code('a-team-1')).toBe('团体1');
  });
});
