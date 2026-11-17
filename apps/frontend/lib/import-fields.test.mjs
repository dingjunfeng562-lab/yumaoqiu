// 批量导入按组别报名字段的检查：cd apps/frontend && node --test lib/import-fields.test.mjs（需要能直接 import .ts 的 Node）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkTeamRows,
  duplicateIdentities,
  identityForSubmit,
  identityImportCheck,
  identityNumberError,
  ignoredFieldsNotice,
  importFieldRules,
  lenientWarningNotice,
  maskIdentityNumber,
  parseTeamRosterText,
  warningConfirmLines,
} from './import-fields.ts';

// 校验位正确的号码：2015-03-01、1990-03-07、2012-06-15 出生
const KID = '110105201503010010';
const KID2 = '110105201503010029';
const ADULT = '110105199003070033';
const TEEN = '440306201206150045';

const fields = (overrides = {}) => ({
  identityNumber: 'optional', gender: 'optional', studentId: 'hidden', college: 'hidden',
  majorGrade: 'hidden', email: 'optional', age: 'hidden', shirtSize: 'hidden', ...overrides,
});
const PRIMARY = { mode: 'BIRTH_DATE', minDate: '2014-09-01', maxDate: '2020-08-31', minInclusive: true, maxInclusive: true };

describe('importFieldRules', () => {
  it('没有组别时与服务端老规则一致：不收身份证号、性别必填', () => {
    const rules = importFieldRules(null, null);
    assert.equal(rules.grouped, false);
    assert.equal(rules.fields.identityNumber, 'hidden');
    assert.equal(rules.fields.gender, 'required');
  });
  it('有组别时按组别设置', () => {
    const rules = importFieldRules(fields({ identityNumber: 'required' }), PRIMARY);
    assert.equal(rules.grouped, true);
    assert.equal(rules.fields.identityNumber, 'required');
    assert.deepEqual(rules.ageRule, PRIMARY);
  });
});

describe('身份证号检查', () => {
  it('格式、校验位、出生日期', () => {
    assert.equal(identityNumberError(KID), undefined);
    assert.equal(identityNumberError('11010520150301001X'), '身份证号校验位有误');
    assert.equal(identityNumberError('1101052015'), '身份证号不是18位有效号码');
    assert.equal(identityNumberError(' 1101 0520 1503 0100 10 '), undefined, '中间的空格去掉再判断');
  });
  it('本组年龄条件（按出生日期）', () => {
    assert.equal(identityNumberError(KID, PRIMARY), undefined);
    assert.match(identityNumberError(ADULT, PRIMARY), /^不符合本组年龄条件（出生日期 1990-03-07）$/);
  });
  it('本组年龄条件（按周岁）', () => {
    const u12 = { mode: 'AGE', cutoffDate: '2026-12-05', maxAge: 12, maxInclusive: true };
    assert.equal(identityNumberError(KID, u12, '2026-11-17'), undefined);
    assert.match(identityNumberError(ADULT, u12, '2026-11-17'), /不符合本组年龄条件/);
  });
  it('后台批量导入：必填没填、号码有误、年龄不符只提醒；有误的号码不提交', () => {
    const required = importFieldRules(fields({ identityNumber: 'required' }), PRIMARY);
    const optional = importFieldRules(fields(), null);
    const hidden = importFieldRules(fields({ identityNumber: 'hidden' }), null);
    assert.deepEqual(identityImportCheck('', required), { warning: '未填身份证号（本组必填）' });
    assert.deepEqual(identityImportCheck(undefined, required, '搭档'), { warning: '搭档未填身份证号（本组必填）' });
    assert.deepEqual(identityImportCheck('', optional), {});
    assert.deepEqual(identityImportCheck('123', hidden), {}, '不收集时不检查、不提交');
    assert.deepEqual(identityImportCheck('123', optional, '队友'), { warning: '队友身份证号不是18位有效号码，不保存' });
    assert.deepEqual(identityImportCheck('11010520150301001X', required), { warning: '身份证号校验位有误，不保存' });
    assert.deepEqual(identityImportCheck(ADULT, required), { submit: ADULT, warning: '不符合本组年龄条件（出生日期 1990-03-07）' }, '年龄不符：号码照样保存');
    assert.deepEqual(identityImportCheck(` ${KID.slice(0, 6)} ${KID.slice(6)} `, required), { submit: KID });
    assert.equal(identityForSubmit('11010520150301001X', required), undefined);
    assert.equal(identityForSubmit(KID, hidden), undefined);
    assert.equal(identityForSubmit(KID, optional), KID);
  });
  it('标黄说明和确认框内容', () => {
    assert.equal(lenientWarningNotice(0), undefined);
    assert.match(lenientWarningNotice(3), /^有 3 条标黄提醒.*照常导入.*不保存.*「未核验」.*再确认一次。$/);
    const items = Array.from({ length: 12 }, (_, i) => ({ row: i + 1, name: i ? `队员${i}` : '', warning: '未填身份证号（本组必填）' }));
    const lines = warningConfirmLines(items);
    assert.equal(lines.length, 11);
    assert.equal(lines[0], '第 1 行：未填身份证号（本组必填）');
    assert.equal(lines[1], '第 2 行 队员1：未填身份证号（本组必填）');
    assert.equal(lines[10], '另有 2 条，见预览');
  });
  it('打码与服务端一致：前 3 位 + 后 4 位', () => {
    assert.equal(maskIdentityNumber(KID), '110***********0010');
    assert.equal(maskIdentityNumber('11010520150301001x'), '110***********001X');
  });
  it('同一批里重复的号码', () => {
    const duplicates = duplicateIdentities([
      { key: 1, identityNumber: KID }, { key: 2, identityNumber: KID2 }, { key: 3, identityNumber: KID.toLowerCase() }, { key: 4 },
    ]);
    assert.deepEqual([...duplicates], [[3, 1]]);
  });
});

describe('不收集却填了的提示', () => {
  it('有组别时提示去改组别报名字段', () => {
    const text = ignoredFieldsNotice([{ label: '身份证号', rows: [3, 2, 2] }, { label: '学号', rows: [] }], true);
    assert.match(text, /^本组报名设置不收集身份证号（第 2、3 行），这些内容导入时会忽略、不保存。如需保存，请先到赛事管理/);
  });
  it('没有组别时不提改组别；行多时只列前 8 行', () => {
    const text = ignoredFieldsNotice([{ label: '身份证号', rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }], false);
    assert.equal(text, '本赛事报名设置不收集身份证号（第 1、2、3、4、5、6、7、8 等 10 行），这些内容导入时会忽略、不保存。');
  });
  it('没有要提示的返回 undefined', () => {
    assert.equal(ignoredFieldsNotice([{ label: '身份证号', rows: [] }], true), undefined);
  });
});

describe('团体名单解析', () => {
  it('没有表头时按固定 6 列', () => {
    const parsed = parseTeamRosterText(`飞羽队\t张三\t男\t第一小学\t13800000000\t${KID}\n飞羽队\t李四\t女\t\t\t`);
    assert.equal(parsed.byHeader, false);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0].identityNumber, KID);
    assert.equal(parsed.rows[1].identityNumber, undefined);
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.groups.map((group) => [group.teamName, group.count, group.male, group.female]), [['飞羽队', 2, 1, 1]]);
  });
  it('有表头时按表头认列：列顺序随意、带序号列和括号说明', () => {
    const text = [
      '序号\t姓名\t身份证号（必填）\t队伍名称\t性别\t联系电话',
      `1\t张三\t${KID}\t飞羽队\t男\t13800000000`,
      `2\t李四\t${KID2.toLowerCase()}\t飞羽队\t女\t`,
    ].join('\n');
    const parsed = parseTeamRosterText(text);
    assert.equal(parsed.byHeader, true);
    assert.deepEqual(parsed.rows.map((row) => [row.lineNumber, row.teamName, row.name, row.gender, row.contact, row.identityNumber]), [
      [2, '飞羽队', '张三', 'MALE', '13800000000', KID],
      [3, '飞羽队', '李四', 'FEMALE', '', KID2],
    ]);
    assert.equal(parsed.valid, true);
  });
  it('没有表头时超过 6 列仍报格式错误', () => {
    const parsed = parseTeamRosterText('飞羽队\t张三\t男\t第一小学\t138\tX\t多余');
    assert.match(parsed.rows[0].error, /应为 2 至 6 列/);
    assert.equal(parsed.valid, false);
  });
});

describe('团体名单按组别检查', () => {
  const text = [
    `飞羽队\t张三\t男\t第一小学\t13800000000\t${KID}`,
    '飞羽队\t李四\t女\t第一小学\t13900000000',
    '飞羽队\t王五\t\t第一小学\t13700000000',
    `羽燕队\t赵六\t女\t第二小学\t\t${ADULT}`,
    `羽燕队\t钱七\t女\t第二小学\t\t${KID}`,
  ].join('\n');

  it('身份证号必填：缺号、年龄不符只标黄照常导入，重复的号码仍然拦下', () => {
    const rules = importFieldRules(fields({ identityNumber: 'required', gender: 'required' }), PRIMARY);
    const checked = checkTeamRows(parseTeamRosterText(text).rows, rules);
    assert.deepEqual(checked.rows.map((row) => [row.lineNumber, row.error, row.warning]), [
      [1, undefined, undefined],
      [2, undefined, '未填身份证号（本组必填）'],
      [3, undefined, '未填性别（本组必填）；未填身份证号（本组必填）'],
      [4, undefined, '不符合本组年龄条件（出生日期 1990-03-07）'],
      [5, '身份证号与第 1 行重复', undefined],
    ]);
    assert.equal(checked.errorCount, 1);
    assert.equal(checked.warningCount, 3);
    assert.equal(checked.warningLines[0], '第 2 行 李四：未填身份证号（本组必填）');
    assert.equal(checked.valid, false);
    assert.deepEqual(checked.groups.map((group) => [group.teamName, group.error, group.warnings]), [['飞羽队', undefined, 2], ['羽燕队', '请修正下方行数据', 1]]);
    assert.equal(checked.notice, undefined);
  });
  it('号码有误的不算重复（不保存）', () => {
    const rules = importFieldRules(fields({ identityNumber: 'required' }), null);
    const bad = '11010520150301001X';
    const checked = checkTeamRows(parseTeamRosterText(`飞羽队\t张三\t男\t\t\t${bad}\n飞羽队\t李四\t男\t\t\t${bad}`).rows, rules);
    assert.deepEqual(checked.rows.map((row) => [row.error, row.warning]), [
      [undefined, '身份证号校验位有误，不保存'], [undefined, '身份证号校验位有误，不保存'],
    ]);
    assert.equal(checked.valid, true);
  });
  it('身份证号不收集：填了也不报错，只提示会忽略', () => {
    const rules = importFieldRules(fields({ identityNumber: 'hidden' }), PRIMARY);
    const checked = checkTeamRows(parseTeamRosterText(text).rows, rules);
    assert.equal(checked.errorCount, 0);
    assert.equal(checked.valid, true);
    assert.match(checked.notice, /^本组报名设置不收集身份证号（第 1、4、5 行）/);
  });
  it('没有组别的老团体赛：性别必填（只提醒），身份证号忽略', () => {
    const checked = checkTeamRows(parseTeamRosterText(text).rows, importFieldRules(null, null));
    assert.equal(checked.errorCount, 0);
    assert.deepEqual(checked.rows.filter((row) => row.warning).map((row) => [row.lineNumber, row.warning]), [[3, '未填性别（必填）']]);
    assert.match(checked.notice, /^本赛事报名设置不收集身份证号（第 1、4、5 行），这些内容导入时会忽略、不保存。$/);
  });
  it('选填：没填的放行，填错的标黄', () => {
    const rules = importFieldRules(fields({ identityNumber: 'optional' }), null);
    const checked = checkTeamRows(parseTeamRosterText(`飞羽队\t张三\t男\t\t\t${TEEN}\n飞羽队\t李四\t女\t\t\t12345`).rows, rules);
    assert.deepEqual(checked.rows.map((row) => [row.error, row.warning]), [[undefined, undefined], [undefined, '身份证号不是18位有效号码，不保存']]);
  });
});
