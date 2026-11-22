import { roundCn } from './round';
import { TEAM_GROUP_KNOCKOUT_2023, TEAM_GROUP_KNOCKOUT_2023_LABEL } from './team-competition-format';
import { teamScoringSummary, type TeamStageRules } from './team-stage-scoring';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export type TeamBoardGame = { gameNo: number; side1Score: number; side2Score: number; winnerSide: number | null };

export type TeamBoardChild = {
  id: string;
  matchNo: number;
  eventType: string | null;
  label: string;
  status: string;
  /** 胜负确定后补打的子项，不计正式比分。 */
  isSupplemental: boolean;
  /** 名单锁定或开赛后才有，之前为空数组。 */
  side1Players: string[];
  side2Players: string[];
  winnerSide: number | null;
  forfeitedSide: number | null;
  scheduledAt: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  matchPaused?: boolean;
  venueName: string | null;
  games: TeamBoardGame[];
};

export type TeamBoardTeam = { id: string; name: string; affiliation: string };

export type TeamBoardEncounter = {
  id: string;
  stage: string | null;
  groupId: string | null;
  round: string;
  roundNo: number;
  matchNo: number;
  status: string;
  team1: TeamBoardTeam | null;
  team2: TeamBoardTeam | null;
  team1Wins: number;
  team2Wins: number;
  winnerTeamId: string | null;
  resultDecided: boolean;
  scheduledAt: string | null;
  venueName: string | null;
  children: TeamBoardChild[];
};

export type TeamBoardStanding = {
  teamId: string;
  teamName: string;
  affiliation: string;
  rank: number | null;
  wins: number;
  losses: number;
  matchesWon: number;
  matchesLost: number;
  netMatches: number;
  advanced: boolean;
};

export type TeamBoardGroup = { id: string; groupNo: number; groupName: string; standings: TeamBoardStanding[] };

export type TeamBoardCompetition = {
  id: string;
  tournamentId: string;
  name: string;
  description: string | null;
  timeZone?: string;
  entrantTypeLabel: string;
  format: string;
  groupCount: number | null;
  advancePerGroup: number | null;
  winThreshold: number;
  playAllMatches: boolean;
  thirdPlaceMode: string;
  scoringRule: string;
  customGamePoint: number | null;
  customGameCap: number | null;
  customGamesToWin: number | null;
  /** 「小组赛 + 淘汰赛」赛制下分阶段的子项计分，未设置时为 null。 */
  stageScoringRules?: TeamStageRules | null;
  items: Array<{ id: string; eventType: string; label: string }>;
  teamCount: number;
  teams?: Array<TeamBoardTeam & { memberCount: number }>;
  groups: TeamBoardGroup[];
  encounters: TeamBoardEncounter[];
};

/** 前台对阵表里一个赛事的全部已公开团体赛。 */
export async function fetchTeamBoard(tournamentId: string): Promise<TeamBoardCompetition[]> {
  const res = await fetch(`${API_BASE}/public/team-board?tournamentId=${encodeURIComponent(tournamentId)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`获取团体赛对阵失败（${res.status}）`);
  const data = (await res.json()) as { teamCompetitions?: TeamBoardCompetition[] };
  return data.teamCompetitions ?? [];
}

const FORMAT_LABELS: Record<string, string> = {
  GROUP_ROUND_ROBIN: '小组赛',
  GROUP_PLUS_KNOCKOUT: '小组赛 + 淘汰赛',
  [TEAM_GROUP_KNOCKOUT_2023]: TEAM_GROUP_KNOCKOUT_2023_LABEL,
  SINGLE_ELIMINATION: '淘汰赛',
  ROUND_ROBIN: '单组循环',
};

export const teamFormatText = (format: string) => FORMAT_LABELS[format] ?? format;

/** 子项计分：如「21 分 3 局 2 胜」「11 分 1 局」；分阶段时为「小组赛 21 分 1 局，淘汰赛 15 分 3 局 2 胜」。 */
export function teamScoringText(competition: Pick<TeamBoardCompetition, 'scoringRule' | 'customGamePoint' | 'customGamesToWin' | 'stageScoringRules'>) {
  return teamScoringSummary(competition);
}

/** 团体对阵的轮次：小组赛直接用后台的「A组第1轮」，淘汰赛换成中文轮次名。 */
export function teamRoundText(encounter: Pick<TeamBoardEncounter, 'stage' | 'round'>) {
  return encounter.stage === 'GROUP' ? encounter.round : roundCn(encounter.round);
}

/** 使用赛事设置的时区，服务端渲染和浏览器结果一致。 */
export function teamTimeText(value: string | null, timeZone = 'Asia/Shanghai') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}
