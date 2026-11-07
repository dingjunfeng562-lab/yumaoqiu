// 赛事统计里学校名称的规范化与归并。报名时学校是手填的，同一所学校常有多种写法
// （「重庆应用技术职业学院」「应用技术职业学院」「应用职业」），不处理会把高校数算多。

// 报名审核通过时没填学校会写成「未填写学校」；这些占位写法都按「未填写」处理。
const PLACEHOLDERS = new Set(['未填写学校', '未填写', '无', '暂无', '-', '--', '—', '/', '0']);

/**
 * 规范化写法：全角转半角（NFKC）、去掉所有空白、去掉「(xx校区)」。
 * 只去含「校区」的括号：「中国石油大学(华东)」的括号是校名的一部分，不能去。
 * 占位写法返回空串。
 */
export function normalizeSchoolName(raw?: string | null): string {
  if (!raw) return '';
  const value = raw
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/\([^()]*校区[^()]*\)/g, '');
  return PLACEHOLDERS.has(value) ? '' : value;
}

/** 规范化姓名，用来把同一个人在不同项目里的报名认成一个人。 */
export function normalizePersonName(raw?: string | null): string {
  return (raw ?? '').normalize('NFKC').replace(/\s+/g, '');
}

export type SchoolAliasRule = { alias: string; canonical: string | null; ignored: boolean };

export type ResolvedSchool =
  | { kind: 'empty' }
  | { kind: 'ignored'; normalized: string }
  | { kind: 'school'; normalized: string; canonical: string };

/**
 * 按别名表把一个手填的学校名解析成标准校名。别名可能连环（A→B、B→C），
 * 最多跟 8 层，遇到环就停在当前名字上，保证不会死循环。
 */
export function createSchoolResolver(rules: SchoolAliasRule[]) {
  const byAlias = new Map(rules.map((rule) => [rule.alias, rule]));
  return (raw?: string | null): ResolvedSchool => {
    const normalized = normalizeSchoolName(raw);
    if (!normalized) return { kind: 'empty' };
    let current = normalized;
    const seen = new Set<string>();
    for (let depth = 0; depth < 8; depth += 1) {
      const rule = byAlias.get(current);
      if (!rule || seen.has(current)) break;
      seen.add(current);
      if (rule.ignored) return { kind: 'ignored', normalized };
      const next = normalizeSchoolName(rule.canonical);
      if (!next || next === current) break;
      current = next;
    }
    return { kind: 'school', normalized, canonical: current };
  };
}

/** a 的每个字按顺序都能在 b 里找到（不要求连续）：「应用职业」⊂「重庆应用技术职业学院」。 */
function isSubsequence(a: string, b: string) {
  let index = 0;
  for (const char of b) {
    if (char === a[index]) index += 1;
    if (index === a.length) return true;
  }
  return index === a.length;
}

// 少于 3 个字的写法（「高」「大学」）太短，按字序匹配几乎会命中所有校名，不做提示。
const MIN_SUGGEST_LENGTH = 3;
// 以这些结尾的写法本身就像完整校名。
const INSTITUTION_SUFFIX = /(大学|学院|学校|中学|小学|职校|高专|大专|分校|校区|研究院|研究所|党校|附中)$/;

export type MergeSuggestion = { name: string; people: number; candidates: string[] };

/** a 是否可能是 b 的另一种写法（b 更完整）。 */
function looksLikeVariantOf(a: string, b: string) {
  if (b.length <= a.length) return false;
  // 完整校名只认「前面多了地名等前缀」：「应用技术职业学院」→「重庆应用技术职业学院」。
  // 不能按字序匹配，否则「重庆大学」会被当成「重庆工商大学」、「西南大学」当成「西南政法大学」。
  if (INSTITUTION_SUFFIX.test(a)) return b.endsWith(a);
  // 简写（「应用职业」「重庆应用」）按字序包含即可。
  return isSubsequence(a, b);
}

/**
 * 疑似重复：较短的写法可能是较长校名的简写或省略了前缀，提示把短的归并到长的。
 * 只是提示，由超级管理员确认后才写进别名表。候选按人数从多到少。
 */
export function suggestSchoolMerges(schools: Array<{ name: string; people: number }>): MergeSuggestion[] {
  const suggestions: MergeSuggestion[] = [];
  for (const school of schools) {
    if (school.name.length < MIN_SUGGEST_LENGTH) continue;
    const candidates = schools
      .filter((other) => other.name !== school.name && looksLikeVariantOf(school.name, other.name))
      .sort((a, b) => b.people - a.people || a.name.localeCompare(b.name, 'zh-CN'))
      .map((other) => other.name);
    if (candidates.length) suggestions.push({ name: school.name, people: school.people, candidates });
  }
  return suggestions.sort((a, b) => b.people - a.people || a.name.localeCompare(b.name, 'zh-CN'));
}
