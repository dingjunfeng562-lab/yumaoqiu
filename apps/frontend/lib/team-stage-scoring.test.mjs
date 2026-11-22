// 团体赛分阶段计分的文字与表单换算单测：cd apps/frontend && pnpm test（需要 Node 23.6+，可以直接 import .ts）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoringRuleText,
  teamScoringSummary,
  teamStageFormValues,
  teamStagePayload,
} from './team-stage-scoring.ts';

const base = { scoringRule: 'TWENTYONE_BO3', customGamePoint: null, customGamesToWin: null };

describe('团体赛子项计分文字', () => {
  it('预设与自定义规则', () => {
    assert.equal(scoringRuleText(base), '21 分 3 局 2 胜');
    assert.equal(scoringRuleText({ scoringRule: 'FIFTEEN_ONE' }), '15 分 1 局');
    assert.equal(scoringRuleText({ scoringRule: 'TWENTYONE_BO3', customGamePoint: 11, customGamesToWin: 1 }), '11 分 1 局');
  });

  it('分阶段时分别写出小组赛、淘汰赛', () => {
    const competition = {
      ...base,
      stageScoringRules: {
        GROUP: { customGamePoint: 21, customGameCap: null, customGamesToWin: 1 },
        KNOCKOUT: { scoringRule: 'FIFTEEN_BO3' },
      },
    };
    assert.equal(teamScoringSummary(competition), '小组赛 21 分 1 局，淘汰赛 15 分 3 局 2 胜');
  });

  it('只设一个阶段时，另一个阶段写默认规则；都没设时只写默认规则', () => {
    assert.equal(
      teamScoringSummary({ ...base, stageScoringRules: { KNOCKOUT: { scoringRule: 'FIFTEEN_ONE' } } }),
      '小组赛 21 分 3 局 2 胜，淘汰赛 15 分 1 局',
    );
    assert.equal(teamScoringSummary({ ...base, stageScoringRules: null }), '21 分 3 局 2 胜');
    assert.equal(teamScoringSummary(base), '21 分 3 局 2 胜');
  });

  it('阶段选了预设时不继承默认规则里的自定义分数（与后端一致）', () => {
    const competition = { scoringRule: 'TWENTYONE_BO3', customGamePoint: 11, customGamesToWin: 1, stageScoringRules: { KNOCKOUT: { scoringRule: 'FIFTEEN_BO3' } } };
    assert.equal(teamScoringSummary(competition), '小组赛 11 分 1 局，淘汰赛 15 分 3 局 2 胜');
  });
});

describe('分阶段计分表单换算', () => {
  it('已保存的规则 → 表单 → 提交，来回一致', () => {
    const rules = {
      GROUP: { customGamePoint: 21, customGameCap: null, customGamesToWin: 1 },
      KNOCKOUT: { scoringRule: 'FIFTEEN_BO3' },
    };
    const form = teamStageFormValues(rules);
    assert.equal(form.GROUP.mode, 'custom');
    assert.equal(form.KNOCKOUT.mode, 'FIFTEEN_BO3');
    assert.deepEqual(teamStagePayload(form), rules);
  });

  it('全部为「同默认」或没填分数时提交 null', () => {
    assert.equal(teamStagePayload(teamStageFormValues(null)), null);
    assert.equal(teamStagePayload({ GROUP: { mode: 'custom', point: null } }), null);
    assert.equal(teamStagePayload(undefined), null);
  });

  it('自定义没填局数时按 1 局', () => {
    assert.deepEqual(teamStagePayload({ GROUP: { mode: 'custom', point: 21 } }), {
      GROUP: { customGamePoint: 21, customGameCap: null, customGamesToWin: 1 },
    });
  });
});
