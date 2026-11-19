import type { BracketTree, BracketTreeMatch } from './orderbook-workbook';

/**
 * 后台「数据导出 → 对阵图（PNG）」：按阶段把秩序册流程表的内容画成 SVG，浏览器再转成 PNG 下载。
 * - 淘汰赛：对阵树，版式参照前台对阵图：每场一个圆角框，双方各一行（名字、单位、每局比分），
 *   框上方是场次号 / 时间 / 场地，轮与轮之间折线相连，决赛接冠军，季军赛在决赛下方。
 * - 小组赛 / 单循环成绩表、A-H 晋级赛、交叉排位赛：照流程表工作表原样画（sheetSection）。
 * - 全部阶段：多段上下排在一张图里（renderStagesSvg）。
 * 字体用电脑自带的中文字体（微软雅黑 / 苹方），不嵌字体文件。
 */

const FONT = "'Microsoft YaHei','PingFang SC','Hiragino Sans GB','Noto Sans CJK SC','Source Han Sans SC',sans-serif";
const PAD = 32;
const NAME_W = 200;
const SCORE_W = 84;
const BOX_W = NAME_W + SCORE_W;
const GAP_W = 56;
const COL_W = BOX_W + GAP_W;
const ROW_H = 26;
const INFO_H = 18;
// 首轮每场占的高度：场次信息 + 双方两行 + 间距。
const SLOT = INFO_H + ROW_H * 2 + 16;
const CHIP_H = 28;
const CHAMP_W = 220;

const COLOR = {
  line: '#94A3B8',
  box: '#CBD5E1',
  divider: '#E2E8F0',
  text: '#0F172A',
  muted: '#94A3B8',
  sub: '#64748B',
  accent: '#1D4ED8',
  chip: '#EFF6FF',
  gold: '#B45309',
  goldChip: '#FEF3C7',
};

function esc(text: string) {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function n(value: number) {
  return Math.round(value * 10) / 10;
}

// 估算文字宽度：中文按 1 个字号宽，ASCII 约半个字号。
function textWidth(text: string, size: number) {
  let width = 0;
  for (const ch of text) width += ch.charCodeAt(0) < 0x2e80 ? size * 0.56 : size;
  return width;
}

function clip(text: string, size: number, max: number) {
  if (textWidth(text, size) <= max) return text;
  let out = '';
  for (const ch of text) {
    if (textWidth(`${out}${ch}…`, size) > max) break;
    out += ch;
  }
  return out ? `${out}…` : '';
}

function text(
  x: number,
  y: number,
  content: string,
  options: { size: number; fill: string; bold?: boolean; anchor?: 'start' | 'middle' | 'end' },
) {
  if (!content) return '';
  const anchor = options.anchor && options.anchor !== 'start' ? ` text-anchor="${options.anchor}"` : '';
  const weight = options.bold ? ' font-weight="700"' : '';
  return `<text x="${n(x)}" y="${n(y)}" font-size="${options.size}" fill="${options.fill}"${weight}${anchor}>${esc(content)}</text>`;
}

function chip(x: number, y: number, width: number, label: string, fill: string, color: string) {
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${CHIP_H}" rx="${CHIP_H / 2}" fill="${fill}"/>` +
    text(x + width / 2, y + CHIP_H / 2 + 5, label, { size: 14, fill: color, bold: true, anchor: 'middle' })
  );
}

// 一场：mid = 双方之间横线的高度（也是出线连线的高度）。
function drawMatch(x: number, mid: number, match: BracketTreeMatch) {
  const top = mid - ROW_H;
  const parts: string[] = [];
  if (match.info) parts.push(text(x + 2, top - 6, clip(match.info, 11, BOX_W - 4), { size: 11, fill: COLOR.sub }));
  parts.push(
    `<rect x="${n(x)}" y="${n(top)}" width="${BOX_W}" height="${ROW_H * 2}" rx="6" fill="#FFFFFF" stroke="${COLOR.box}"/>`,
    `<path d="M${n(x)} ${n(mid)}H${n(x + BOX_W)}M${n(x + NAME_W)} ${n(top)}V${n(top + ROW_H * 2)}" stroke="${COLOR.divider}"/>`,
  );
  match.sides.forEach((side, index) => {
    const rowTop = index === 0 ? top : mid;
    const baseline = rowTop + ROW_H / 2 + 5;
    const muted = side.bye || side.name === '待定';
    if (side.winner) {
      parts.push(`<rect x="${n(x)}" y="${n(rowTop + 3)}" width="3" height="${ROW_H - 6}" fill="${COLOR.accent}"/>`);
    }
    const name = clip(side.name, 14, NAME_W - 18);
    parts.push(text(x + 10, baseline, name, { size: 14, fill: muted ? COLOR.muted : COLOR.text, bold: side.winner }));
    const unitSpace = NAME_W - 18 - textWidth(name, 14) - 10;
    if (side.unit && unitSpace >= 24) {
      parts.push(
        text(x + NAME_W - 8, baseline - 1, clip(side.unit, 11, unitSpace), { size: 11, fill: COLOR.sub, anchor: 'end' }),
      );
    }
    parts.push(
      text(x + NAME_W + SCORE_W / 2, baseline, clip(side.scores.join('  '), 13, SCORE_W - 8), {
        size: 13,
        fill: COLOR.text,
        bold: side.winner,
        anchor: 'middle',
      }),
    );
  });
  return parts.join('');
}

/** 「生成于」时间按北京时间写（服务器容器可能是 UTC）。 */
export function formatBracketGeneratedAt(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

/** 图里的一段（对阵树或表格），从 (0,0) 起画，width/height 为像素尺寸。 */
export type SvgSection = { width: number; height: number; body: string };

/** 对阵树：轮次标签 + 各轮场次框和连线，决赛接冠军，季军赛在决赛下方。 */
export function bracketTreeSection(tree: BracketTree): SvgSection {
  const { rounds } = tree;
  const chipY = 0;
  const bodyTop = chipY + CHIP_H + 14;
  const x = (k: number) => k * COL_W;

  // 每场双方之间横线的高度：首轮等距，后面各轮取两场来源的正中。
  const mids: number[][] = [];
  rounds.forEach((round, k) => {
    mids[k] = round.matches.map((_, m) => {
      if (k === 0) return bodyTop + m * SLOT + INFO_H + ROW_H;
      const a = mids[k - 1][2 * m];
      const b = mids[k - 1][2 * m + 1];
      if (a === undefined) return bodyTop + m * SLOT * 2 ** k + INFO_H + ROW_H;
      return b === undefined ? a : (a + b) / 2;
    });
  });

  const last = rounds.length - 1;
  const finalMid = last >= 0 && rounds[last].matches.length === 1 ? mids[last][0] : null;
  const champion = tree.champion !== null && finalMid !== null;
  const body: string[] = [];
  let bottom = bodyTop;

  // 连线先画，框盖在上面。
  rounds.forEach((round, k) => {
    if (!rounds[k + 1]) return;
    const x1 = x(k) + BOX_W;
    const spine = x1 + GAP_W / 2;
    const x2 = x(k + 1);
    const d: string[] = [];
    round.matches.forEach((_, m) => {
      if (m % 2) return;
      const a = mids[k][m];
      const b = mids[k][m + 1];
      if (b === undefined) {
        d.push(`M${n(x1)} ${n(a)}H${n(x2)}`);
        return;
      }
      const c = mids[k + 1][m / 2] ?? (a + b) / 2;
      d.push(`M${n(x1)} ${n(a)}H${n(spine)}V${n(b)}H${n(x1)}M${n(spine)} ${n(c)}H${n(x2)}`);
    });
    body.push(`<path d="${d.join('')}" fill="none" stroke="${COLOR.line}" stroke-width="1.5"/>`);
  });

  rounds.forEach((round, k) => {
    body.push(chip(x(k), chipY, BOX_W, round.label, COLOR.chip, COLOR.accent));
    round.matches.forEach((match, m) => {
      body.push(drawMatch(x(k), mids[k][m], match));
      bottom = Math.max(bottom, mids[k][m] + ROW_H);
    });
  });

  if (champion && finalMid !== null) {
    const x1 = x(last) + BOX_W;
    const xc = x1 + GAP_W;
    body.push(
      chip(xc, chipY, CHAMP_W, '冠军', COLOR.goldChip, COLOR.gold),
      `<path d="M${n(x1)} ${n(finalMid)}H${n(xc + CHAMP_W)}" stroke="${COLOR.gold}" stroke-width="2"/>`,
      text(xc + 8, finalMid - 10, clip(tree.champion || '待定', 18, CHAMP_W - 16), {
        size: 18,
        fill: tree.champion ? COLOR.gold : COLOR.muted,
        bold: Boolean(tree.champion),
      }),
    );
  }

  if (tree.bronze) {
    // 季军赛：决赛正下方；没有单场决赛时画在树的下面。
    const col = finalMid !== null ? last : 0;
    const chipTop = finalMid !== null ? finalMid + ROW_H + 40 : bottom + 40;
    const mid = chipTop + CHIP_H + 10 + INFO_H + ROW_H;
    body.push(chip(x(col), chipTop, BOX_W, '季军赛', COLOR.chip, COLOR.accent), drawMatch(x(col), mid, tree.bronze));
    bottom = Math.max(bottom, mid + ROW_H);
  }

  const width = Math.ceil(Math.max(0, rounds.length * COL_W - GAP_W) + (champion ? GAP_W + CHAMP_W : 0));
  return { width, height: Math.ceil(bottom), body: body.join('') };
}

// ---- 表格段：把秩序册流程表里画好的工作表（小组赛成绩表、A-H 晋级赛、交叉排位赛）原样画成 SVG ----
// 合并单元格、边框、底色、字体和对齐都照工作表；列宽按 Excel 字符宽换算，行高按文字行数撑开。
const SHEET_FONT_SCALE = 1.25; // 磅 → 像素（约）
const SHEET_LINE = 1.3;

function argbColor(color: { argb?: string } | undefined, fallback: string) {
  const argb = color?.argb;
  return argb && /^[0-9A-Fa-f]{8}$/.test(argb) ? `#${argb.slice(2)}` : fallback;
}

// 按宽度折行（中文按字、ASCII 约半字宽），先按工作表里的换行符分段。
function wrapLines(content: string, size: number, max: number, wrap: boolean) {
  const lines: string[] = [];
  for (const part of content.split(/\r?\n/)) {
    if (!wrap || textWidth(part, size) <= max) {
      lines.push(part);
      continue;
    }
    let line = '';
    for (const ch of part) {
      if (line && textWidth(line + ch, size) > max) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
    lines.push(line);
  }
  return lines;
}

type SheetCellLike = {
  address: string;
  isMerged: boolean;
  master: { address: string };
  text: string;
  font?: Partial<{ size: number; bold: boolean; italic: boolean; color: { argb?: string } }>;
  fill?: unknown;
  border?: Partial<Record<'top' | 'left' | 'bottom' | 'right', { style?: string; color?: { argb?: string } } | undefined>>;
  alignment?: Partial<{ horizontal: string; vertical: string; wrapText: boolean }>;
};
type SheetLike = {
  rowCount: number;
  properties: { defaultColWidth?: number };
  getRow(row: number): { height?: number; cellCount: number };
  getColumn(col: number): { width?: number };
  getCell(row: number, col: number): SheetCellLike;
};

export function sheetSection(ws: SheetLike, fromRow = 1, toRow = ws.rowCount): SvgSection {
  const last = Math.min(toRow, ws.rowCount);
  let cols = 0;
  for (let r = fromRow; r <= last; r += 1) cols = Math.max(cols, ws.getRow(r).cellCount);
  const colW = Array.from({ length: cols }, (_, i) => Math.round((ws.getColumn(i + 1).width ?? ws.properties.defaultColWidth ?? 8.43) * 7 + 5));
  const colX = [0];
  colW.forEach((w) => colX.push(colX[colX.length - 1] + w));

  // 合并区域：主格 → 右下角。
  const extent = new Map<string, { bottom: number; right: number }>();
  const cellAt = (r: number, c: number) => ws.getCell(r, c);
  for (let r = fromRow; r <= last; r += 1) {
    for (let c = 1; c <= cols; c += 1) {
      const cell = cellAt(r, c);
      if (!cell.isMerged) continue;
      const box = extent.get(cell.master.address) ?? { bottom: r, right: c };
      extent.set(cell.master.address, { bottom: Math.max(box.bottom, r), right: Math.max(box.right, c) });
    }
  }
  const spanOf = (r: number, c: number, cell: SheetCellLike) => extent.get(cell.address) ?? { bottom: r, right: c };
  const fontPx = (cell: SheetCellLike) => Math.round((cell.font?.size ?? 11) * SHEET_FONT_SCALE * 10) / 10;

  // 行高：工作表设了就用（磅 → 像素），没设按本行单格文字的行数撑开，至少 22 像素。
  const rowH: number[] = [];
  for (let r = fromRow; r <= last; r += 1) {
    const set = ws.getRow(r).height;
    let h = set ? set * (4 / 3) : 22;
    if (!set) {
      for (let c = 1; c <= cols; c += 1) {
        const cell = cellAt(r, c);
        if (cell.isMerged && cell.master.address !== cell.address) continue;
        const span = spanOf(r, c, cell);
        if (span.bottom !== r || !cell.text) continue;
        const size = fontPx(cell);
        const lines = wrapLines(cell.text, size, colX[span.right] - colX[c - 1] - 8, Boolean(cell.alignment?.wrapText));
        h = Math.max(h, lines.length * size * SHEET_LINE + 8);
      }
    }
    rowH.push(Math.ceil(h));
  }
  const rowY = [0];
  rowH.forEach((h) => rowY.push(rowY[rowY.length - 1] + h));
  const top = (r: number) => rowY[r - fromRow];

  const fills: string[] = [];
  const lines: string[] = [];
  const texts: string[] = [];
  const edge = (x1: number, y1: number, x2: number, y2: number, b?: { style?: string; color?: { argb?: string } }) => {
    if (!b?.style) return;
    const w = b.style === 'medium' ? 2 : b.style === 'thick' || b.style === 'double' ? 3 : 1;
    const dash = /dash|dot|hair/i.test(b.style) ? ' stroke-dasharray="2 2"' : '';
    lines.push(`<path d="M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}" stroke="${argbColor(b.color, '#64748B')}" stroke-width="${w}"${dash}/>`);
  };

  for (let r = fromRow; r <= last; r += 1) {
    for (let c = 1; c <= cols; c += 1) {
      const cell = cellAt(r, c);
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      const span = spanOf(r, c, cell);
      const x1 = colX[c - 1];
      const x2 = colX[span.right];
      const y1 = top(r);
      const y2 = top(span.bottom + 1);
      const fill = cell.fill as { type?: string; fgColor?: { argb?: string } } | undefined;
      if (fill?.type === 'pattern' && fill.fgColor?.argb) {
        fills.push(`<rect x="${n(x1)}" y="${n(y1)}" width="${n(x2 - x1)}" height="${n(y2 - y1)}" fill="${argbColor(fill.fgColor, '#FFFFFF')}"/>`);
      }
      // 边框：上、左取主格；右边、下边取合并区域最右一列、最下一行各格自己的边框。
      edge(x1, y1, x2, y1, cell.border?.top);
      edge(x1, y1, x1, y2, cell.border?.left);
      for (let rr = r; rr <= span.bottom; rr += 1) edge(x2, top(rr), x2, top(rr + 1), cellAt(rr, span.right).border?.right);
      for (let cc = c; cc <= span.right; cc += 1) edge(colX[cc - 1], y2, colX[cc], y2, cellAt(span.bottom, cc).border?.bottom);

      if (!cell.text) continue;
      const size = fontPx(cell);
      const textLines = wrapLines(cell.text, size, x2 - x1 - 8, Boolean(cell.alignment?.wrapText));
      const horizontal = cell.alignment?.horizontal;
      const anchor = horizontal === 'center' || horizontal === 'centerContinuous' ? 'middle' : horizontal === 'right' ? 'end' : 'start';
      const tx = anchor === 'middle' ? (x1 + x2) / 2 : anchor === 'end' ? x2 - 4 : x1 + 4;
      const blockH = textLines.length * size * SHEET_LINE;
      const firstBaseline = (y1 + y2) / 2 - blockH / 2 + size * 1.0;
      const color = argbColor(cell.font?.color, COLOR.text);
      textLines.forEach((line, i) => {
        texts.push(text(tx, firstBaseline + i * size * SHEET_LINE, line, { size, fill: color, bold: Boolean(cell.font?.bold), anchor }));
      });
    }
  }
  return { width: colX[cols] ?? 0, height: rowY[rowY.length - 1] ?? 0, body: fills.join('') + lines.join('') + texts.join('') };
}

/**
 * 整张图：大标题 + 副标题，下面依次画各段；有多段（全部阶段）时每段前加小标题。
 * 返回 SVG 文本和像素尺寸。
 */
export function renderStagesSvg(
  meta: { title: string; subtitle: string },
  sections: Array<SvgSection & { heading?: string }>,
) {
  const titleY = PAD + 24;
  const subtitleY = titleY + 28;
  let y = subtitleY + 22;
  const parts: string[] = [];
  let contentWidth = 0;
  sections.forEach((section, index) => {
    if (index > 0) y += 40;
    if (section.heading) {
      parts.push(text(PAD, y + 20, section.heading, { size: 18, fill: COLOR.accent, bold: true }));
      contentWidth = Math.max(contentWidth, textWidth(section.heading, 18));
      y += 36;
    }
    parts.push(`<g transform="translate(${PAD} ${n(y)})">${section.body}</g>`);
    contentWidth = Math.max(contentWidth, section.width);
    y += section.height;
  });
  const width = Math.ceil(
    Math.max(PAD * 2 + contentWidth, PAD * 2 + textWidth(meta.title, 24), PAD * 2 + textWidth(meta.subtitle, 13)),
  );
  const height = Math.ceil(y + PAD);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(FONT)}">` +
    `<rect width="${width}" height="${height}" fill="#FFFFFF"/>` +
    text(PAD, titleY, meta.title, { size: 24, fill: COLOR.text, bold: true }) +
    text(PAD, subtitleY, meta.subtitle, { size: 13, fill: COLOR.sub }) +
    parts.join('') +
    '</svg>';
  return { svg, width, height };
}

/** 对阵树 → 整张 SVG（只有这一段）。 */
export function renderBracketSvg(tree: BracketTree, meta: { title: string; subtitle: string }) {
  return renderStagesSvg(meta, [bracketTreeSection(tree)]);
}
