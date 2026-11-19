import { computeMatchCodes, type CodeMatch } from './match-codes';

const at = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00+08:00`);
function m(id: string, patch: Partial<CodeMatch>): CodeMatch {
  return { id, eventId: null, teamMatchId: null, scheduledAt: null, venueId: null, venue: null, matchNo: 1, roundNo: 0, ...patch };
}

describe('场次号（和秩序册一致）', () => {
  it('单项：项目简称 + 序号，按时间、场地顺序；没排时间或场地的没有场次号', () => {
    const codes = computeMatchCodes({
      events: [{ id: 'ms', type: 'MENS_SINGLES', mixHostId: null }, { id: 'wd', type: 'WOMENS_DOUBLES', mixHostId: null }],
      teamCompetitionIds: [],
      teamCompetitionOf: () => null,
      matches: [
        m('b', { eventId: 'ms', scheduledAt: at('09:00'), venueId: 'v2', venue: { sortOrder: 2 } }),
        m('a', { eventId: 'ms', scheduledAt: at('09:00'), venueId: 'v1', venue: { sortOrder: 1 } }),
        m('c', { eventId: 'ms', scheduledAt: at('08:30'), venueId: 'v2', venue: { sortOrder: 2 } }),
        m('x', { eventId: 'ms' }),
        m('d', { eventId: 'wd', scheduledAt: at('10:00'), venueId: 'v1', venue: { sortOrder: 1 } }),
      ],
    });
    expect(Object.fromEntries(codes)).toEqual({ c: '男单1', a: '男单2', b: '男单3', d: '女双1' });
  });

  it('混编：项目不同时前缀用「单打」，项目相同照旧；并入的单项本身没有场次号', () => {
    const codes = computeMatchCodes({
      events: [
        { id: 'host', type: 'MENS_SINGLES', mixHostId: null },
        { id: 'guest', type: 'WOMENS_SINGLES', mixHostId: 'host' },
        { id: 'same', type: 'MENS_DOUBLES', mixHostId: null },
        { id: 'same-guest', type: 'MENS_DOUBLES', mixHostId: 'same' },
      ],
      teamCompetitionIds: [],
      teamCompetitionOf: () => null,
      matches: [
        m('h1', { eventId: 'host', scheduledAt: at('09:00'), venueId: 'v1', venue: { sortOrder: 1 } }),
        m('s1', { eventId: 'same', scheduledAt: at('09:00'), venueId: 'v1', venue: { sortOrder: 1 } }),
      ],
    });
    expect(Object.fromEntries(codes)).toEqual({ h1: '单打1', s1: '男双1' });
  });

  it('团体赛：统一「团体」，按团体赛创建顺序接着编', () => {
    const competitionOf: Record<string, string> = { t1: 'tc1', t2: 'tc1', t3: 'tc2', t4: 'tc1' };
    const codes = computeMatchCodes({
      events: [],
      teamCompetitionIds: ['tc1', 'tc2'],
      teamCompetitionOf: (match) => competitionOf[match.id] ?? null,
      matches: [
        m('t3', { teamMatchId: 'tm3', scheduledAt: at('08:00'), venueId: 'v1', venue: { sortOrder: 1 } }),
        m('t2', { teamMatchId: 'tm1', scheduledAt: at('09:30'), venueId: 'v1', venue: { sortOrder: 1 } }),
        m('t1', { teamMatchId: 'tm1', scheduledAt: at('09:00'), venueId: 'v1', venue: { sortOrder: 1 } }),
        m('t4', { teamMatchId: 'tm2' }),
      ],
    });
    expect(Object.fromEntries(codes)).toEqual({ t1: '团体1', t2: '团体2', t3: '团体3' });
  });
});
