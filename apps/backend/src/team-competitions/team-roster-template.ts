import * as ExcelJS from 'exceljs';
import type { FieldState, GroupFields } from '../common/age-eligibility';

/**
 * 团体赛队员导入：按组别「报名字段」生成的规则与 Excel 模板。
 *
 * 团体队员只保存姓名、性别、单位、联系方式和身份证号（哈希）。性别、身份证号跟随组别配置
 * （必填 / 选填 / 不收集）；学号、学院等其他报名字段团体赛导入不收集，只在说明里提示。
 */
export type TeamRosterFieldRules = {
  groupName: string | null;
  gender: FieldState;
  identityNumber: FieldState;
  /** 本组个人报名会收集、但团体赛导入不收集的字段。 */
  notCollected: string[];
};

const NOT_COLLECTED_FIELDS: Array<[keyof GroupFields, string]> = [
  ['studentId', '学号'],
  ['college', '学院'],
  ['majorGrade', '年级专业'],
  ['email', '邮箱'],
  ['age', '年龄'],
  ['shirtSize', '衣服尺寸'],
];

/** 模板预留多少行带下拉和文本格式。 */
const TEMPLATE_ROWS = 500;

export function teamRosterFieldRules(fields: GroupFields, groupName: string | null): TeamRosterFieldRules {
  return {
    groupName,
    gender: fields.gender,
    identityNumber: fields.identityNumber,
    notCollected: NOT_COLLECTED_FIELDS.filter(([key]) => fields[key] !== 'hidden').map(([, label]) => label),
  };
}

type TemplateColumn = { key: string; header: string; width: number; text?: boolean };

const mark = (state: FieldState) => (state === 'required' ? '（必填）' : '（选填）');

/** 表头沿用原来的 6 列顺序；组别设为「不收集」的列不出现。 */
export function teamRosterTemplateColumns(rules: TeamRosterFieldRules): TemplateColumn[] {
  const columns: TemplateColumn[] = [
    { key: 'teamName', header: '团体名称（必填）', width: 20 },
    { key: 'name', header: '姓名（必填）', width: 14 },
  ];
  if (rules.gender !== 'hidden') columns.push({ key: 'gender', header: `性别${mark(rules.gender)}`, width: 12 });
  columns.push({ key: 'affiliation', header: '单位（选填）', width: 22 });
  // 联系方式、身份证号设为文本格式：避免 Excel 把 18 位身份证号存成数字丢掉末几位、去掉电话开头的 0。
  columns.push({ key: 'contact', header: '联系方式（选填）', width: 18, text: true });
  if (rules.identityNumber !== 'hidden') {
    columns.push({ key: 'identityNumber', header: `身份证号${mark(rules.identityNumber)}`, width: 22, text: true });
  }
  return columns;
}

export function teamRosterTemplateNote(rules: TeamRosterFieldRules) {
  const required = [
    '团体名称', '姓名',
    ...(rules.gender === 'required' ? ['性别'] : []),
    ...(rules.identityNumber === 'required' ? ['身份证号'] : []),
  ];
  return [
    `${rules.groupName ? `「${rules.groupName}」` : ''}团体赛队员导入：每行一名队员，同一支队伍的团体名称写成一样（也可以只在第一行写，下面留空）。`,
    `必填：${required.join('、')}；其余可以留空。`,
    rules.gender !== 'hidden' ? '性别从下拉中选择男或女。' : '',
    rules.notCollected.length ? `本组个人报名的${rules.notCollected.join('、')}在团体赛导入中不收集。` : '',
    '本行说明可以保留，导入时自动跳过。',
  ].join('');
}

export async function buildTeamRosterTemplate(rules: TeamRosterFieldRules): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('团体队员', { views: [{ state: 'frozen', ySplit: 2 }] });
  const columns = teamRosterTemplateColumns(rules);

  columns.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = column.width;
    if (column.text) sheetColumn.numFmt = '@';
  });

  sheet.mergeCells(1, 1, 1, columns.length);
  const note = sheet.getCell(1, 1);
  note.value = teamRosterTemplateNote(rules);
  note.alignment = { wrapText: true, vertical: 'middle' };
  note.font = { color: { argb: 'FF595959' } };
  sheet.getRow(1).height = 60;

  const header = sheet.getRow(2);
  columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
  });
  header.height = 22;

  const genderIndex = columns.findIndex(column => column.key === 'gender');
  if (genderIndex >= 0) {
    const letter = String.fromCharCode(65 + genderIndex);
    // exceljs 4.4 的类型定义没有公开 worksheet.dataValidations，但运行时支持按区域添加。
    // 不用逐格设置：逐格写出时会被合并成互相重叠的区域，Excel 打开可能提示“内容有问题，是否修复”。
    const validations = (sheet as unknown as {
      dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void };
    }).dataValidations;
    validations.add(`${letter}3:${letter}${2 + TEMPLATE_ROWS}`, {
      type: 'list',
      allowBlank: rules.gender !== 'required',
      formulae: ['"男,女"'],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: '性别',
      error: '请从下拉中选择「男」或「女」',
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
