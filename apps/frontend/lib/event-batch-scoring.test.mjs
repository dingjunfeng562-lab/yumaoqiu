// 单项管理「批量改规则」的换算：cd apps/frontend && pnpm test（需要 Node 23.6+，可以直接 import .ts）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyScoringPatch, planBatchScoring, ruleChoiceError } from './event-batch-scoring.ts';

const ALL = ['QF', 'TOP4', 'SF', 'BRONZE', 'F'];
const WITH_GROUP = ['GROUP', 'KNOCKOUT', ...ALL];
const keysFor = (format) => (format === 'GROUP_PLUS_KNOCKOUT' ? WITH_GROUP : ALL);
const ev = (id, extra = {}) => ({
  id,
  format: 'SINGLE_ELIMINATION',
  scoringRule: 'TWENTYONE_BO3',
  scoringMode: 'CAPPED_30',
  customGamePoint: null,
  customGameCap: null,
  customGamesToWin: null,
  stageScoringRules: null,
  mixHostId: null,
  ...extra,
});
const plan = (events, change) => planBatchScoring(events, { stages: {}, ...change }, keysFor);

describe('默认规则', () => {
  it('改成预设：原来是自定义局点的，三个自定义字段一并清空', () => {
    const [p] = plan([ev('a', { customGamePoint: 11, customGameCap: 15, customGamesToWin: 1 })], {
      defaultRule: { kind: 'preset', scoringRule: 'TWENTYONE_BO3' },
    });
    assert.equal(p.status, 'change');
    assert.deepEqual(p.patch, { scoringRule: 'TWENTYONE_BO3', customGamePoint: null, customGameCap: null, customGamesToWin: null });
  });

  it('和现在一样的预设规则不提交', () => {
    const [p] = plan([ev('a')], { defaultRule: { kind: 'preset', scoringRule: 'TWENTYONE_BO3' } });
    assert.equal(p.status, 'same');
    assert.equal(p.patch, null);
  });

  it('改成自定义局点：没填封顶分时明确传 null，预设规则字段不动', () => {
    const [p] = plan([ev('a', { customGameCap: 30, customGamePoint: 21, customGamesToWin: 2 })], {
      defaultRule: { kind: 'custom', point: 15, gamesToWin: 2 },
    });
    assert.deepEqual(p.patch, { customGamePoint: 15, customGameCap: null, customGamesToWin: 2 });
  });

  it('只改计分模式时只提交 scoringMode', () => {
    const [p] = plan([ev('a')], { scoringMode: 'STANDARD_GOLDEN' });
    assert.deepEqual(p.patch, { scoringMode: 'STANDARD_GOLDEN' });
  });
});

describe('分阶段规则', () => {
  const staged = ev('a', { stageScoringRules: { TOP4: { scoringRule: 'FIFTEEN_BO3' }, F: { scoringRule: 'TWENTYONE_BO3' } } });

  it('只改决赛：四强等原有阶段保留', () => {
    const [p] = plan([staged], { stages: { F: { kind: 'custom', point: 21, cap: 30, gamesToWin: 2 }, TOP4: { kind: 'keep' } } });
    assert.deepEqual(p.patch, {
      stageScoringRules: {
        TOP4: { scoringRule: 'FIFTEEN_BO3' },
        F: { customGamePoint: 21, customGameCap: 30, customGamesToWin: 2 },
      },
    });
  });

  it('清除阶段：最后一个也清掉时整体传 null', () => {
    const [p] = plan([staged], { stages: { TOP4: { kind: 'clear' }, F: { kind: 'clear' } } });
    assert.deepEqual(p.patch, { stageScoringRules: null });
    const [q] = plan([staged], { stages: { F: { kind: 'clear' } } });
    assert.deepEqual(q.patch, { stageScoringRules: { TOP4: { scoringRule: 'FIFTEEN_BO3' } } });
  });

  it('清除一个本来就没设置的阶段算无变化', () => {
    const [p] = plan([staged], { stages: { SF: { kind: 'clear' } } });
    assert.equal(p.status, 'same');
  });

  it('改八强时去掉旧两段配置 BEFORE_TOP4；不改八强时保留', () => {
    const legacy = ev('a', { stageScoringRules: { BEFORE_TOP4: { scoringRule: 'FIFTEEN_ONE' } } });
    const [p] = plan([legacy], { stages: { QF: { kind: 'preset', scoringRule: 'FIFTEEN_BO3' } } });
    assert.deepEqual(p.patch, { stageScoringRules: { QF: { scoringRule: 'FIFTEEN_BO3' } } });
    const [q] = plan([legacy], { stages: { F: { kind: 'preset', scoringRule: 'FIFTEEN_BO3' } } });
    assert.deepEqual(q.patch, {
      stageScoringRules: { BEFORE_TOP4: { scoringRule: 'FIFTEEN_ONE' }, F: { scoringRule: 'FIFTEEN_BO3' } },
    });
  });

  it('赛制没有的阶段（单淘汰没有小组赛）跳过并记下来，有小组赛的赛制照改', () => {
    const [elim, group] = plan([ev('a'), ev('b', { format: 'GROUP_PLUS_KNOCKOUT' })], {
      stages: { GROUP: { kind: 'preset', scoringRule: 'FIFTEEN_ONE' } },
    });
    assert.equal(elim.status, 'same');
    assert.deepEqual(elim.skippedStages, ['GROUP']);
    assert.deepEqual(group.patch, { stageScoringRules: { GROUP: { scoringRule: 'FIFTEEN_ONE' } } });
    assert.deepEqual(group.skippedStages, []);
  });

  it('后端存的胜出局数默认 1，和没写胜出局数的同一规则视为相同', () => {
    const saved = ev('a', { stageScoringRules: { F: { customGamePoint: 15, customGameCap: null, customGamesToWin: 1 } } });
    const [p] = plan([saved], { stages: { F: { kind: 'custom', point: 15, gamesToWin: 1 } } });
    assert.equal(p.status, 'same');
  });
});

describe('跳过与预览', () => {
  it('并入混编的单项跳过，主项目照改', () => {
    const [member, host] = plan([ev('m', { mixHostId: 'h' }), ev('h')], { scoringMode: 'STANDARD_GOLDEN' });
    assert.equal(member.status, 'mix-member');
    assert.equal(member.patch, null);
    assert.equal(host.status, 'change');
  });

  it('预览：把要提交的字段套到单项上', () => {
    const event = ev('a');
    const [p] = plan([event], { defaultRule: { kind: 'custom', point: 11, gamesToWin: 1 } });
    const after = applyScoringPatch(event, p.patch);
    assert.equal(after.customGamePoint, 11);
    assert.equal(after.scoringRule, 'TWENTYONE_BO3');
    assert.equal(event.customGamePoint, null);
  });
});

describe('ruleChoiceError', () => {
  it('检查每局分数、胜出局数、封顶分', () => {
    assert.equal(ruleChoiceError({ kind: 'preset', scoringRule: 'FIFTEEN_ONE' }), null);
    assert.equal(ruleChoiceError({ kind: 'preset', scoringRule: '' }), '请选择计分规则');
    assert.equal(ruleChoiceError({ kind: 'custom', point: 0, gamesToWin: 1 }), '每局分数要在 1–999 之间');
    assert.equal(ruleChoiceError({ kind: 'custom', point: 21, gamesToWin: 0 }), '胜出局数要在 1–9 之间');
    assert.equal(ruleChoiceError({ kind: 'custom', point: 21, cap: 20, gamesToWin: 2 }), '封顶分不能小于每局分数');
    assert.equal(ruleChoiceError({ kind: 'custom', point: 21, cap: 30, gamesToWin: 2 }), null);
  });
});
