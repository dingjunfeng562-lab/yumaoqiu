import type { RosterCell, RosterMerge } from './excel-roster';

/**
 * CSV 字节转文本：先按 UTF-8（自动去掉 BOM），不是合法 UTF-8 时再按 GB18030。
 * 中文 Windows 版 Excel「另存为 CSV」默认是 GBK 编码，直接按 UTF-8 读会整份乱码。
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

/** 把 xlsx 工作表转成二维数组，并保留合并区域信息。 */
export function sheetToGrid(sheet: Record<string, unknown>, XLSX: typeof import('xlsx')) {
  const ref = typeof sheet['!ref'] === 'string' ? sheet['!ref'] : 'A1';
  const range = XLSX.utils.decode_range(ref);
  const grid: RosterCell[][] = [];
  for (let r = 0; r <= range.e.r; r += 1) {
    const row: RosterCell[] = [];
    for (let c = 0; c <= range.e.c; c += 1) {
      const cell = (sheet as Record<string, { v?: unknown } | undefined>)[XLSX.utils.encode_cell({ r, c })];
      row.push(cell?.v as RosterCell);
    }
    grid.push(row);
  }
  const merges = (Array.isArray(sheet['!merges']) ? sheet['!merges'] : []) as RosterMerge[];
  return { grid, merges };
}
