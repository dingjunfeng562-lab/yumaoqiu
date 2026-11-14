// key：选手指纹，只有工作人员接口返回，签到时用来核对对阵没变。
export type CheckInSide = { key?: string; name: string; teamName: string | null; complete: boolean; checkedAt: string | null };
export type CheckInMatch = {
  id: string; matchNo: number; round: string; roundNo: number; eventId: string; eventType: string;
  venueId: string | null; scheduledAt: string | null;
  status: 'PENDING' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  forfeitedSide: number | null; winnerSide: number | null;
  side1: CheckInSide; side2: CheckInSide; canCheckIn: boolean;
  games: Array<{ gameNo: number; side1Score: number; side2Score: number; winnerSide: number | null }>;
};
export type CheckInBoardData = {
  tournament: { id: string; name: string; startDate: string | null; endDate: string | null; publicAvailable: boolean };
  venues: Array<{ id: string; name: string; isActive: boolean }>;
  matches: CheckInMatch[];
  generatedAt: string;
};

export const EVENT_LABELS: Record<string, string> = {
  MENS_SINGLES: '男单', WOMENS_SINGLES: '女单', MENS_DOUBLES: '男双', WOMENS_DOUBLES: '女双', MIXED_DOUBLES: '混双',
};

// Dates are always interpreted in the competition's China timezone, including overseas viewers.
export function dateKey(value: string | Date) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export function clock(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
export function matchState(match: CheckInMatch) {
  if (match.forfeitedSide === 0) return { key: 'forfeit', label: '双方弃权' };
  if (match.forfeitedSide) return { key: 'forfeit', label: `${match.forfeitedSide === 1 ? '甲' : '乙'}方弃权` };
  if (match.status === 'CANCELLED') return { key: 'waiting', label: '已取消' };
  if (match.status === 'COMPLETED') return { key: 'finished', label: !match.side1.complete || !match.side2.complete ? '轮空 / 已结束' : '已结束' };
  if (match.status === 'LIVE') return { key: 'live', label: '比赛中' };
  if (!match.side1.complete || !match.side2.complete) return { key: 'waiting', label: '选手待定' };
  if (match.side1.checkedAt && match.side2.checkedAt) return { key: 'ready', label: '双方到齐' };
  if (match.side1.checkedAt || match.side2.checkedAt) return { key: 'partial', label: match.side1.checkedAt ? '等待乙方签到' : '等待甲方签到' };
  return { key: 'waiting', label: '未签到' };
}
export function matchScore(match: CheckInMatch) {
  if (match.forfeitedSide === 0) return '本场作废';
  if (match.forfeitedSide) return match.winnerSide ? `${match.winnerSide === 1 ? '甲' : '乙'}方获胜` : '弃权结束';
  if (match.status === 'COMPLETED' && match.games.length) {
    return `${match.games.filter((g) => g.winnerSide === 1).length} : ${match.games.filter((g) => g.winnerSide === 2).length}`;
  }
  if (match.status === 'LIVE') {
    const game = match.games.find((g) => !g.winnerSide) ?? match.games[match.games.length - 1];
    return game ? `${game.side1Score} : ${game.side2Score}` : '0 : 0';
  }
  return '';
}
