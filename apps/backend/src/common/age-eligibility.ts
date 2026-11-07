import { BadRequestException } from '@nestjs/common';

export type FieldState = 'hidden' | 'optional' | 'required';
// age：报名人自填年龄（填了身份证号时按身份证自动算）；shirtSize：衣服尺寸，报名人手填。
export type GroupFields = Record<'identityNumber' | 'gender' | 'studentId' | 'college' | 'majorGrade' | 'email' | 'age' | 'shirtSize', FieldState>;
/**
 * 「按年龄」填写时记下原始年龄：YEAR = 按出生年份（年龄 = 参照年份 − 出生年份），
 * AGE = 按周岁（以 refDate 为准）。保存时由服务端换算成出生日期范围，报名按出生日期校验。
 */
export type AgeInput = { basis: 'YEAR' | 'AGE'; minAge?: number; maxAge?: number; refDate: string };
export type AgeRule = {
  mode: 'NONE' | 'BIRTH_DATE' | 'AGE';
  minDate?: string; maxDate?: string;
  minAge?: number; maxAge?: number;
  minInclusive?: boolean; maxInclusive?: boolean;
  cutoffDate?: string;
  ageInput?: AgeInput;
};
export type Eligibility = 'NOT_REQUIRED' | 'PASSED' | 'PENDING' | 'MANUAL';

export function groupFields(value: unknown, school = false, legacy = false): GroupFields {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const defaults: GroupFields = {
    identityNumber: legacy ? 'hidden' : 'optional', gender: legacy ? 'required' : 'optional',
    studentId: school ? 'required' : 'hidden', college: school ? 'required' : 'hidden',
    majorGrade: school ? 'optional' : 'hidden', email: 'optional',
    // 新增字段默认不收集，老组别不会突然多出必填项；新建第三方组别时由后台表单给默认值。
    age: 'hidden', shirtSize: 'hidden',
  };
  for (const key of Object.keys(defaults) as Array<keyof GroupFields>) {
    if (source[key] !== undefined) {
      if (!['hidden', 'optional', 'required'].includes(String(source[key]))) throw new BadRequestException('报名字段配置无效');
      defaults[key] = source[key] as FieldState;
    }
  }
  return defaults;
}

export function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 日期挪若干年；目标年份没有 2 月 29 日时取 2 月 28 日。 */
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

/** 2018-01-01 → 2018年1月1日 */
export function cnDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

/**
 * 年龄范围 → 出生日期范围（两端都含）。
 * 按出生年份：8～10 岁、2026 年 → 2016-01-01 ～ 2018-12-31。
 * 按周岁：以 2026-11-26 为准 8～10 周岁 → 2015-11-27 ～ 2018-11-26（满 11 周岁的前一天之后出生）。
 */
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

function normalizeAgeInput(value: unknown): AgeInput {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<AgeInput>;
  if (input.basis !== 'YEAR' && input.basis !== 'AGE') throw new BadRequestException('年龄计算方式无效');
  if (!input.refDate || !calendarDate(input.refDate)) throw new BadRequestException('请设置年龄参照日期');
  if (input.minAge == null && input.maxAge == null) throw new BadRequestException('请至少填写最小年龄或最大年龄');
  for (const age of [input.minAge, input.maxAge]) if (age != null && (!Number.isInteger(age) || age < 0 || age > 150)) throw new BadRequestException('年龄须为0至150的整数');
  if (input.minAge != null && input.maxAge != null && input.minAge > input.maxAge) throw new BadRequestException('最小年龄不能大于最大年龄');
  return { basis: input.basis, ...(input.minAge != null ? { minAge: input.minAge } : {}), ...(input.maxAge != null ? { maxAge: input.maxAge } : {}), refDate: input.refDate };
}

export function normalizeAgeRule(value: unknown): AgeRule {
  if (!value) return { mode: 'NONE' };
  const r = value as AgeRule;
  if (r.mode === 'NONE') return { mode: 'NONE' };
  // 按年龄填写：出生日期范围始终由服务端按年龄重新换算，避免前端算错或被改。
  if (r.mode === 'BIRTH_DATE' && r.ageInput) {
    const ageInput = normalizeAgeInput(r.ageInput);
    return { mode: 'BIRTH_DATE', minInclusive: true, maxInclusive: true, ...birthRangeFromAges(ageInput), ageInput };
  }
  if (!['BIRTH_DATE', 'AGE'].includes(r.mode)) throw new BadRequestException('年龄规则模式无效');
  for (const key of ['minInclusive', 'maxInclusive'] as const) {
    if (r[key] !== undefined && typeof r[key] !== 'boolean') throw new BadRequestException('年龄边界配置无效');
  }
  const bounds = { minInclusive: r.minInclusive !== false, maxInclusive: r.maxInclusive !== false };
  if (r.mode === 'BIRTH_DATE') {
    if (!r.minDate && !r.maxDate) throw new BadRequestException('请设置至少一个出生日期边界');
    for (const date of [r.minDate, r.maxDate]) if (date && !calendarDate(date)) throw new BadRequestException('出生日期范围无效');
    if (r.minDate && r.maxDate && (r.minDate > r.maxDate || (r.minDate === r.maxDate && (!bounds.minInclusive || !bounds.maxInclusive)))) throw new BadRequestException('出生日期范围为空');
    return { mode: r.mode, ...bounds, ...(r.minDate ? { minDate: r.minDate } : {}), ...(r.maxDate ? { maxDate: r.maxDate } : {}) };
  }
  if (!r.cutoffDate || !calendarDate(r.cutoffDate)) throw new BadRequestException('请设置有效的年龄截止日期');
  if (r.minAge == null && r.maxAge == null) throw new BadRequestException('请设置至少一个年龄边界');
  for (const age of [r.minAge, r.maxAge]) if (age != null && (!Number.isInteger(age) || age < 0 || age > 150)) throw new BadRequestException('年龄须为0至150的整数');
  const lower = (r.minAge ?? 0) + (r.minAge != null && !bounds.minInclusive ? 1 : 0);
  const upper = (r.maxAge ?? 150) - (r.maxAge != null && !bounds.maxInclusive ? 1 : 0);
  if (lower > upper) throw new BadRequestException('年龄范围为空');
  return { mode: r.mode, ...bounds, cutoffDate: r.cutoffDate, ...(r.minAge != null ? { minAge: r.minAge } : {}), ...(r.maxAge != null ? { maxAge: r.maxAge } : {}) };
}

export function shanghaiToday(now = new Date()) { return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10); }
export function ageOn(birth: string, cutoff: string) {
  // 非闰年2月29日出生者在3月1日达到新周岁。
  return Number(cutoff.slice(0, 4)) - Number(birth.slice(0, 4)) - (cutoff.slice(5) < birth.slice(5) ? 1 : 0);
}

export function parseIdentity(value: string, today = shanghaiToday()) {
  const normalized = value.trim().toUpperCase();
  if (!/^[1-9]\d{16}[\dX]$/.test(normalized)) throw new BadRequestException('身份证号须为18位有效号码');
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checksum = '10X98765432'[weights.reduce((sum, weight, i) => sum + weight * Number(normalized[i]), 0) % 11];
  if (checksum !== normalized[17]) throw new BadRequestException('身份证号校验位有误，请核对');
  const birthDate = `${normalized.slice(6, 10)}-${normalized.slice(10, 12)}-${normalized.slice(12, 14)}`;
  if (!calendarDate(birthDate) || birthDate > today || birthDate < '1800-01-01') throw new BadRequestException('身份证出生日期无效');
  return { normalized, birthDate, masked: `${normalized.slice(0, 3)}***********${normalized.slice(-4)}` };
}

export function checkAge(rule: AgeRule, birthDate: string | null): { status: Eligibility; age: number | null } {
  if (rule.mode === 'NONE') return { status: 'NOT_REQUIRED', age: null };
  if (!birthDate) return { status: 'PENDING', age: null };
  const actual = rule.mode === 'AGE' ? ageOn(birthDate, rule.cutoffDate!) : birthDate;
  const min = rule.mode === 'AGE' ? rule.minAge : rule.minDate;
  const max = rule.mode === 'AGE' ? rule.maxAge : rule.maxDate;
  if ((min != null && (rule.minInclusive === false ? actual <= min : actual < min)) ||
      (max != null && (rule.maxInclusive === false ? actual >= max : actual > max))) {
    throw new BadRequestException(`不符合本组年龄条件：${ageRuleLabel(rule)}${rule.mode === 'AGE' ? `；参赛年龄为${actual}周岁` : ''}`);
  }
  return { status: 'PASSED', age: typeof actual === 'number' ? actual : null };
}

function ageRangeText(min: number | undefined, max: number | undefined, unit: string) {
  if (min != null && max != null) return min === max ? `${min}${unit}` : `${min}～${max}${unit}`;
  if (max != null) return `${max}${unit}及以下`;
  return `${min}${unit}及以上`;
}

function birthRangeText(rule: AgeRule) {
  const lower = rule.minDate ? `${cnDate(rule.minDate)}${rule.minInclusive === false ? '（不含）' : ''}` : '';
  const upper = rule.maxDate ? `${cnDate(rule.maxDate)}${rule.maxInclusive === false ? '（不含）' : ''}` : '';
  if (lower && upper) return `${lower}至${upper}出生`;
  return lower ? `${lower}及以后出生` : `${upper}及以前出生`;
}

/** 规则说明，全部用中文日期：U8 → 「8岁及以下（按出生年份，2018年1月1日及以后出生）」。 */
export function ageRuleLabel(rule: AgeRule) {
  if (rule.mode === 'NONE') return '不限年龄';
  if (rule.mode === 'AGE') {
    const lower = rule.minAge != null ? rule.minAge + (rule.minInclusive === false ? 1 : 0) : undefined;
    const upper = rule.maxAge != null ? rule.maxAge - (rule.maxInclusive === false ? 1 : 0) : undefined;
    return `以${cnDate(rule.cutoffDate!)}为准，${ageRangeText(lower, upper, '周岁')}`;
  }
  if (rule.ageInput) {
    const { basis, minAge, maxAge, refDate } = rule.ageInput;
    return basis === 'YEAR'
      ? `${ageRangeText(minAge, maxAge, '岁')}（按出生年份，${birthRangeText(rule)}）`
      : `${ageRangeText(minAge, maxAge, '周岁')}（以${cnDate(refDate)}为准，${birthRangeText(rule)}）`;
  }
  return birthRangeText(rule);
}

/** 按本组规则的口径算年龄：按出生年份 / 以参照日期计周岁；没有年龄规则时按今天的周岁。 */
export function ageForRule(rule: AgeRule, birthDate: string, today = shanghaiToday()) {
  if (rule.ageInput?.basis === 'YEAR') return Number(rule.ageInput.refDate.slice(0, 4)) - Number(birthDate.slice(0, 4));
  if (rule.ageInput) return ageOn(birthDate, rule.ageInput.refDate);
  if (rule.mode === 'AGE' && rule.cutoffDate) return ageOn(birthDate, rule.cutoffDate);
  return ageOn(birthDate, today);
}

/**
 * 没填身份证、只填了年龄：超出本组年龄范围直接拦下；在范围内也只是自报，进入资格核验（PENDING）。
 * 只按出生日期设的组无法用年龄判断，同样待核验。
 */
export function checkReportedAge(rule: AgeRule, age: number): { status: Eligibility; age: number } {
  if (rule.mode === 'NONE') return { status: 'NOT_REQUIRED', age };
  const min = rule.ageInput ? rule.ageInput.minAge : rule.mode === 'AGE' && rule.minAge != null ? rule.minAge + (rule.minInclusive === false ? 1 : 0) : undefined;
  const max = rule.ageInput ? rule.ageInput.maxAge : rule.mode === 'AGE' && rule.maxAge != null ? rule.maxAge - (rule.maxInclusive === false ? 1 : 0) : undefined;
  if ((min != null && age < min) || (max != null && age > max)) {
    throw new BadRequestException(`不符合本组年龄条件：${ageRuleLabel(rule)}；填写的年龄为${age}岁`);
  }
  return { status: 'PENDING', age };
}

export function checkGender(type: string, gender: string | null, partner: string | null = null): Eligibility {
  const male = type.startsWith('MENS_');
  const female = type.startsWith('WOMENS_');
  const doubles = type.endsWith('DOUBLES');
  for (const value of doubles ? [gender, partner] : [gender]) {
    if (value && ((male && value !== 'MALE') || (female && value !== 'FEMALE'))) throw new BadRequestException('性别不符合所选项目要求');
  }
  if (type === 'MIXED_DOUBLES' && gender && partner && gender === partner) throw new BadRequestException('混合双打必须一男一女');
  return !gender || (doubles && !partner) ? 'PENDING' : 'PASSED';
}
