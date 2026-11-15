// 组别报名表的即时提示单测：cd apps/frontend && pnpm test（需要 Node 23.6+，可以直接 import .ts）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { genderConflicts, reportedAgeError } from './registration-groups.ts';

const ev = (id, type) => ({ id, type, label: `学生组 · ${id}` });

describe('genderConflicts：性别和所选项目对不上时提示', () => {
  it('女生报男单、男生报女双时提示本人性别', () => {
    assert.deepEqual(genderConflicts([ev('男单', 'MENS_SINGLES')], 'FEMALE').own, ['「学生组 · 男单」仅限男性报名，请核对本人性别或所选项目']);
    assert.equal(genderConflicts([ev('女双', 'WOMENS_DOUBLES')], 'MALE').own.length, 1);
  });

  it('同性双打的搭档性别不符、混双两人同性时提示搭档性别', () => {
    const result = genderConflicts([ev('男双', 'MENS_DOUBLES'), ev('混双', 'MIXED_DOUBLES')], 'MALE', { 男双: 'FEMALE', 混双: 'MALE' });
    assert.deepEqual(result.own, []);
    assert.equal(result.partner.男双, '「学生组 · 男双」的搭档须为男性，请核对搭档性别');
    assert.equal(result.partner.混双, '「学生组 · 混双」须一男一女，请核对本人和搭档的性别');
  });

  it('性别相符或没填性别时不提示', () => {
    const events = [ev('男单', 'MENS_SINGLES'), ev('混双', 'MIXED_DOUBLES')];
    assert.deepEqual(genderConflicts(events, 'MALE', { 混双: 'FEMALE' }), { own: [], partner: {} });
    assert.deepEqual(genderConflicts(events, undefined, {}), { own: [], partner: {} });
    assert.deepEqual(genderConflicts([ev('混双', 'MIXED_DOUBLES')], 'FEMALE', { 混双: null }), { own: [], partner: {} });
  });
});

describe('reportedAgeError：只填年龄时超出本组年龄范围提示', () => {
  const u12 = { mode: 'AGE', maxAge: 12, cutoffDate: '2026-11-15' };
  it('超出范围提示，范围内和没填不提示', () => {
    assert.equal(reportedAgeError(u12, 13), '不符合本组年龄条件，请核对资料或联系组委会');
    assert.equal(reportedAgeError(u12, 12), null);
    assert.equal(reportedAgeError(u12, null), null);
    assert.equal(reportedAgeError({ mode: 'NONE' }, 99), null);
  });
  it('不含边界和按年龄填写的组别', () => {
    assert.equal(reportedAgeError({ mode: 'AGE', minAge: 8, minInclusive: false, cutoffDate: '2026-11-15' }, 8), '不符合本组年龄条件，请核对资料或联系组委会');
    assert.equal(reportedAgeError({ mode: 'BIRTH_DATE', minDate: '2016-01-01', ageInput: { basis: 'YEAR', minAge: 8, maxAge: 10, refDate: '2026-01-01' } }, 11), '不符合本组年龄条件，请核对资料或联系组委会');
    // 只按出生日期设的组无法用年龄判断，不提示
    assert.equal(reportedAgeError({ mode: 'BIRTH_DATE', minDate: '2016-01-01' }, 30), null);
  });
});
