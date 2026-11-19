/**
 * 抽签小组编号。每个单项在抽签编排页设置 Event.groupNaming：
 * - LETTER（默认）：A、B…Z，之后接 AA、AB…（最多 100 组到 CV）；
 * - NUMBER：1、2、3…100。
 * 编号存在 DrawGroup.groupCode、Registration.groupName、小组赛 Match.round（roundNo = 0）里，
 * 页面和导出都写成「编号 + 组」，所以 A组 / 1组 两种都不用另外换算。
 */
export type GroupNamingMode = 'LETTER' | 'NUMBER';

/** 第 index 个小组（0 起）的编号：LETTER 0→A、25→Z、26→AA、99→CV；NUMBER 0→1、99→100。 */
export function groupCodeFor(index: number, naming: GroupNamingMode = 'LETTER'): string {
  let value = Math.max(0, Math.floor(index));
  if (naming === 'NUMBER') return String(value + 1);
  let label = '';
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

/**
 * 编号排序值（也接受「A组」「1组」这类带「组」的写法）：字母 A=1…Z=26、AA=27…；数字按数值，
 * 保证 2组 排在 10组 前面。都不是时排最后。
 */
export function groupCodeSortValue(code: string): number {
  const value = code.trim().toUpperCase();
  const digits = /^\d+/.exec(value)?.[0];
  if (digits) return Number(digits);
  const letters = /^[A-Z]+/.exec(value)?.[0];
  if (!letters) return Number.MAX_SAFE_INTEGER;
  return [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
}

/** 数字编号（1、2…）。导出里单写编号容易被看成「第 1 轮」，数字编号要带上「组」。 */
export function isNumericGroupCode(code: string | null | undefined): code is string {
  return typeof code === 'string' && /^\d+$/.test(code.trim());
}
