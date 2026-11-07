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

export function roundTitle(match: BracketMatch) {
  // 后端 publicRoundLabel 把单字母轮次一律当组名，淘汰赛决赛（round = 'F'）会变成「F组」。
  // 小组赛场次 roundNo 恒为 0，所以 roundNo ≥ 1 的「F组」只可能是决赛。
  if (match.roundNo >= 1 && match.roundLabel === 'F组') return '决赛';
  return match.roundLabel || (match as BracketMatch & { round?: string }).round || `第 ${match.roundNo} 轮`;
}
