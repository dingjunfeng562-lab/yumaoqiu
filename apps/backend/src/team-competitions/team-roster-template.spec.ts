import * as ExcelJS from 'exceljs';
import { groupFields } from '../common/age-eligibility';
import {
  buildTeamRosterTemplate,
  teamRosterFieldRules,
  teamRosterTemplateColumns,
  type TeamRosterFieldRules,
} from './team-roster-template';

describe('团体赛队员导入模板跟随组别报名字段', () => {
  const rules = (overrides: Partial<TeamRosterFieldRules> = {}): TeamRosterFieldRules => ({
    groupName: '男子甲组',
    gender: 'required',
    identityNumber: 'optional',
    notCollected: [],
    ...overrides,
  });

  it('性别、身份证号按必填 / 选填标注，不收集的列不出现', () => {
    expect(teamRosterTemplateColumns(rules()).map(column => column.header)).toEqual([
      '团体名称（必填）', '姓名（必填）', '性别（必填）', '单位（选填）', '联系方式（选填）', '身份证号（选填）',
    ]);
    expect(teamRosterTemplateColumns(rules({ gender: 'hidden', identityNumber: 'hidden' })).map(column => column.header)).toEqual([
      '团体名称（必填）', '姓名（必填）', '单位（选填）', '联系方式（选填）',
    ]);
    expect(teamRosterTemplateColumns(rules({ gender: 'optional', identityNumber: 'required' })).map(column => column.header))
      .toEqual(['团体名称（必填）', '姓名（必填）', '性别（选填）', '单位（选填）', '联系方式（选填）', '身份证号（必填）']);
  });

  it('学号、学院等团体赛不收集的报名字段只列在说明里', () => {
    const fields = groupFields({ studentId: 'required', college: 'optional', email: 'hidden' }, true);
    const result = teamRosterFieldRules(fields, '学生组');
    expect(result.notCollected).toEqual(expect.arrayContaining(['学号', '学院']));
    expect(result.notCollected).not.toContain('邮箱');
    expect(teamRosterTemplateColumns(result).map(column => column.key)).not.toContain('studentId');
  });

  it('生成的 Excel：说明行 + 表头、性别下拉、联系方式和身份证号为文本格式', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildTeamRosterTemplate(rules({ notCollected: ['学号'] })) as any);
    const sheet = workbook.getWorksheet('团体队员')!;

    expect(String(sheet.getCell('A1').value)).toContain('「男子甲组」团体赛队员导入');
    expect(String(sheet.getCell('A1').value)).toContain('必填：团体名称、姓名、性别');
    expect(String(sheet.getCell('A1').value)).toContain('学号在团体赛导入中不收集');
    expect((sheet.getRow(2).values as unknown[]).slice(1)).toEqual([
      '团体名称（必填）', '姓名（必填）', '性别（必填）', '单位（选填）', '联系方式（选填）', '身份证号（选填）',
    ]);
    expect(sheet.getCell('C3').dataValidation).toMatchObject({ type: 'list', formulae: ['"男,女"'] });
    expect(sheet.getCell('C502').dataValidation?.type).toBe('list');
    expect(sheet.getColumn(5).numFmt).toBe('@');
    expect(sheet.getColumn(6).numFmt).toBe('@');
  });
});
