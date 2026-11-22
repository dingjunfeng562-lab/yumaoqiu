import type {
  BracketMatch,
  BracketParticipant,
  KnockoutBracketData,
} from '@/components/bracket/KnockoutBracket';

// 公开对阵数据（/api/public/brackets）里一场比赛的展示用小工具。
// 直播大屏幕（LiveScreenClient）和赛事比分直播页（LiveMatchBoard）共用。

export type MatchStatusKey = 'PENDING' | 'LIVE' | 'COMPLETED' | 'CANCELLED';

const STATUS_LABELS: Record<string, string> = {
  PENDING: '待开始',
  LIVE: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  未开始: '待开始',
  进行中: '进行中',
  已结束: '已完成',
  已完成: '已完成',
};

export function normalizeStatus(status?: string | null): MatchStatusKey {
  const raw = String(status || 'PENDING');
  const upper = raw.toUpperCase();
  if (upper === 'LIVE' || raw === '进行中') return 'LIVE';
  if (upper === 'COMPLETED' || upper === 'FINISHED' || raw === '已结束' || raw === '已完成') return 'COMPLETED';
  if (upper === 'CANCELLED' || raw === '已取消') return 'CANCELLED';
  return 'PENDING';
}

export function statusText(status?: string | null) {
  return STATUS_LABELS[String(status)] ?? STATUS_LABELS[normalizeStatus(status)] ?? '待开始';
}

export type ParsedGame = { side1: number; side2: number };

/** "21:18 / 15:12" → [{21,18},{15,12}] */
export function parseGames(text: string) {
  const games: ParsedGame[] = [];
  for (const segment of text.split(/[/,]/)) {
    const parts = segment.trim().match(/^(\d+)\s*[:：-]\s*(\d+)/);
    if (parts) games.push({ side1: Number(parts[1]), side2: Number(parts[2]) });
  }
  return games;
}

export function playerName(participant?: BracketParticipant | null) {
  if (!participant || participant.isBye) return '待定';
  return participant.name;
}

export function playersFor(participant?: BracketParticipant | null) {
  if (!participant || participant.isBye) return [];
  return participant.members?.length ? participant.members : [participant.name];
}

export function sideFor(bracket: KnockoutBracketData, id?: string | null) {
  if (!id) return null;
  return bracket.participants.find((participant) => participant.id === id) ?? null;
}

export function isByeMatch(bracket: KnockoutBracketData, match: BracketMatch) {
  const side1 = sideFor(bracket, match.side1Id);
  const side2 = sideFor(bracket, match.side2Id);
  if (side1?.isBye || side2?.isBye) return true;

  const hasMissingSide = !match.side1Id || !match.side2Id;
  if (!hasMissingSide) return false;

  // 首轮没有上游场次，缺少任意一方即为轮空。后续轮次在选手尚未晋级时也会
  // 暂时缺少一方，只有系统已经自动完赛/取消时才可确定为轮空或空场。
  const status = normalizeStatus(String(match.status));
  return match.roundNo <= 1 || status === 'COMPLETED' || status === 'CANCELLED';
}

type RoundInfo = Pick<BracketMatch, 'roundNo' | 'roundLabel'> & { round?: string };

export function roundTitle(match: RoundInfo) {
  // 后端 publicRoundLabel 把单字母轮次一律当组名，淘汰赛决赛（round = 'F'）会变成「F组」。
  // 小组赛场次 roundNo 恒为 0，所以 roundNo ≥ 1 的「F组」只可能是决赛。
  if (match.roundNo >= 1 && match.roundLabel === 'F组') return '决赛';
  return match.roundLabel || match.round || `第 ${match.roundNo} 轮`;
}

export type FinalStage = 'FINAL' | 'BRONZE';

/** 淘汰赛最后一轮的两场：决赛、季军赛（季军赛是决赛那一轮的第 2 场）。其他场次返回 null。 */
export function finalStage(match: RoundInfo): FinalStage | null {
  if (match.roundNo < 1) return null;
  const title = roundTitle(match);
  if (title === '决赛') return 'FINAL';
  if (title === '季军赛') return 'BRONZE';
  return null;
}

const PLACEMENT_FINAL_TITLES: Record<number, string> = {
  1: '冠亚军决赛',
  3: '三四名决赛',
  5: '五六名决赛',
  7: '七八名决赛',
};

/** 赛事大屏只给直接决定名次的场次加轮次标题。 */
export function placementFinalTitle(round?: string | null, roundNo?: number | null): string | null {
  const title = round?.trim();
  if (!title || roundNo === 0) return null;
  if (title === 'F') return (roundNo ?? 0) > 0 ? PLACEMENT_FINAL_TITLES[1] : null;
  if (title === '决赛') return PLACEMENT_FINAL_TITLES[1];
  if (title === 'BRONZE' || title === '季军赛') return PLACEMENT_FINAL_TITLES[3];
  if (Object.values(PLACEMENT_FINAL_TITLES).includes(title)) return title;

  // 交叉排位赛用 P 加较高的名次编号，例如 P5 决定第 5、6 名。
  const placement = /^P([1-9]\d*)$/.exec(title);
  if (!placement) return null;
  const rank = Number(placement[1]);
  return PLACEMENT_FINAL_TITLES[rank] ?? `${rank}-${rank + 1}名决赛`;
}

function scheduleTime(value?: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

type FinalPairMatch = RoundInfo & { scheduledAt?: string | null };

/**
 * 季军赛和决赛谁在前：一般季军赛在前、决赛压轴；按时间先后排开时按时间——
 * 季军赛排得比决赛晚（或决赛排了时间、季军赛还没排）就决赛在前。
 */
export function bronzeGoesFirst(bronze: FinalPairMatch, final: FinalPairMatch) {
  return scheduleTime(bronze.scheduledAt) <= scheduleTime(final.scheduledAt);
}

/**
 * 同一个项目的场次列表里，按 bronzeGoesFirst 对调决赛和季军赛的位置；其他场次位置不动。
 * 只传同一个项目的场次，或用 sameEvent 指明哪些场次属于同一个项目。
 */
export function orderFinalPair<T extends FinalPairMatch>(
  matches: T[],
  sameEvent: (a: T, b: T) => boolean = () => true,
): T[] {
  const result = [...matches];
  result.forEach((final, finalIndex) => {
    if (finalStage(final) !== 'FINAL') return;
    const bronzeIndex = result.findIndex((item) => finalStage(item) === 'BRONZE' && sameEvent(item, final));
    if (bronzeIndex < 0) return;
    const bronzeFirst = bronzeGoesFirst(result[bronzeIndex], final);
    if ((bronzeIndex < finalIndex) === bronzeFirst) return;
    [result[finalIndex], result[bronzeIndex]] = [result[bronzeIndex], result[finalIndex]];
  });
  return result;
}
