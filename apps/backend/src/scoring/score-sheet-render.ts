import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import sharp from 'sharp';
import {
  SCORE_SHEET_END_TYPE_LABELS,
  type ScoreSheetSide,
  type ScoreSheetSnapshot,
} from './score-sheet.types';

const FONT_FAMILY_NAME = 'ScoreSheet Sans';
const FONT_STACK = `'${FONT_FAMILY_NAME}', 'Noto Sans CJK SC', 'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', 'WenQuanYi Micro Hei', sans-serif`;
let fontsRegistered = false;

/** 用仓库自带的思源黑体画中文；文件不在时退回系统字体。 */
function ensureFonts() {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const path = join(process.cwd(), 'assets', 'fonts', 'NotoSansSC-Bold.otf');
  try {
    if (existsSync(path)) GlobalFonts.registerFromPath(path, FONT_FAMILY_NAME);
  } catch {
    /* 注册失败时用系统字体兜底 */
  }
}

function font(size: number) {
  return `${size}px ${FONT_STACK}`;
}

export type ScoreSheetRenderInput = {
  sheetId: string;
  snapshot: ScoreSheetSnapshot;
  signedAt: Date;
  contentHash: string;
  winnerSignerName: string | null;
  winnerSignature: Buffer | null;
  refereeSignature: Buffer;
};

const WIDTH = 1240;
const MARGIN = 64;
const MAX_HEIGHT = 4800;
const CONTENT_WIDTH = WIDTH - MARGIN * 2;

/** 容器跑在 UTC，比分单上的时间统一按北京时间写。 */
export function formatBeijingTime(value: string | Date | null | undefined, withSeconds = true) {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '—';
  const date = new Date(time + 8 * 3600 * 1000);
  const pad = (num: number) => String(num).padStart(2, '0');
  const base = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return withSeconds ? `${base}:${pad(date.getUTCSeconds())}` : base;
}

export function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours ? `${hours}小时${minutes}分${rest}秒` : `${minutes}分${rest}秒`;
}

function sideSubtitle(side: ScoreSheetSide | null) {
  if (!side) return '';
  const parts = [side.teamName, side.affiliation].filter((part): part is string => Boolean(part && part.trim()));
  return [...new Set(parts)].join(' · ');
}

/** 按宽度折行：中文逐字断开。 */
function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of Array.from(paragraph)) {
      const next = line + char;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = char.trim() ? char : '';
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** 按词折行：逐分过程的每个比分是一个整体，不拆开。 */
function wrapTokens(ctx: SKRSContext2D, tokens: string[], maxWidth: number, separator = '   '): string[] {
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    const next = line ? `${line}${separator}${token}` : token;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = token;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundedRect(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function divider(ctx: SKRSContext2D, y: number) {
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(WIDTH - MARGIN, y);
  ctx.stroke();
}

function heading(ctx: SKRSContext2D, text: string, y: number) {
  ctx.fillStyle = '#0f172a';
  ctx.font = font(28);
  ctx.fillText(text, MARGIN, y);
  return y + 46;
}

async function drawSignature(
  ctx: SKRSContext2D,
  image: Buffer | null,
  x: number,
  y: number,
  width: number,
  height: number,
  emptyText: string,
) {
  if (!image) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = font(22);
    ctx.textAlign = 'center';
    ctx.fillText(emptyText, x + width / 2, y + height / 2 - 14);
    ctx.textAlign = 'left';
    return;
  }
  const picture = await loadImage(image);
  const scale = Math.min(width / picture.width, height / picture.height, 2);
  const drawWidth = picture.width * scale;
  const drawHeight = picture.height * scale;
  ctx.drawImage(picture, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

/**
 * 把冻结的比分快照和两张签名画成一张 PNG 比分单（A4 竖版比例，宽 1240）。
 * 先在一张足够高的画布上从上往下画，最后按实际内容高度裁掉空白。
 */
export async function renderScoreSheetPng(input: ScoreSheetRenderInput): Promise<Buffer> {
  ensureFonts();
  const snapshot = input.snapshot;
  const canvas = createCanvas(WIDTH, MAX_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, MAX_HEIGHT);
  ctx.textBaseline = 'top';
  let y = MARGIN;

  // 标题
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0f172a';
  ctx.font = font(46);
  ctx.fillText('电子比分单', WIDTH / 2, y);
  y += 68;
  ctx.font = font(26);
  ctx.fillStyle = '#334155';
  for (const line of wrapText(ctx, snapshot.tournament.name, CONTENT_WIDTH)) {
    ctx.fillText(line, WIDTH / 2, y);
    y += 38;
  }
  ctx.textAlign = 'left';
  y += 14;
  divider(ctx, y);
  y += 26;

  // 基本信息（两列）
  const endLabel = SCORE_SHEET_END_TYPE_LABELS[snapshot.endType] ?? snapshot.endType;
  const info: Array<[string, string]> = [
    ['项目', snapshot.eventLabel],
    ['轮次', snapshot.matchLabel || `${snapshot.roundLabel} · 第 ${snapshot.matchNo} 场`],
    ['场地', snapshot.venue ?? '—'],
    ['计划时间', formatBeijingTime(snapshot.scheduledAt, false)],
    ['开始时间', formatBeijingTime(snapshot.startedAt)],
    ['结束时间', formatBeijingTime(snapshot.finishedAt)],
    ['比赛用时', formatDuration(snapshot.durationSeconds)],
    ['结束方式', endLabel],
  ];
  if (snapshot.endReason) info.push(['原因', snapshot.endReason]);
  const columnWidth = CONTENT_WIDTH / 2;
  ctx.font = font(22);
  for (let index = 0; index < info.length; index += 2) {
    let rowHeight = 32;
    for (let column = 0; column < 2; column += 1) {
      const item = info[index + column];
      if (!item) continue;
      const x = MARGIN + column * columnWidth;
      const label = `${item[0]}：`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(label, x, y);
      const labelWidth = ctx.measureText(label).width;
      ctx.fillStyle = '#0f172a';
      const lines = wrapText(ctx, item[1] || '—', columnWidth - labelWidth - 20);
      lines.forEach((line, lineIndex) => ctx.fillText(line, x + labelWidth, y + lineIndex * 32));
      rowHeight = Math.max(rowHeight, lines.length * 32);
    }
    y += rowHeight + 10;
  }
  y += 8;
  divider(ctx, y);
  y += 26;

  // 对阵双方
  y = heading(ctx, '对阵双方', y);
  const gap = 24;
  const sideWidth = (CONTENT_WIDTH - gap) / 2;
  const sides: Array<{ label: string; side: ScoreSheetSide | null; won: boolean }> = [
    { label: 'A 方', side: snapshot.side1, won: snapshot.winnerSide === 1 },
    { label: 'B 方', side: snapshot.side2, won: snapshot.winnerSide === 2 },
  ];
  ctx.font = font(32);
  const nameLines = sides.map(({ side }) => wrapText(ctx, side?.name ?? '待定', sideWidth - 48));
  ctx.font = font(20);
  const subLines = sides.map(({ side }) => {
    const subtitle = sideSubtitle(side);
    return subtitle ? wrapText(ctx, subtitle, sideWidth - 48) : [];
  });
  const sideHeight = Math.max(
    ...sides.map((_, index) => 20 + 34 + nameLines[index].length * 42 + subLines[index].length * 28 + 20),
  );
  sides.forEach(({ label, won }, index) => {
    const x = MARGIN + index * (sideWidth + gap);
    roundedRect(ctx, x, y, sideWidth, sideHeight, 16);
    ctx.fillStyle = won ? '#ecfdf5' : '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = won ? '#10b981' : '#cbd5e1';
    ctx.lineWidth = won ? 3 : 2;
    ctx.stroke();
    let innerY = y + 20;
    ctx.font = font(20);
    ctx.fillStyle = '#64748b';
    ctx.fillText(won ? `${label} · 胜方` : label, x + 24, innerY);
    innerY += 34;
    ctx.font = font(32);
    ctx.fillStyle = '#0f172a';
    for (const line of nameLines[index]) {
      ctx.fillText(line, x + 24, innerY);
      innerY += 42;
    }
    ctx.font = font(20);
    ctx.fillStyle = '#475569';
    for (const line of subLines[index]) {
      ctx.fillText(line, x + 24, innerY);
      innerY += 28;
    }
  });
  y += sideHeight + 30;

  // 每局比分
  y = heading(ctx, '每局比分', y);
  const columns = [
    { title: '局次', width: CONTENT_WIDTH * 0.2 },
    { title: 'A 方', width: CONTENT_WIDTH * 0.25 },
    { title: 'B 方', width: CONTENT_WIDTH * 0.25 },
    { title: '本局胜方', width: CONTENT_WIDTH * 0.3 },
  ];
  const rowHeight = 48;
  const drawRow = (cells: string[], top: number, background: string | null, bold = false) => {
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(MARGIN, top, CONTENT_WIDTH, rowHeight);
    }
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(MARGIN, top, CONTENT_WIDTH, rowHeight);
    let x = MARGIN;
    ctx.font = font(bold ? 24 : 22);
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    cells.forEach((cell, index) => {
      ctx.fillText(cell, x + columns[index].width / 2, top + 12);
      x += columns[index].width;
    });
    ctx.textAlign = 'left';
  };
  drawRow(columns.map((column) => column.title), y, '#f1f5f9', true);
  y += rowHeight;
  for (const game of snapshot.games) {
    drawRow(
      [
        `第 ${game.gameNo} 局`,
        String(game.side1Score),
        String(game.side2Score),
        game.winnerSide === 1 ? 'A 方' : game.winnerSide === 2 ? 'B 方' : '—',
      ],
      y,
      null,
    );
    y += rowHeight;
  }
  const winnerName = snapshot.winnerSide === 1
    ? snapshot.side1?.name
    : snapshot.winnerSide === 2
      ? snapshot.side2?.name
      : null;
  drawRow(
    ['局分', String(snapshot.side1Games), String(snapshot.side2Games), winnerName ? '胜方见下' : '无胜方'],
    y,
    '#f8fafc',
    true,
  );
  y += rowHeight + 16;
  ctx.font = font(24);
  ctx.fillStyle = '#047857';
  for (const line of wrapText(ctx, winnerName ? `胜方：${winnerName}` : `结果：${endLabel}，本场无胜方`, CONTENT_WIDTH)) {
    ctx.fillText(line, MARGIN, y);
    y += 34;
  }
  y += 18;

  // 逐分过程
  y = heading(ctx, '得分过程（每得一分后的比分，A:B）', y);
  ctx.font = font(20);
  if (!snapshot.games.length) {
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('（无每局比分）', MARGIN, y);
    y += 32;
  }
  for (const game of snapshot.games) {
    const scores = snapshot.points.find((item) => item.gameNo === game.gameNo)?.scores ?? [];
    const prefix = `第 ${game.gameNo} 局：`;
    ctx.fillStyle = '#334155';
    ctx.fillText(prefix, MARGIN, y);
    const prefixWidth = ctx.measureText(prefix).width;
    ctx.fillStyle = scores.length ? '#0f172a' : '#94a3b8';
    const lines = scores.length
      ? wrapTokens(ctx, scores.map(([a, b]) => `${a}:${b}`), CONTENT_WIDTH - prefixWidth)
      : ['（无逐分记录，比分为弃权判定或后台录入）'];
    lines.forEach((line, index) => ctx.fillText(line, MARGIN + prefixWidth, y + index * 30));
    y += lines.length * 30 + 10;
  }
  y += 16;
  divider(ctx, y);
  y += 26;

  // 签字
  y = heading(ctx, '签字确认', y);
  const boxHeight = 300;
  const boxes = [
    {
      title: snapshot.winnerSide
        ? `胜方签字${input.winnerSignerName ? `（${input.winnerSignerName}）` : ''}`
        : '胜方签字',
      image: input.winnerSignature,
      empty: snapshot.winnerSide ? '（无签名）' : '双方弃权，本场无胜方',
    },
    {
      title: `裁判签字（账号：${snapshot.referee.name}）`,
      image: input.refereeSignature,
      empty: '（无签名）',
    },
  ];
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    const x = MARGIN + index * (sideWidth + gap);
    ctx.font = font(22);
    ctx.fillStyle = '#334155';
    const titleLines = wrapText(ctx, box.title, sideWidth);
    titleLines.forEach((line, lineIndex) => ctx.fillText(line, x, y + lineIndex * 30));
  }
  ctx.font = font(22);
  const titleHeight = Math.max(...boxes.map((box) => wrapText(ctx, box.title, sideWidth).length)) * 30 + 10;
  y += titleHeight;
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    const x = MARGIN + index * (sideWidth + gap);
    roundedRect(ctx, x, y, sideWidth, boxHeight, 16);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.stroke();
    await drawSignature(ctx, box.image, x + 20, y + 20, sideWidth - 40, boxHeight - 40, box.empty);
  }
  y += boxHeight + 20;
  ctx.font = font(22);
  ctx.fillStyle = '#0f172a';
  ctx.fillText(`签字时间：${formatBeijingTime(input.signedAt)}（北京时间）`, MARGIN, y);
  y += 44;
  divider(ctx, y);
  y += 22;

  // 页脚：编号和指纹
  ctx.font = font(18);
  ctx.fillStyle = '#64748b';
  const footer = [
    `记录编号：${input.sheetId}`,
    `防篡改指纹（SHA-256）：${input.contentHash}`,
    '本比分单由系统在签字确认时按当时的比分自动生成。比分快照和两张签名图片的指纹已一并记录，任何一处被改动，指纹都会对不上。',
  ];
  for (const text of footer) {
    for (const line of wrapText(ctx, text, CONTENT_WIDTH)) {
      ctx.fillText(line, MARGIN, y);
      y += 28;
    }
  }

  const height = Math.min(MAX_HEIGHT, Math.ceil(y + MARGIN));
  // encode 在后台线程编码，不卡住记分接口。
  const full = await canvas.encode('png');
  return sharp(full)
    .extract({ left: 0, top: 0, width: WIDTH, height })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
