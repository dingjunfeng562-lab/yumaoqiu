export type FieldState = 'hidden' | 'optional' | 'required';
// age：报名人自填年龄（填身份证号时自动计算）；shirtSize：衣服尺寸，报名人手填。
export type GroupFields = Record<'identityNumber' | 'gender' | 'studentId' | 'college' | 'majorGrade' | 'email' | 'age' | 'shirtSize', FieldState>;
/** 按年龄填写的原始输入：YEAR = 按出生年份，AGE = 以 refDate 为准计周岁。 */
export type AgeInput = { basis: 'YEAR' | 'AGE'; minAge?: number; maxAge?: number; refDate: string };
export type AgeRule = { mode: 'NONE' | 'BIRTH_DATE' | 'AGE'; minDate?: string; maxDate?: string; minAge?: number; maxAge?: number; minInclusive?: boolean; maxInclusive?: boolean; cutoffDate?: string; ageInput?: AgeInput };
export type RegistrationGroupInfo = {
  tournamentId: string; title: string; groupId: string; groupName: string;
  fieldTemplate: string; groupFields: GroupFields; ageRule: AgeRule; ageRuleLabel: string;
  maxRegistrationEvents?: number; registrationOpen?: boolean;
  events: Array<{ id: string; type: string; label: string; isDouble: boolean }>;
  payment?: { singlesFee: number; doublesFee: number } | null;
};
export const GROUP_EVENT_OPTIONS = [
  { value: 'MENS_SINGLES', label: '男子单打' }, { value: 'WOMENS_SINGLES', label: '女子单打' },
  { value: 'MENS_DOUBLES', label: '男子双打' }, { value: 'WOMENS_DOUBLES', label: '女子双打' }, { value: 'MIXED_DOUBLES', label: '混合双打' },
];
export const GROUP_FIELD_OPTIONS = [{ value: 'optional', label: '选填' }, { value: 'required', label: '必填' }, { value: 'hidden', label: '不收集' }];

/** 2018-01-01 → 2018年1月1日 */
export function cnDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

/** 日期选择器统一的中文显示格式。 */
export const CN_DATE_FORMAT = 'YYYY年M月D日';

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function shiftYears(date: string, years: number) {
  const year = Number(date.slice(0, 4)) + years;
  const monthDay = date.slice(5) === '02-29' && !isLeapYear(year) ? '02-28' : date.slice(5);
  return `${String(year).padStart(4, '0')}-${monthDay}`;
}

function nextDay(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

/** 年龄范围 → 出生日期范围（两端都含），与服务端 birthRangeFromAges 一致；保存时以服务端结果为准。 */
export function birthRangeFromAges(input: AgeInput): { minDate?: string; maxDate?: string } {
  const year = Number(input.refDate.slice(0, 4));
  if (input.basis === 'YEAR') {
    return {
      ...(input.maxAge != null ? { minDate: `${year - input.maxAge}-01-01` } : {}),
      ...(input.minAge != null ? { maxDate: `${year - input.minAge}-12-31` } : {}),
    };
  }
  return {
    ...(input.maxAge != null ? { minDate: nextDay(shiftYears(input.refDate, -(input.maxAge + 1))) } : {}),
    ...(input.minAge != null ? { maxDate: shiftYears(input.refDate, -input.minAge) } : {}),
  };
}

/** 出生日期范围的中文说明：「2016年1月1日至2018年12月31日出生」。 */
export function birthRangeText(range: { minDate?: string; maxDate?: string }) {
  if (range.minDate && range.maxDate) return `${cnDate(range.minDate)}至${cnDate(range.maxDate)}出生`;
  if (range.minDate) return `${cnDate(range.minDate)}及以后出生`;
  if (range.maxDate) return `${cnDate(range.maxDate)}及以前出生`;
  return '';
}

function shanghaiToday() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

function ageOn(birth: string, cutoff: string) {
  return Number(cutoff.slice(0, 4)) - Number(birth.slice(0, 4)) - (cutoff.slice(5) < birth.slice(5) ? 1 : 0);
}

/** 按本组规则的口径算年龄；与服务端 ageForRule 一致。 */
export function ageForRule(rule: AgeRule, birthDate: string) {
  if (rule.ageInput?.basis === 'YEAR') return Number(rule.ageInput.refDate.slice(0, 4)) - Number(birthDate.slice(0, 4));
  if (rule.ageInput) return ageOn(birthDate, rule.ageInput.refDate);
  if (rule.mode === 'AGE' && rule.cutoffDate) return ageOn(birthDate, rule.cutoffDate);
  return ageOn(birthDate, shanghaiToday());
}

/** 合法的 18 位身份证号 → 出生日期（YYYY-MM-DD），否则 null。 */
export function birthFromIdentity(value: string): string | null {
  const number = value.trim().toUpperCase();
  if (!/^[1-9]\d{16}[\dX]$/.test(number)) return null;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  if ('10X98765432'[weights.reduce((sum, weight, i) => sum + weight * Number(number[i]), 0) % 11] !== number[17]) return null;
  const birth = `${number.slice(6, 10)}-${number.slice(10, 12)}-${number.slice(12, 14)}`;
  const date = new Date(`${birth}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birth || birth > shanghaiToday() || birth < '1800-01-01') return null;
  return birth;
}

/** 即时提示；最终资格始终由服务端独立计算。 */
export function identityPreview(value: string, rule: AgeRule): { error?: string; text: string } {
  const number = value.trim().toUpperCase();
  if (!number) return { text: rule.mode === 'NONE' ? '' : '未填写身份证，年龄资格待组委会核验' };
  if (!/^[1-9]\d{16}[\dX]$/.test(number)) return { error: '请填写18位身份证号', text: '' };
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  if ('10X98765432'[weights.reduce((sum, weight, i) => sum + weight * Number(number[i]), 0) % 11] !== number[17]) return { error: '身份证校验位有误', text: '' };
  const birth = `${number.slice(6, 10)}-${number.slice(10, 12)}-${number.slice(12, 14)}`;
  const date = new Date(`${birth}T00:00:00Z`);
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birth || birth > today || birth < '1800-01-01') return { error: '身份证出生日期无效', text: '' };
  const ageText = `出生日期：${cnDate(birth)}，年龄：${ageForRule(rule, birth)}岁`;
  if (rule.mode === 'NONE') return { text: ageText };
  const cutoff = rule.cutoffDate ?? today;
  const actual = rule.mode === 'AGE' ? Number(cutoff.slice(0, 4)) - Number(birth.slice(0, 4)) - (cutoff.slice(5) < birth.slice(5) ? 1 : 0) : birth;
  const min = rule.mode === 'AGE' ? rule.minAge : rule.minDate;
  const max = rule.mode === 'AGE' ? rule.maxAge : rule.maxDate;
  if ((min != null && (rule.minInclusive === false ? actual <= min : actual < min)) || (max != null && (rule.maxInclusive === false ? actual >= max : actual > max))) return { error: '不符合本组年龄条件，请核对资料或联系组委会', text: ageText };
  return { text: `${ageText} · 符合年龄条件` };
}
