// 团体队员导入解析器的单测，用 Node 自带的测试工具跑，不依赖额外的测试框架：
//   cd apps/frontend && pnpm test        （需要 Node 23.6+，可以直接 import .ts）
// 这里是 .mjs，不在 tsconfig 的 include 里，不参与 next build 的类型检查。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTeamRosterFieldRules,
  gridToTeamRosterText,
  parseTeamRoster,
  rowsToTeamRosterText,
} from './team-roster-import.ts';
import { decodeCsvBytes } from './xlsx-grid.ts';

/** 只取断言关心的字段，方便和期望值整体比较。 */
function brief(row) {
  return {
    team: row.teamName,
    name: row.name,
    gender: row.gender ?? '',
    affiliation: row.affiliation,
    contact: row.contact,
    id: row.identityNumber ?? '',
  };
}

describe('原来的导入模板（6 列：团体名称、姓名、性别、单位、联系方式、身份证号）', () => {
  it('带表头', () => {
    const result = parseTeamRoster('团体名称\t姓名\t性别\t单位\t联系方式\n飞羽队\t张三\t男\t第一学校\t13800000000\n飞羽队\t李四\t女\t第一学校\t13900000000');
    assert.equal(result.valid, true);
    assert.equal(result.groups.length, 1);
    assert.deepEqual(result.rows.map(brief), [
      { team: '飞羽队', name: '张三', gender: 'MALE', affiliation: '第一学校', contact: '13800000000', id: '' },
      { team: '飞羽队', name: '李四', gender: 'FEMALE', affiliation: '第一学校', contact: '13900000000', id: '' },
    ]);
  });

  it('不带表头，6 列含身份证号；逗号分隔；性别留空', () => {
    const result = parseTeamRoster('飞羽队\t张三\t男\t第一学校\t13800000000\t110101199001011234\n飞羽队,李四,女,第一学校,13900000000\n飞羽队\t王五\t\t第一学校\t13700000000');
    assert.equal(result.valid, true);
    assert.deepEqual(result.rows.map(brief), [
      { team: '飞羽队', name: '张三', gender: 'MALE', affiliation: '第一学校', contact: '13800000000', id: '110101199001011234' },
      { team: '飞羽队', name: '李四', gender: 'FEMALE', affiliation: '第一学校', contact: '13900000000', id: '' },
      { team: '飞羽队', name: '王五', gender: '', affiliation: '第一学校', contact: '13700000000', id: '' },
    ]);
  });

  it('「队伍名称」表头、表头列顺序打乱、带序号列', () => {
    const result = parseTeamRoster('序号\t姓名\t队伍名称\t电话\t性别\n1\t张三\t零一队\t13000000\t男\n2\t李四\t零一队\t13000001\t女');
    assert.equal(result.valid, true);
    assert.deepEqual(result.rows.map(row => [row.teamName, row.name, row.gender, row.contact]), [
      ['零一队', '张三', 'MALE', '13000000'],
      ['零一队', '李四', 'FEMALE', '13000001'],
    ]);
  });
});

describe('现场问题：紧凑写法', () => {
  it('截图里的 4 行识别成 1 个团体、4 人（3 男 1 女）', () => {
    const result = parseTeamRoster([
      '零一队：张三（男），第二学校，13000000',
      '零一队：李四（女），第二学校，13000001',
      '零一队：赵二（男），第二学校，13000002',
      '零一队：王麻（男），第二学校，13000003',
    ].join('\n'));
    assert.equal(result.valid, true);
    assert.equal(result.groups.length, 1);
    assert.deepEqual(result.groups[0], { teamName: '零一队', count: 4, male: 3, female: 1, lines: '1、2、3、4', error: undefined });
    assert.deepEqual(brief(result.rows[0]), { team: '零一队', name: '张三', gender: 'MALE', affiliation: '第二学校', contact: '13000000', id: '' });
  });

  it('紧凑写法不带性别、性别单独一列都能识别', () => {
    const result = parseTeamRoster('零一队：张三，第二学校，13000000\n零一队：李四，女，第二学校');
    assert.equal(result.valid, true);
    assert.deepEqual(result.rows.map(brief), [
      { team: '零一队', name: '张三', gender: '', affiliation: '第二学校', contact: '13000000', id: '' },
      { team: '零一队', name: '李四', gender: 'FEMALE', affiliation: '第二学校', contact: '', id: '' },
    ]);
  });
});

describe('标题行不会被当成表头', () => {
  it('「××团体赛队员报名表」标题在表头上方', () => {
    const result = parseTeamRoster('2026年校园杯羽毛球团体赛队员报名表\n队名\t姓名\t性别\t单位\n零一队\t张三\t男\t第二学校\n零一队\t李四\t女\t第二学校');
    assert.equal(result.valid, true);
    assert.deepEqual(result.groups.map(group => [group.teamName, group.count]), [['零一队', 2]]);
    assert.deepEqual(result.rows.map(row => [row.teamName, row.name, row.gender, row.affiliation]), [
      ['零一队', '张三', 'MALE', '第二学校'],
      ['零一队', '李四', 'FEMALE', '第二学校'],
    ]);
  });

  it('「团体赛选手名单」标题', () => {
    const result = parseTeamRoster('团体赛选手名单\n团体名称\t姓名\t性别\n飞羽队\t张三\t男');
    assert.deepEqual(result.rows.map(row => [row.teamName, row.name, row.gender]), [['飞羽队', '张三', 'MALE']]);
  });

  it('Excel：标题合并整行 + 队名只写一次', () => {
    const grid = [
      ['2026年校园杯团体赛队员报名表', null, null, null],
      ['队名', '姓名', '性别', '单位'],
      ['零一队', '张三', '男', '第二学校'],
      [null, '李四', '女', '第二学校'],
      ['零二队', '王五', '男', '第三学校'],
    ];
    const text = gridToTeamRosterText(grid, [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }]);
    const result = parseTeamRoster(text);
    assert.equal(result.valid, true);
    assert.deepEqual(result.groups.map(group => [group.teamName, group.count]), [['零一队', 2], ['零二队', 1]]);
    assert.deepEqual(result.rows.map(row => row.name), ['张三', '李四', '王五']);
  });

  it('「姓名（性别）」这类表头不会让性别列和姓名列指向同一格', () => {
    const result = parseTeamRoster('代表队\t队员姓名（性别）\t学校\n零一队\t张三（男）\t第二学校');
    assert.equal(result.valid, true);
    assert.deepEqual(brief(result.rows[0]), { team: '零一队', name: '张三', gender: 'MALE', affiliation: '第二学校', contact: '', id: '' });
  });
});

describe('省略性别列，以及性别写错时不再悄悄错位', () => {
  it('省略性别列：单位、电话按顺序后移', () => {
    const result = parseTeamRoster('零一队,张三,第二学校,13000000\n零一队,李四,第二学校');
    assert.equal(result.valid, true);
    assert.deepEqual(result.rows.map(brief), [
      { team: '零一队', name: '张三', gender: '', affiliation: '第二学校', contact: '13000000', id: '' },
      { team: '零一队', name: '李四', gender: '', affiliation: '第二学校', contact: '', id: '' },
    ]);
  });

  it('性别和单位都省略：电话、身份证号不会被挪到单位里', () => {
    const result = parseTeamRoster('零一队,张三,13800000000,110101199001011234\n零一队,李四,13900000000');
    assert.equal(result.valid, true);
    assert.deepEqual(result.rows.map(brief), [
      { team: '零一队', name: '张三', gender: '', affiliation: '', contact: '13800000000', id: '110101199001011234' },
      { team: '零一队', name: '李四', gender: '', affiliation: '', contact: '13900000000', id: '' },
    ]);
  });

  it('联系方式是邮箱也认', () => {
    const result = parseTeamRoster('零一队,张三,第二学校,zhangsan@example.com');
    assert.equal(result.valid, true);
    assert.equal(result.rows[0].contact, 'zhangsan@example.com');
  });

  it('5 列里性别写错字（难）：报错，不把单位当电话、电话当身份证号', () => {
    const result = parseTeamRoster('零一队,张三,难,第二学校,13000000');
    assert.equal(result.valid, false);
    assert.match(result.rows[0].error, /第 3 列「难」不是性别/);
  });

  it('3 列里性别写错一个字：报错', () => {
    const result = parseTeamRoster('零一队,张三,南');
    assert.equal(result.valid, false);
    assert.match(result.rows[0].error, /第 3 列「南」不是性别/);
  });

  it('6 列且第 3 列不是性别：提示列顺序', () => {
    const result = parseTeamRoster('零一队,张三,第二学校,13000000,x,y');
    assert.equal(result.valid, false);
    assert.match(result.rows[0].error, /第 3 列应为性别/);
  });

  it('「男性」「女性」也认', () => {
    const result = parseTeamRoster('零一队\t张三\t男性\n零一队\t李四（女性）');
    assert.deepEqual(result.rows.map(row => row.gender), ['MALE', 'FEMALE']);
  });

  it('表头模式下性别乱写：报错并指出内容', () => {
    const result = parseTeamRoster('团体名称\t姓名\t性别\n零一队\t张三\t难');
    assert.equal(result.valid, false);
    assert.match(result.rows[0].error, /性别「难」无法识别/);
  });
});

describe('队名本身带冒号', () => {
  it('AI 识别结果：队名带冒号、其余字段为空，不会把姓名挪进单位', () => {
    const text = rowsToTeamRosterText([
      { lineNumber: 1, teamName: '第二学校：一队', name: '张三', affiliation: '', contact: '' },
      { lineNumber: 2, teamName: '第二学校：二队', name: '李四', gender: 'FEMALE', affiliation: '', contact: '' },
    ]);
    const result = parseTeamRoster(text);
    assert.equal(result.valid, true);
    assert.deepEqual(result.rows.map(row => [row.teamName, row.name, row.gender ?? '', row.affiliation]), [
      ['第二学校：一队', '张三', '', ''],
      ['第二学校：二队', '李四', 'FEMALE', ''],
    ]);
  });

  it('逗号分隔，第 3 列是性别：按标准列理解', () => {
    const result = parseTeamRoster('第二学校：一队,张三,男,第二学校');
    assert.deepEqual(brief(result.rows[0]), { team: '第二学校：一队', name: '张三', gender: 'MALE', affiliation: '第二学校', contact: '', id: '' });
  });

  it('逗号分隔、没有性别：同一队名出现在多行时按队名理解', () => {
    const result = parseTeamRoster('第二学校：一队,张三\n第二学校：一队,李四');
    assert.deepEqual(result.groups.map(group => [group.teamName, group.count]), [['第二学校：一队', 2]]);
    assert.deepEqual(result.rows.map(row => row.name), ['张三', '李四']);
  });
});

describe('按组别报名字段校验', () => {
  const rules = (gender, identityNumber) => ({ groupName: '男子甲组', gender, identityNumber, notCollected: [] });
  const text = '团体名称\t姓名\t性别\t单位\t联系方式\t身份证号\n飞羽队\t张三\t男\t\t\t110101199001011234\n飞羽队\t李四\t\t\t\t\n飞羽队\t王五\t女';

  it('性别、身份证号必填时，没填的行报错，整批不能导入', () => {
    const result = applyTeamRosterFieldRules(parseTeamRoster(text), rules('required', 'required'));
    assert.equal(result.valid, false);
    assert.deepEqual(result.rows.map(row => row.error ?? ''), ['', '本组要求填写性别和身份证号', '本组要求填写身份证号']);
    assert.equal(result.groups[0].error, '请修正下方行数据');
  });

  it('选填或不收集时不额外报错', () => {
    assert.equal(applyTeamRosterFieldRules(parseTeamRoster(text), rules('optional', 'optional')).valid, true);
    assert.equal(applyTeamRosterFieldRules(parseTeamRoster(text), rules('hidden', 'hidden')).valid, true);
  });

  it('还没拿到组别规则时按原解析结果', () => {
    const parsed = parseTeamRoster(text);
    assert.equal(applyTeamRosterFieldRules(parsed, null), parsed);
  });

  it('本组模板（说明行 + 带「（必填）」「（选填）」的表头）能直接识别', () => {
    const note = '「男子甲组」团体赛队员导入：每行一名队员，同一支队伍的团体名称写成一样。必填：团体名称、姓名、性别；其余可以留空。';
    const grid = [
      [note, note, note, note, note, note],
      ['团体名称（必填）', '姓名（必填）', '性别（必填）', '单位（选填）', '联系方式（选填）', '身份证号（选填）'],
      ['零一队', '张三', '男', '第二学校', '013800000000', '110101199001011234'],
      [null, '李四', '女', null, null, null],
    ];
    const result = parseTeamRoster(gridToTeamRosterText(grid));
    assert.equal(result.valid, true);
    assert.deepEqual(result.rows.map(brief), [
      { team: '零一队', name: '张三', gender: 'MALE', affiliation: '第二学校', contact: '013800000000', id: '110101199001011234' },
      { team: '零一队', name: '李四', gender: 'FEMALE', affiliation: '', contact: '', id: '' },
    ]);
  });
});

describe('CSV 编码', () => {
  it('UTF-8（带 BOM）', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('队名,姓名\n零一队,张三')]);
    assert.equal(decodeCsvBytes(bytes), '队名,姓名\n零一队,张三');
  });

  it('中文 Excel 另存的 GBK CSV 不会乱码', () => {
    // 「队名,姓名,性别\r\n零一队,张三,男\r\n」的 GBK 编码
    const bytes = new Uint8Array([
      0xb6, 0xd3, 0xc3, 0xfb, 0x2c, 0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0xd0, 0xd4, 0xb1, 0xf0, 0x0d, 0x0a,
      0xc1, 0xe3, 0xd2, 0xbb, 0xb6, 0xd3, 0x2c, 0xd5, 0xc5, 0xc8, 0xfd, 0x2c, 0xc4, 0xd0, 0x0d, 0x0a,
    ]);
    const text = decodeCsvBytes(bytes);
    assert.equal(text, '队名,姓名,性别\r\n零一队,张三,男\r\n');
    assert.deepEqual(parseTeamRoster(text).rows.map(row => [row.teamName, row.name, row.gender]), [['零一队', '张三', 'MALE']]);
  });
});
