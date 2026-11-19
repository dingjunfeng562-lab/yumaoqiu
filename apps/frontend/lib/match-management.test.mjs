// 裁判员对局管理的纯逻辑：cd apps/frontend && node --test lib/match-management.test.mjs（需要能直接 import .ts 的 Node）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 比赛日按浏览器本地时间算；测试固定成北京时间，在 UTC 的机器上跑结果也一样。
process.env.TZ = 'Asia/Shanghai';
import {
  EMPTY_FILTERS,
  NONE,
  buildCourtBoard,
  describeLogChanges,
  filterMatches,
  filterTournaments,
  matchAttention,
  matchDateKey,
  pickInitialTournament,
  sortTournaments,
  statusTabCounts,
} from './match-management.ts';

const NOW = Date.parse('2026-11-20T10:00:00+08:00');
const at = (hhmm) => new Date(`2026-11-20T${hhmm}:00+08:00`).toISOString();
const venue = (id, sortOrder, isActive = true) => ({ id, name: `${id}号场`, isActive, sortOrder });

function match(overrides = {}) {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    code: null,
    eventId: 'ms',
    teamMatchId: null,
    teamCompetitionId: null,
    eventTypeLabel: '男子单打',
    itemTypeLabel: null,
    matchNo: 1,
    stageLabel: 'A组',
    stageOrder: 0,
    scheduledAt: null,
    status: 'PENDING',
    winnerSide: null,
    forfeitedSide: null,
    venue: null,
    referee: null,
    side1: { id: 's1', name: '张三', affiliation: '邯郸学院', players: [{ id: 'p1', index: 1, name: '张三', affiliation: '邯郸学院' }] },
    side2: { id: 's2', name: '李四', affiliation: '河北大学', players: [{ id: 'p2', index: 1, name: '李四', affiliation: '河北大学' }] },
    team1Name: null,
    team2Name: null,
    scoreText: '',
    hasBothSides: true,
    ...overrides,
  };
}

describe('需处理', () => {
  it('进行中没有裁判', () => {
    assert.deepEqual(matchAttention(match({ status: 'LIVE' }), NOW), ['NO_REFEREE']);
    assert.deepEqual(matchAttention(match({ status: 'LIVE', referee: { id: 'r', username: '裁判一' } }), NOW), []);
  });
  it('过了计划时间 15 分钟还没开始；双方没定、刚过 15 分钟以内、没排时间的不算', () => {
    assert.deepEqual(matchAttention(match({ scheduledAt: at('09:40') }), NOW), ['OVERDUE']);
    assert.deepEqual(matchAttention(match({ scheduledAt: at('09:50') }), NOW), []);
    assert.deepEqual(matchAttention(match({ scheduledAt: at('09:00'), hasBothSides: false }), NOW), []);
    assert.deepEqual(matchAttention(match({ scheduledAt: null }), NOW), []);
  });
  it('已分出胜负还没结束；已结束的不算', () => {
    assert.deepEqual(matchAttention(match({ status: 'LIVE', referee: { id: 'r', username: 'x' }, winnerSide: 1 }), NOW), ['UNFINISHED']);
    assert.deepEqual(matchAttention(match({ status: 'COMPLETED', winnerSide: 1 }), NOW), []);
  });
});

describe('状态标签和筛选', () => {
  const list = [
    match({ id: 'live-noref', status: 'LIVE', venue: venue('1', 1), scheduledAt: at('09:30') }),
    match({ id: 'live-ok', status: 'LIVE', venue: venue('2', 2), scheduledAt: at('09:30'), referee: { id: 'r1', username: '裁判一' } }),
    match({ id: 'pending', venue: venue('1', 1), scheduledAt: at('11:00'), code: '男单12' }),
    match({ id: 'unscheduled' }),
    match({ id: 'done', status: 'COMPLETED', winnerSide: 2, venue: venue('2', 2), scheduledAt: at('08:30'), eventId: 'ws', eventTypeLabel: '女子单打' }),
    match({ id: 'team', eventId: null, teamMatchId: 'tm', teamCompetitionId: 'tc', team1Name: '一中', team2Name: '二中', status: 'CANCELLED' }),
  ];
  it('标签数量：全部 / 进行中 / 未开始 / 已结束 / 待排时间 / 需处理 / 已取消', () => {
    assert.deepEqual(statusTabCounts(list, NOW), { ALL: 6, LIVE: 2, PENDING: 2, COMPLETED: 1, UNSCHEDULED: 1, ATTENTION: 1, CANCELLED: 1 });
  });
  const ids = (filters) => filterMatches(list, { ...EMPTY_FILTERS, ...filters }, NOW).map((m) => m.id);
  it('按标签、项目、场地、裁判、日期筛', () => {
    assert.deepEqual(ids({ tab: 'ATTENTION' }), ['live-noref']);
    assert.deepEqual(ids({ projects: ['E:ws', 'T:tc'] }), ['done', 'team']);
    assert.deepEqual(ids({ venues: [NONE] }), ['unscheduled', 'team']);
    assert.deepEqual(ids({ referees: ['r1'] }), ['live-ok']);
    assert.deepEqual(ids({ dates: [NONE] }), ['unscheduled', 'team']);
    assert.deepEqual(ids({ dates: ['2026-11-20'], tab: 'LIVE' }), ['live-noref', 'live-ok']);
  });
  it('搜索：场次号（带不带空格都行）、单位、队伍、裁判、场地、第几场', () => {
    assert.deepEqual(ids({ keyword: '男单 12' }), ['pending']);
    assert.deepEqual(ids({ keyword: '河北大学', tab: 'COMPLETED' }), ['done']);
    assert.deepEqual(ids({ keyword: '二中' }), ['team']);
    assert.deepEqual(ids({ keyword: '裁判一' }), ['live-ok']);
    assert.deepEqual(ids({ keyword: '2号场', tab: 'LIVE' }), ['live-ok']);
    assert.deepEqual(ids({ keyword: '不存在的人' }), []);
  });
  it('比赛日按本地时间', () => {
    assert.equal(matchDateKey({ scheduledAt: '2026-11-19T16:30:00.000Z' }), '2026-11-20');
    assert.equal(matchDateKey({ scheduledAt: null }), null);
  });
});

describe('场地视图', () => {
  it('每片场地：正在打的、接下来两场、还剩几场；没场地的进行中和待排单独列', () => {
    const venues = [venue('2', 2), venue('1', 1), venue('3', 3, false)];
    const board = buildCourtBoard([
      match({ id: 'a', status: 'LIVE', venue: venue('1', 1), scheduledAt: at('09:30') }),
      match({ id: 'b', venue: venue('1', 1), scheduledAt: at('11:00') }),
      match({ id: 'c', venue: venue('1', 1), scheduledAt: at('10:30') }),
      match({ id: 'd', venue: venue('1', 1), scheduledAt: at('11:30') }),
      match({ id: 'e', status: 'COMPLETED', venue: venue('2', 2), scheduledAt: at('08:00') }),
      match({ id: 'f', status: 'LIVE' }),
      match({ id: 'g' }),
      match({ id: 'h', venue: venue('1', 1) }),
    ], venues);
    assert.deepEqual(board.courts.map((c) => c.venue.id), ['1', '2']); // 停用且没有场次的 3 号场不显示
    assert.deepEqual(board.courts[0].live.map((m) => m.id), ['a']);
    assert.deepEqual(board.courts[0].next.map((m) => m.id), ['c', 'b']);
    assert.equal(board.courts[0].remaining, 3);
    assert.deepEqual(board.courts[1].live, []);
    assert.deepEqual(board.liveWithoutVenue.map((m) => m.id), ['f']);
    assert.deepEqual(board.unscheduled.map((m) => m.id), ['h', 'g']);
  });
});

describe('赛事列表', () => {
  const list = [
    { id: 'old', name: '去年的赛', status: 'FINISHED', startDate: '2025-10-01T00:00:00Z', endDate: '2025-10-02T00:00:00Z' },
    { id: 'soon2', name: '下月赛', status: 'REGISTRATION_OPEN', startDate: '2026-12-20T00:00:00Z', endDate: '2026-12-21T00:00:00Z', location: '邯郸' },
    { id: 'live', name: '新生杯', status: 'ONGOING', startDate: '2026-11-19T00:00:00Z', endDate: '2026-11-21T00:00:00Z', owner: 'organizer1' },
    { id: 'soon1', name: '周末赛', status: 'REGISTRATION_CLOSED', startDate: '2026-11-28T00:00:00Z', endDate: '2026-11-29T00:00:00Z' },
    { id: 'arch', name: '归档赛', status: 'FINISHED', startDate: '2026-11-01T00:00:00Z', endDate: '2026-11-02T00:00:00Z', isArchived: true },
    { id: 'recent', name: '上周赛', status: 'FINISHED', startDate: '2026-11-10T00:00:00Z', endDate: '2026-11-11T00:00:00Z' },
  ];
  it('排序：进行中 → 即将开始（近的在前）→ 已结束（近的在前）→ 归档', () => {
    assert.deepEqual(sortTournaments(list, NOW).map((t) => t.id), ['live', 'soon1', 'soon2', 'recent', 'old', 'arch']);
  });
  it('搜索：名称、地点、创建账号', () => {
    assert.deepEqual(filterTournaments(list, '邯郸').map((t) => t.id), ['soon2']);
    assert.deepEqual(filterTournaments(list, 'organizer').map((t) => t.id), ['live']);
    assert.deepEqual(filterTournaments(list, '').length, 6);
  });
  it('自动选赛事：上次选的优先；否则只有一个进行中的就选它', () => {
    assert.equal(pickInitialTournament(list, 'recent', NOW), 'recent');
    assert.equal(pickInitialTournament(list, 'deleted', NOW), 'live');
    assert.equal(pickInitialTournament([...list, { ...list[2], id: 'live2' }], null, NOW), null);
  });
});

describe('操作记录', () => {
  it('每个改动的字段写成「场地：1号场 → 2号场」', () => {
    const lines = describeLogChanges({
      id: 'x', action: 'UPDATE_INFO', operatorName: 'admin', createdAt: '',
      before: { referee: null, venue: '1号场', scheduledAt: '2026-11-20T01:00:00.000Z' },
      after: { referee: '裁判一', venue: '2号场', scheduledAt: '2026-11-20T02:00:00.000Z' },
    }, (iso) => iso.slice(11, 16));
    assert.deepEqual(lines, ['时间：01:00 → 02:00', '场地：1号场 → 2号场', '裁判：未分配 → 裁判一']);
    assert.deepEqual(describeLogChanges({ id: 'y', action: 'COMPLETE', operatorName: null, createdAt: '', before: { status: 'LIVE' }, after: { status: 'COMPLETED' } }, String), ['状态：进行中 → 已结束']);
  });
});
