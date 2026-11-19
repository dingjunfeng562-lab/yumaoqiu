import type { BracketTree, BracketTreeMatch } from './orderbook-workbook';

/**
 * 后台「数据导出 → 对阵图（PNG）」：把淘汰对阵树（与秩序册流程表第二阶段同一份数据）画成 SVG，
 * 浏览器再转成 PNG 下载。版式参照前台对阵图：每场一个圆角框，双方各一行（名字、单位、每局比分），
 * 框上方是场次号 / 时间 / 场地，轮与轮之间折线相连，决赛接冠军，季军赛在决赛下方。
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

/** 对阵树 → SVG。整棵树画在一张图上（128 签也是一张长图），width/height 为像素尺寸。 */
export function renderBracketSvg(tree: BracketTree, meta: { title: string; subtitle: string }) {
  const { rounds } = tree;
  const titleY = PAD + 24;
  const subtitleY = titleY + 28;
  const chipY = subtitleY + 22;
  const bodyTop = chipY + CHIP_H + 14;
  const x = (k: number) => PAD + k * COL_W;

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

  const contentWidth = PAD * 2 + Math.max(0, rounds.length * COL_W - GAP_W) + (champion ? GAP_W + CHAMP_W : 0);
  const width = Math.ceil(
    Math.max(contentWidth, PAD * 2 + textWidth(meta.title, 24), PAD * 2 + textWidth(meta.subtitle, 13)),
  );
  const height = Math.ceil(bottom + PAD);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(FONT)}">` +
    `<rect width="${width}" height="${height}" fill="#FFFFFF"/>` +
    text(PAD, titleY, meta.title, { size: 24, fill: COLOR.text, bold: true }) +
    text(PAD, subtitleY, meta.subtitle, { size: 13, fill: COLOR.sub }) +
    body.join('') +
    '</svg>';
  return { svg, width, height };
}
