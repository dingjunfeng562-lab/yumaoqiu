// 决赛 / 季军赛的识别和先后顺序：cd apps/frontend && pnpm test（需要 Node 23.6+，可以直接 import .ts）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bronzeGoesFirst, finalStage, orderFinalPair } from './match-display.ts';

const m = (id, roundLabel, extra = {}) => ({ id, roundNo: 3, roundLabel, ...extra });
const ids = (list) => list.map((item) => item.id);

describe('finalStage', () => {
  it('公开接口的「F组」（roundNo ≥ 1）和后台的「决赛」都算决赛', () => {
    assert.equal(finalStage(m('f', 'F组')), 'FINAL');
    assert.equal(finalStage(m('f', '决赛')), 'FINAL');
    assert.equal(finalStage(m('b', '季军赛')), 'BRONZE');
  });

  it('小组赛的 F 组、半决赛、排位赛「1-2 名决赛」都不算', () => {
    assert.equal(finalStage({ id: 'g', roundNo: 0, roundLabel: 'F组' }), null);
    assert.equal(finalStage(m('sf', '半决赛')), null);
    assert.equal(finalStage(m('p1', '1-2 名决赛')), null);
  });
});

describe('bronzeGoesFirst', () => {
  it('同一时间或都没排时间：季军赛在前', () => {
    assert.equal(bronzeGoesFirst({ scheduledAt: '2026-11-17T03:00:00Z' }, { scheduledAt: '2026-11-17T03:00:00Z' }), true);
    assert.equal(bronzeGoesFirst({}, {}), true);
  });

  it('按时间先后：季军赛更晚、或决赛排了时间而季军赛没排，决赛在前', () => {
    assert.equal(bronzeGoesFirst({ scheduledAt: '2026-11-17T02:30:00Z' }, { scheduledAt: '2026-11-17T02:00:00Z' }), false);
    assert.equal(bronzeGoesFirst({ scheduledAt: null }, { scheduledAt: '2026-11-17T02:00:00Z' }), false);
    assert.equal(bronzeGoesFirst({ scheduledAt: '2026-11-17T01:30:00Z' }, { scheduledAt: '2026-11-17T02:00:00Z' }), true);
  });
});

describe('orderFinalPair', () => {
  const at = (hhmm) => `2026-11-17T${hhmm}:00+08:00`;

  it('同一时间：决赛、季军赛对调，季军赛在前；其他场次位置不动', () => {
    const list = [m('sf1', '半决赛', { roundNo: 2 }), m('sf2', '半决赛', { roundNo: 2 }), m('f', 'F组', { scheduledAt: at('11:00') }), m('b', '季军赛', { scheduledAt: at('11:00') })];
    assert.deepEqual(ids(orderFinalPair(list)), ['sf1', 'sf2', 'b', 'f']);
  });

  it('都没排时间：季军赛在前', () => {
    assert.deepEqual(ids(orderFinalPair([m('f', '决赛'), m('b', '季军赛')])), ['b', 'f']);
  });

  it('季军赛排得比决赛晚：按时间，决赛在前', () => {
    const list = [m('b', '季军赛', { scheduledAt: at('10:30') }), m('f', '决赛', { scheduledAt: at('10:00') })];
    assert.deepEqual(ids(orderFinalPair(list)), ['f', 'b']);
  });

  it('已经是季军赛在前就不动，不改原数组', () => {
    const list = [m('b', '季军赛'), m('f', '决赛')];
    const result = orderFinalPair(list);
    assert.deepEqual(ids(result), ['b', 'f']);
    assert.notEqual(result, list);
  });

  it('多个项目混在一起（比分直播）：只对调同一项目的两场', () => {
    const row = (id, label, bracketId, status = 'PENDING') => m(id, label, { bracketId, status, scheduledAt: at('11:00') });
    const list = [row('A-f', '决赛', 'A'), row('A-b', '季军赛', 'A'), row('B-f', '决赛', 'B'), row('B-b', '季军赛', 'B')];
    const same = (a, b) => a.bracketId === b.bracketId && a.status === 'PENDING' && b.status === 'PENDING';
    assert.deepEqual(ids(orderFinalPair(list, same)), ['A-b', 'A-f', 'B-b', 'B-f']);
  });

  it('比分直播：季军赛已经开打（不在待开始里）就不对调', () => {
    const list = [m('f', '决赛', { bracketId: 'A', status: 'PENDING' }), m('b', '季军赛', { bracketId: 'A', status: 'LIVE' })];
    const same = (a, b) => a.bracketId === b.bracketId && a.status === 'PENDING' && b.status === 'PENDING';
    assert.deepEqual(ids(orderFinalPair(list, same)), ['f', 'b']);
  });
});
