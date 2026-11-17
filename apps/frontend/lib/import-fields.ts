// 管理员批量导入（批量新增、第三方人员、Excel 导入、团体队员导入）按组别「报名字段」做的导入前检查。
// 后台批量导入不强制报名字段（选手自己报名照旧严格），与服务端 preparePerson(lenient) / batchGroupField 一致：
//   必填没填、身份证号有误、年龄不符本组条件 → 标黄提醒，照常导入；有误的身份证号不提交、不保存；
//     点「导入」时有标黄的行再确认一次；导入后资格记为「未核验」，不用逐条核验。
//   不收集却填了 → 不拦，提示这一列导入时忽略、不保存（服务端本来就会丢掉）。
//   明显的数据错误（格式不对、性别与项目不符、同一批里身份证号重复）仍然标红拦下。
// 只有类型导入，没有运行时依赖，方便 node --test 直接测。
import type { AgeRule, FieldState, GroupFields } from './registration-groups';

export type ImportFieldRules = {
  fields: GroupFields;
  ageRule: AgeRule | null;
  /** 赛事有组别；没有组别的老赛事不收身份证号，提示里也不能叫人去改组别设置。 */
  grouped: boolean;
};

/** 与服务端 groupFields(fieldRules, school, legacy) 的默认值一致：没有组别时不收身份证号、性别必填。 */
export function importFieldRules(
  groupFields: Partial<GroupFields> | null | undefined,
  ageRule: AgeRule | null | undefined,
  school = false,
): ImportFieldRules {
  const grouped = Boolean(groupFields);
  const defaults: GroupFields = {
    identityNumber: grouped ? 'optional' : 'hidden',
    gender: grouped ? 'optional' : 'required',
    studentId: school ? 'required' : 'hidden',
    college: school ? 'required' : 'hidden',
    majorGrade: school ? 'optional' : 'hidden',
    email: 'optional',
    age: 'hidden',
    shirtSize: 'hidden',
  };
  return { fields: { ...defaults, ...(groupFields ?? {}) }, ageRule: ageRule ?? null, grouped };
}

export function normalizeIdentityNumber(value?: string | null): string {
  return (value ?? '').replace(/\s/g, '').toUpperCase();
}

/** 预览里只显示打码号码（与服务端存的 masked 一致：前 3 位 + 后 4 位）。 */
export function maskIdentityNumber(value?: string | null): string {
  const number = normalizeIdentityNumber(value);
  if (number.length <= 7) return number;
  return `${number.slice(0, 3)}${'*'.repeat(number.length - 7)}${number.slice(-4)}`;
}

function shanghaiToday() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

function ageOn(birth: string, cutoff: string) {
  return Number(cutoff.slice(0, 4)) - Number(birth.slice(0, 4)) - (cutoff.slice(5) < birth.slice(5) ? 1 : 0);
}

/** 号码本身的问题（格式、校验位、出生日期），与服务端 parseIdentity 一致。 */
export function identityFormatError(value: string, today = shanghaiToday()): string | undefined {
  const number = normalizeIdentityNumber(value);
  if (!/^[1-9]\d{16}[\dX]$/.test(number)) return '身份证号不是18位有效号码';
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checksum = '10X98765432'[weights.reduce((sum, weight, i) => sum + weight * Number(number[i]), 0) % 11];
  if (checksum !== number[17]) return '身份证号校验位有误';
  const birth = identityBirthDate(number);
  const date = new Date(`${birth}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birth || birth > today || birth < '1800-01-01') {
    return '身份证号里的出生日期无效';
  }
  return undefined;
}

function identityBirthDate(number: string) {
  return `${number.slice(6, 10)}-${number.slice(10, 12)}-${number.slice(12, 14)}`;
}

/** 身份证号的问题（格式、校验位、出生日期、本组年龄条件），与服务端 parseIdentity + checkAge 一致。 */
export function identityNumberError(value: string, rule?: AgeRule | null, today = shanghaiToday()): string | undefined {
  const formatError = identityFormatError(value, today);
  if (formatError) return formatError;
  return identityAgeError(normalizeIdentityNumber(value), rule, today);
}

/** 号码有效时，出生日期是否符合本组年龄条件。 */
function identityAgeError(number: string, rule?: AgeRule | null, today = shanghaiToday()): string | undefined {
  const birth = identityBirthDate(number);
  if (!rule || rule.mode === 'NONE') return undefined;
  const actual = rule.mode === 'AGE' ? ageOn(birth, rule.cutoffDate ?? today) : birth;
  const min = rule.mode === 'AGE' ? rule.minAge : rule.minDate;
  const max = rule.mode === 'AGE' ? rule.maxAge : rule.maxDate;
  if ((min != null && (rule.minInclusive === false ? actual <= min : actual < min))
    || (max != null && (rule.maxInclusive === false ? actual >= max : actual > max))) {
    return `不符合本组年龄条件（出生日期 ${birth}）`;
  }
  return undefined;
}

export type IdentityImportCheck = {
  /** 要提交的号码：不收集、没填或号码有误时为空（不提交、不保存）。 */
  submit?: string;
  /** 标黄提醒：没填（本组必填）、号码有误、年龄不符。不拦导入。 */
  warning?: string;
};

/**
 * 后台批量导入时一个人的身份证号。不收集时忽略；必填没填、号码有误、年龄不符只提醒，照常导入。
 * who：'' 表示本人，'搭档' / '队友' 用于双打第二人。
 */
export function identityImportCheck(value: string | undefined, rules: ImportFieldRules, who = ''): IdentityImportCheck {
  const state = rules.fields.identityNumber;
  if (state === 'hidden') return {};
  const number = normalizeIdentityNumber(value);
  if (!number) return state === 'required' ? { warning: `${who}未填身份证号（${rules.grouped ? '本组' : ''}必填）` } : {};
  const formatError = identityFormatError(number);
  if (formatError) return { warning: `${who}${formatError}，不保存` };
  const ageError = identityAgeError(number, rules.ageRule);
  return { submit: number, ...(ageError ? { warning: `${who}${ageError}` } : {}) };
}

/** 提交给服务端的身份证号：不收集、号码有误时不提交，避免把用不到的证件号发出去。 */
export function identityForSubmit(value: string | undefined, rules: ImportFieldRules): string | undefined {
  return identityImportCheck(value, rules).submit;
}

/** 有标黄提醒时，预览上方的说明。 */
export function lenientWarningNotice(count: number): string | undefined {
  if (!count) return undefined;
  return `有 ${count} 条标黄提醒（身份证号等报名字段没填或有误、年龄不符本组条件）。后台批量导入不强制报名字段，这些照常导入：`
    + '有误的身份证号不保存，资格记为「未核验」，不用再逐条核验。点「导入」时会再确认一次。';
}

/** 点「导入」时确认框里的内容：标黄的行逐条列出（最多 limit 条）。 */
export function warningConfirmLines(items: Array<{ row: number | string; name?: string; warning: string }>, limit = 10): string[] {
  const lines = items.slice(0, limit).map((item) => `第 ${item.row} 行${item.name ? ` ${item.name}` : ''}：${item.warning}`);
  if (items.length > limit) lines.push(`另有 ${items.length - limit} 条，见预览`);
  return lines;
}

export function fieldStateText(state: FieldState): string {
  return state === 'required' ? '必填' : state === 'optional' ? '选填' : '不收集';
}

function rowsText(rows: number[]): string {
  const unique = [...new Set(rows)].sort((a, b) => a - b);
  // 调用方在后面接「行」：「第 1、2、3 行」「第 1、…、8 等 10 行」。
  return unique.length > 8 ? `${unique.slice(0, 8).join('、')} 等 ${unique.length}` : unique.join('、');
}

/**
 * 「不收集却填了」的提示：哪些列、哪些行会被忽略。没有要提示的返回 undefined。
 * ignored：字段名 → 行号。
 */
export function ignoredFieldsNotice(ignored: Array<{ label: string; rows: number[] }>, grouped: boolean): string | undefined {
  const parts = ignored.filter((item) => item.rows.length).map((item) => `${item.label}（第 ${rowsText(item.rows)} 行）`);
  if (!parts.length) return undefined;
  const scope = grouped ? '本组' : '本赛事';
  const hint = grouped ? '如需保存，请先到赛事管理里把该组别「报名字段」中的对应项改成选填或必填，再导入（组别已有报名后报名字段不能再改）。' : '';
  return `${scope}报名设置不收集${parts.join('、')}，这些内容导入时会忽略、不保存。${hint}`;
}

/**
 * 同一批里重复的身份证号：返回 key → 与哪个 key 重复（第一次出现的）。
 * 用在同一个项目 / 同一个团体赛里，一个人只能出现一次。
 */
export function duplicateIdentities<K>(items: Array<{ key: K; identityNumber?: string }>): Map<K, K> {
  const first = new Map<string, K>();
  const duplicates = new Map<K, K>();
  for (const item of items) {
    const number = normalizeIdentityNumber(item.identityNumber);
    if (!number) continue;
    const seen = first.get(number);
    if (seen === undefined) first.set(number, item.key);
    else if (seen !== item.key) duplicates.set(item.key, seen);
  }
  return duplicates;
}

// ---- 团体队员导入（团体名称、姓名、性别、单位、联系方式、身份证号）----

export type TeamRosterRow = {
  identityNumber?: string;
  lineNumber: number;
  teamName: string;
  name: string;
  gender?: 'MALE' | 'FEMALE';
  affiliation: string;
  contact: string;
  error?: string;
  /** 标黄提醒（报名字段没填或有误、年龄不符），不拦导入。 */
  warning?: string;
};

type TeamColumn = 'teamName' | 'name' | 'gender' | 'affiliation' | 'contact' | 'identityNumber';

const TEAM_HEADERS: Array<{ column: TeamColumn; test: RegExp }> = [
  { column: 'identityNumber', test: /身份证|证件号/ },
  { column: 'teamName', test: /^(团体名称|队伍名称|团体|队伍|队名|代表队)$/ },
  { column: 'name', test: /^(姓名|队员姓名|队员|名字)$/ },
  { column: 'gender', test: /^性别$/ },
  { column: 'affiliation', test: /^(单位|学校|所属单位|所在单位)$/ },
  { column: 'contact', test: /联系方式|联系电话|电话|手机/ },
];

const TEAM_POSITIONS: TeamColumn[] = ['teamName', 'name', 'gender', 'affiliation', 'contact', 'identityNumber'];

/** 表头文字去掉空格和括号说明（如「身份证号（必填）」），再按别名认列。 */
function teamHeaderColumns(cells: string[]): Partial<Record<TeamColumn, number>> | null {
  const found: Partial<Record<TeamColumn, number>> = {};
  cells.forEach((cell, index) => {
    const text = cell.replace(/[（(][^）)]*[）)]/g, '').replace(/[\s*＊:：]/g, '');
    if (!text) return;
    const match = TEAM_HEADERS.find((item) => found[item.column] === undefined && item.test.test(text));
    if (match) found[match.column] = index;
  });
  return found.teamName !== undefined && found.name !== undefined ? found : null;
}

function teamGender(value: string): 'MALE' | 'FEMALE' | undefined {
  const normalized = value.toUpperCase();
  if (['男', 'MALE', 'M'].includes(normalized)) return 'MALE';
  if (['女', 'FEMALE', 'F'].includes(normalized)) return 'FEMALE';
  return undefined;
}

/**
 * 解析粘贴的团体名单。第一行是表头（含「团体名称/队伍名称」和「姓名」）时按表头认列，列顺序随意、
 * 多出来的列忽略；没有表头时按固定顺序：团体名称、姓名、性别、单位、联系方式、身份证号。
 */
export function parseTeamRosterText(text: string) {
  const rows: TeamRosterRow[] = [];
  let header: Partial<Record<TeamColumn, number>> | null = null;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    // Keep empty cells and spaces inside names/units when pasted from a spreadsheet.
    const cells = (line.includes('\t') ? line.split('\t') : line.split(/[,，、]/)).map((cell) => cell.trim());
    if (!rows.length && !header) {
      header = teamHeaderColumns(cells);
      if (header) continue;
    }
    const at = (column: TeamColumn) => {
      const position = header ? header[column] : TEAM_POSITIONS.indexOf(column);
      return position === undefined ? '' : cells[position] ?? '';
    };
    const teamName = at('teamName');
    const name = at('name');
    const genderText = at('gender');
    const identityNumber = normalizeIdentityNumber(at('identityNumber'));
    const gender = teamGender(genderText);
    const error = !header && (cells.length < 2 || cells.length > 6) ? '应为 2 至 6 列：团体名称、姓名、性别、单位、联系方式、身份证号'
      : !teamName || !name ? '团体名称和姓名必填' : genderText && !gender ? '性别请填写男或女，也可留空' : undefined;
    rows.push({ lineNumber: index + 1, teamName, name, gender, affiliation: at('affiliation'), contact: at('contact'), identityNumber: identityNumber || undefined, error });
  }
  return { rows, ...summarizeTeamRows(rows), byHeader: Boolean(header) };
}

export function summarizeTeamRows(rows: TeamRosterRow[]) {
  const grouped = new Map<string, TeamRosterRow[]>();
  rows.forEach((row) => grouped.set(row.teamName, [...(grouped.get(row.teamName) ?? []), row]));
  const groups = [...grouped].map(([teamName, members]) => {
    const male = members.filter((row) => row.gender === 'MALE').length;
    const female = members.filter((row) => row.gender === 'FEMALE').length;
    const error = members.some((row) => row.error) ? '请修正下方行数据' : undefined;
    const warnings = members.filter((row) => !row.error && row.warning).length;
    return { teamName, count: members.length, male, female, lines: members.map((row) => row.lineNumber).join('、'), error, warnings };
  });
  return { groups, valid: rows.length > 0 && groups.every((group) => !group.error) };
}

/**
 * 按团体赛所属组别的报名字段检查每一行。后台批量导入不强制报名字段：必填的性别 / 身份证号没填、
 * 身份证号有误、年龄不符只标黄提醒（warning），照常导入；同一批里身份证号重复仍然拦下（服务端也会拒绝）。
 * 不收集的身份证号不报错，只放进 ignoredRows 用于提示。
 */
export function checkTeamRows(rows: TeamRosterRow[], rules: ImportFieldRules) {
  const identities = new Map(rows.map((row) => [row.lineNumber, identityImportCheck(row.identityNumber, rules)]));
  // 只有有效、会提交的号码才查重；有误的号码不保存，不算重复。
  const duplicates = duplicateIdentities(rows.map((row) => ({ key: row.lineNumber, identityNumber: identities.get(row.lineNumber)?.submit })));
  const ignoredRows: number[] = [];
  const checked = rows.map((row) => {
    if (row.identityNumber && rules.fields.identityNumber === 'hidden') ignoredRows.push(row.lineNumber);
    if (row.error) return row;
    const duplicateOf = duplicates.get(row.lineNumber);
    if (duplicateOf !== undefined) return { ...row, error: `身份证号与第 ${duplicateOf} 行重复` };
    const warnings = [
      ...(rules.fields.gender === 'required' && !row.gender ? [`未填性别（${rules.grouped ? '本组' : ''}必填）`] : []),
      ...(identities.get(row.lineNumber)?.warning ? [identities.get(row.lineNumber)!.warning!] : []),
    ];
    return warnings.length ? { ...row, warning: warnings.join('；') } : row;
  });
  const warningRows = checked.filter((row) => !row.error && row.warning);
  return {
    rows: checked,
    ...summarizeTeamRows(checked),
    errorCount: checked.filter((row) => row.error).length,
    warningCount: warningRows.length,
    warningLines: warningConfirmLines(warningRows.map((row) => ({ row: row.lineNumber, name: row.name, warning: row.warning! }))),
    notice: ignoredFieldsNotice([{ label: '身份证号', rows: ignoredRows }], rules.grouped),
  };
}
