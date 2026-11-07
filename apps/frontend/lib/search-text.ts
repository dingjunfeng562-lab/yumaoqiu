// 前台搜索框共用的文字匹配：不分大小写、忽略空格、全角半角视为相同
//（「羽毛球 联赛」能搜到「羽毛球联赛」，「Ａ组」能搜到「A组」）。

function normalizeChar(char: string) {
  return char.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

export function normalizeSearchText(value?: string | null) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

export function matchesSearch(value: string | null | undefined, query: string) {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return normalizeSearchText(value).includes(needle);
}

/**
 * 把 text 按 query 第一次命中的位置切成三段，用于高亮。
 * 命中规则和 matchesSearch 一致；没命中返回 null。
 */
export function splitSearchMatch(text: string, query: string) {
  const needle = normalizeSearchText(query);
  if (!needle) return null;
  let normalized = '';
  // normalized 的每个 UTF-16 单元来自 text 的哪一段 [start, end)
  const origin: Array<[number, number]> = [];
  let offset = 0;
  for (const char of text) {
    const piece = normalizeChar(char);
    for (let i = 0; i < piece.length; i += 1) origin.push([offset, offset + char.length]);
    normalized += piece;
    offset += char.length;
  }
  const at = normalized.indexOf(needle);
  if (at < 0) return null;
  const start = origin[at][0];
  const end = origin[at + needle.length - 1][1];
  return { before: text.slice(0, start), match: text.slice(start, end), after: text.slice(end) };
}
