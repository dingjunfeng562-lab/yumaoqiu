'use client';

import type { SecondStageMatch, SecondStageRankingMode } from './SecondStageBracket';

// 第二阶段排位赛「交叉树」对阵图：前8初始赛 A vs B / C vs D / E vs F / G vs H，
// 胜者实线向右进入 1—4 名争夺区，负者虚线交叉向下进入 5—8 名争夺区。
// 拓扑与后端 SECOND_STAGE_PROPAGATION_EDGES 一致，是该结构的前端可视化。

type Variant = 'light' | 'dark';

const CARD_W = 200;
const CARD_H = 90; // 高度容纳「队伍名 + 队员名」两行
const PAD = 14;
const COL_X = [0, 270, 540];
const DIVIDER_Y = 437;

// 每个场次编号在画板中的左上角坐标（PAD 偏移在渲染时叠加）。纵向节距 108 = 卡高 + 间隙。
const POS: Record<number, { x: number; y: number }> = {
  1: { x: COL_X[0], y: 0 },
  2: { x: COL_X[0], y: 108 },
  3: { x: COL_X[0], y: 216 },
  4: { x: COL_X[0], y: 324 },
  5: { x: COL_X[1], y: 54 },
  6: { x: COL_X[1], y: 270 },
  7: { x: COL_X[2], y: 162 },
  8: { x: COL_X[2], y: 270 },
  9: { x: COL_X[1], y: 460 },
  10: { x: COL_X[1], y: 568 },
  11: { x: COL_X[2], y: 514 },
  12: { x: COL_X[2], y: 622 },
};

type Edge = { from: number; to: number; kind: 'win' | 'lose'; cross?: boolean };
const EDGES: Edge[] = [
  { from: 1, to: 5, kind: 'win' },
  { from: 2, to: 5, kind: 'win' },
  { from: 3, to: 6, kind: 'win' },
  { from: 4, to: 6, kind: 'win' },
  { from: 5, to: 7, kind: 'win' },
  { from: 6, to: 7, kind: 'win' },
  { from: 5, to: 8, kind: 'lose' },
  { from: 6, to: 8, kind: 'lose' },
  { from: 1, to: 9, kind: 'lose', cross: true },
  { from: 2, to: 9, kind: 'lose', cross: true },
  { from: 3, to: 10, kind: 'lose', cross: true },
  { from: 4, to: 10, kind: 'lose', cross: true },
  { from: 9, to: 11, kind: 'win' },
  { from: 10, to: 11, kind: 'win' },
  { from: 9, to: 12, kind: 'lose' },
  { from: 10, to: 12, kind: 'lose' },
];

function roundLabel(no: number, top6: boolean) {
  switch (no) {
    case 1:
    case 2:
    case 3:
    case 4:
      return '前8初始赛';
    case 5:
    case 6:
      return '1-4 半决赛';
    case 7:
      return '决赛 · 1/2名';
    case 8:
      return '3/4名';
    case 9:
    case 10:
      return top6 ? '5-6 资格赛' : '5-8 半决赛';
    case 11:
      return top6 ? '5/6名 决赛' : '5/6名';
    case 12:
      return '7/8名';
    default:
      return '';
  }
}

type Theme = {
  card: string;
  matchNo: string;
  name: string;
  nameWin: string;
  sub: string;
  tag: string;
  caption: string;
  win: string;
  lose: string;
  divider: string;
  legend: string;
};

const THEME: Record<Variant, Theme> = {
  light: {
    card: 'border-slate-200 bg-white',
    matchNo: 'text-slate-400',
    name: 'text-slate-700',
    nameWin: 'text-[#03205c]',
    sub: 'text-slate-400',
    tag: 'bg-emerald-600 text-white',
    caption: 'border-slate-200 bg-white text-slate-500',
    win: '#2563eb',
    lose: '#d97706',
    divider: '#cbd5e1',
    legend: 'text-slate-500',
  },
  dark: {
    card: 'border-white/15 bg-slate-950/55',
    matchNo: 'text-white/40',
    name: 'text-white/85',
    nameWin: 'text-amber-300',
    sub: 'text-white/45',
    tag: 'bg-emerald-400 text-slate-950',
    caption: 'border-white/15 bg-slate-900 text-white/60',
    win: '#6ee7b7',
    lose: '#fbbf24',
    divider: 'rgba(255,255,255,0.18)',
    legend: 'text-white/45',
  },
};

function scoreText(score?: string | null) {
  if (!score) return '';
  return score.replace(/\s*[:：]\s*/g, ':');
}

// 一个 A-H 字母 = 一支队伍。初始赛两侧用字母徽标标出各自队伍；
// 队伍名为主、队员名小字列在下方；派生场（胜/负来源）没有字母，显示来源说明或已晋级队伍。
function SideLine({
  source,
  name,
  members,
  win,
  theme,
}: {
  source?: string | null;
  name?: string | null;
  members?: string[] | null;
  win: boolean;
  theme: Theme;
}) {
  const s = source?.trim();
  const n = name?.trim();
  const slot = s && /^[A-H]$/.test(s) ? s : null;
  const text = n || (slot ? '待定' : s || '待定');
  const mem = (members ?? []).filter(Boolean);
  // 队员名与队伍名相同时（单打、或双打没设队伍名直接是「甲 / 乙」）不再重复显示。
  const showMembers = mem.length > 1 && mem.join(' / ') !== text;
  return (
    <div className="mt-1 flex items-start gap-1.5">
      {slot ? (
        <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-black ${theme.tag}`}>
          {slot}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className={`min-w-0 flex-1 truncate text-[12px] ${win ? `font-black ${theme.nameWin}` : `font-semibold ${theme.name}`}`}>
            {text}
          </span>
          {win ? <span className={`shrink-0 text-[9px] font-black ${theme.nameWin}`}>胜</span> : null}
        </div>
        {showMembers ? (
          <div className={`truncate text-[10px] font-semibold ${theme.sub}`}>{mem.join(' / ')}</div>
        ) : null}
      </div>
    </div>
  );
}

export function SecondStageCrossBracket({
  matches,
  rankingMode = 'TOP_8',
  variant = 'light',
}: {
  matches: SecondStageMatch[];
  rankingMode?: SecondStageRankingMode;
  variant?: Variant;
}) {
  const theme = THEME[variant];
  const top6 = rankingMode === 'TOP_6';
  const byNo = new Map(matches.map((match) => [match.matchNo, match]));
  // TOP_6 不打第12场（7/8名），其相关连线一并去掉。
  const nos = Object.keys(POS)
    .map(Number)
    .filter((no) => !(top6 && no === 12));
  const edges = EDGES.filter((edge) => !(top6 && (edge.from === 12 || edge.to === 12)));

  const boardW = Math.max(...nos.map((no) => POS[no].x + CARD_W)) + PAD * 2;
  const boardH = Math.max(...nos.map((no) => POS[no].y + CARD_H)) + PAD * 2;
  const dividerY = PAD + DIVIDER_Y;

  const rightCenter = (no: number) => ({ x: PAD + POS[no].x + CARD_W, y: PAD + POS[no].y + CARD_H / 2 });
  const leftCenter = (no: number) => ({ x: PAD + POS[no].x, y: PAD + POS[no].y + CARD_H / 2 });

  const pathFor = (edge: Edge) => {
    const a = rightCenter(edge.from);
    const b = leftCenter(edge.to);
    if (edge.cross) return `M${a.x},${a.y} L${b.x},${b.y}`; // 负者交叉下移：直线斜连
    const mid = (a.x + b.x) / 2;
    return `M${a.x},${a.y} H${mid} V${b.y} H${b.x}`; // 同区晋级：直角折线
  };

  return (
    <div>
      <div className="overflow-auto [scrollbar-width:thin]" style={{ maxHeight: 660 }}>
        <div className="relative" style={{ width: boardW, height: boardH }}>
          <svg className="pointer-events-none absolute inset-0" width={boardW} height={boardH} aria-hidden>
            <line
              x1={PAD}
              y1={dividerY}
              x2={boardW - PAD}
              y2={dividerY}
              stroke={theme.divider}
              strokeWidth={1}
              strokeDasharray="3 6"
            />
            {edges.map((edge) => (
              <path
                key={`${edge.from}-${edge.to}`}
                d={pathFor(edge)}
                fill="none"
                stroke={edge.kind === 'win' ? theme.win : theme.lose}
                strokeWidth={1.7}
                strokeDasharray={edge.kind === 'lose' ? '5 4' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </svg>

          <div
            className={`absolute rounded-full border px-2.5 py-0.5 text-[10px] font-black shadow-sm ${theme.caption}`}
            style={{ left: PAD + COL_X[1], top: dividerY - 11 }}
          >
            ▲ 1—4 名争夺区　▼ 5—8 名争夺区
          </div>

          {nos.map((no) => {
            const match = byNo.get(no);
            const score = scoreText(match?.score);
            return (
              <div
                key={no}
                className={`absolute flex flex-col rounded-lg border px-2.5 py-1.5 shadow-sm ${theme.card}`}
                style={{ left: PAD + POS[no].x, top: PAD + POS[no].y, width: CARD_W, height: CARD_H }}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={`truncate text-[10px] font-black ${theme.matchNo}`}>
                    第{no}场 · {roundLabel(no, top6)}
                  </span>
                  {score ? (
                    <span className={`shrink-0 text-[10px] font-bold tabular-nums ${theme.sub}`}>{score}</span>
                  ) : null}
                </div>
                <SideLine source={match?.source1} name={match?.player1Name} members={match?.player1Members} win={match?.winnerSide === 1} theme={theme} />
                <SideLine source={match?.source2} name={match?.player2Name} members={match?.player2Members} win={match?.winnerSide === 2} theme={theme} />
              </div>
            );
          })}
        </div>
      </div>
      <div className={`mt-2 flex flex-wrap items-center gap-4 text-[10px] font-bold ${theme.legend}`}>
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="6" aria-hidden>
            <line x1="0" y1="3" x2="26" y2="3" stroke={theme.win} strokeWidth="1.8" />
          </svg>
          胜者晋级
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="6" aria-hidden>
            <line x1="0" y1="3" x2="26" y2="3" stroke={theme.lose} strokeWidth="1.8" strokeDasharray="5 4" />
          </svg>
          负者交叉下移（进入 5—8 名区）
        </span>
      </div>
    </div>
  );
}
