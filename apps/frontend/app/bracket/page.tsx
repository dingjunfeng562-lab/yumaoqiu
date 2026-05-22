import Link from 'next/link';
import { KnockoutBracket, type KnockoutBracketData } from '@/components/bracket/KnockoutBracket';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type TeamCompetition = {
  id: string;
  tournamentName: string;
  tournamentEdition: number;
  name: string;
  winThreshold: number;
  teams: Array<{ id: string; name: string; affiliation?: string | null }>;
  items: Array<{ id: string; eventTypeLabel: string }>;
  teamMatches: Array<{
    id: string;
    round: string;
    roundNo: number;
    matchNo: number;
    status: string;
    winnerTeamId?: string | null;
    winnerTeamName?: string | null;
    team1?: { id: string; name: string; affiliation?: string | null } | null;
    team2?: { id: string; name: string; affiliation?: string | null } | null;
    team1Wins: number;
    team2Wins: number;
    matches: Array<{
      id: string;
      eventTypeLabel?: string | null;
      gamesText: string;
      status: string;
      venueName?: string | null;
      scheduledAt?: string | null;
    }>;
  }>;
};

async function getPublicBrackets() {
  try {
    const res = await fetch(`${API_BASE}/public/brackets`, { cache: 'no-store' });
    if (!res.ok) return { brackets: [] as KnockoutBracketData[] };
    return res.json() as Promise<{ brackets: KnockoutBracketData[] }>;
  } catch {
    return { brackets: [] as KnockoutBracketData[] };
  }
}

async function getTeamCompetitions() {
  try {
    const res = await fetch(`${API_BASE}/public/team-competitions`, { cache: 'no-store' });
    if (!res.ok) return { teamCompetitions: [] as TeamCompetition[] };
    return res.json() as Promise<{ teamCompetitions: TeamCompetition[] }>;
  } catch {
    return { teamCompetitions: [] as TeamCompetition[] };
  }
}

function teamCompetitionToBracket(competition: TeamCompetition): KnockoutBracketData | null {
  const firstRound = competition.teamMatches
    .filter((match) => match.roundNo === 1)
    .sort((a, b) => a.matchNo - b.matchNo);

  const participants = firstRound.length
    ? firstRound.flatMap((match, index) => [
        match.team1
          ? {
              id: match.team1.id,
              position: index * 2 + 1,
              name: match.team1.name,
              affiliation: match.team1.affiliation,
            }
          : {
              id: `team-bye-${competition.id}-${index * 2 + 1}`,
              position: index * 2 + 1,
              name: '— 轮空 —',
              isBye: true,
            },
        match.team2
          ? {
              id: match.team2.id,
              position: index * 2 + 2,
              name: match.team2.name,
              affiliation: match.team2.affiliation,
            }
          : {
              id: `team-bye-${competition.id}-${index * 2 + 2}`,
              position: index * 2 + 2,
              name: '— 轮空 —',
              isBye: true,
            },
      ])
    : competition.teams.map((team, index) => ({
        id: team.id,
        position: index + 1,
        name: team.name,
        affiliation: team.affiliation,
      }));

  if (participants.length < 2) return null;

  return {
    id: competition.id,
    title: `${competition.tournamentName} · ${competition.name}`,
    subtitle: `第 ${competition.tournamentEdition} 届 · 团体淘汰赛 · 抢 ${competition.winThreshold} 胜`,
    participants,
    matches: competition.teamMatches.map((match) => ({
      id: match.id,
      roundNo: match.roundNo,
      roundLabel: match.round,
      matchNo: match.matchNo,
      status: match.status,
      side1Id: match.team1?.id ?? null,
      side2Id: match.team2?.id ?? null,
      winnerId: match.winnerTeamId ?? null,
      score: `${match.team1Wins}:${match.team2Wins}`,
      gamesText: `${match.team1Wins}:${match.team2Wins}`,
      venueName: match.matches.find((item) => item.venueName)?.venueName ?? '待排场地',
      scheduledAt: match.matches.find((item) => item.scheduledAt)?.scheduledAt ?? null,
      detailLines: match.matches.map(
        (item) => `${item.eventTypeLabel || '子场次'} · ${item.gamesText} · ${item.status}`,
      ),
    })),
  };
}

function demoBracket(): KnockoutBracketData {
  const names = [
    '彭 亮',
    '韦 文',
    '张三 / 李四',
    '王 皓',
    '陈 昊',
    '— 轮空 —',
    '林 可',
    '周 远',
    '赵 铭',
    '钱 宇',
    '孙 晨',
    '李 然',
    '吴 越',
    '郑 嘉',
    '冯 立',
    '陈 鹏',
    '褚 宁',
    '卫 航',
    '蒋 一',
    '沈 云',
    '韩 博',
    '杨 舟',
    '朱 旭',
    '秦 川',
    '尤 安',
    '许 诺',
    '何 平',
    '吕 诚',
    '施 远',
    '张 弛',
    '孔 明',
    '曹 斌',
  ];
  const seeds: Record<number, string> = {
    1: '1',
    16: '5/8',
    17: '3/4',
    32: '2',
  };

  return {
    id: 'visual-demo',
    title: '签表视觉预览',
    subtitle: '32 签位 · 1/16 决赛至决赛 · 含轮空、种子、状态与路径高亮',
    participants: names.map((name, index) => ({
      id: name === '— 轮空 —' ? `demo-bye-${index + 1}` : `demo-player-${index + 1}`,
      position: index + 1,
      name,
      seed: seeds[index + 1],
      isBye: name === '— 轮空 —',
    })),
    matches: [
      { id: 'demo-r1-1', roundNo: 1, matchNo: 1, status: 'COMPLETED', winnerSide: 1, score: '21:14', gamesText: '21:14 / 21:18' },
      { id: 'demo-r1-2', roundNo: 1, matchNo: 2, status: 'LIVE', score: '18:16', gamesText: '18:16' },
      { id: 'demo-r1-3', roundNo: 1, matchNo: 3, status: 'COMPLETED', winnerSide: 1, score: '轮空', gamesText: '轮空晋级' },
      { id: 'demo-r1-4', roundNo: 1, matchNo: 4, status: 'PENDING' },
      {
        id: 'demo-r1-5',
        roundNo: 1,
        matchNo: 5,
        status: 'COMPLETED',
        winnerSide: 1,
        forfeitedSide: 2,
        forfeitReason: '选手未到场弃权',
        score: 'WO',
        gamesText: '— 弃权 —',
      },
      { id: 'demo-r2-1', roundNo: 2, matchNo: 1, status: 'PENDING' },
      { id: 'demo-r3-1', roundNo: 3, matchNo: 1, status: 'PENDING' },
      { id: 'demo-r4-1', roundNo: 4, matchNo: 1, status: 'PENDING' },
      { id: 'demo-r5-1', roundNo: 5, matchNo: 1, status: 'PENDING' },
    ],
  };
}

export default async function BracketPage() {
  const [bracketData, teamData] = await Promise.all([getPublicBrackets(), getTeamCompetitions()]);
  const teamBrackets = teamData.teamCompetitions
    .map(teamCompetitionToBracket)
    .filter((item): item is KnockoutBracketData => Boolean(item));
  const brackets = [...bracketData.brackets, ...teamBrackets];

  return (
    <PortalFeaturePage
      activeHref="/bracket"
      eyebrow="Bracket"
      title="淘汰赛对阵表"
      description="横向展开的淘汰赛签表，支持查看轮次、比赛详情、实时状态与选手晋级路径。"
    >
      {brackets.length ? (
        <div className="space-y-5 sm:space-y-6">
          {brackets.map((bracket) => (
            <KnockoutBracket key={bracket.id} data={bracket} />
          ))}
        </div>
      ) : (
        <div className="space-y-5 sm:space-y-6">
          <div className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
            <div className="flex flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-7">
              <div className="flex items-start gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#0a5dd1] to-[#03205c] text-white shadow-md">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                    <path strokeLinecap="round" d="M4 6h6v4H4zM4 14h6v4H4zM14 4h6v6h-6zM14 14h6v6h-6z" />
                    <path strokeLinecap="round" d="M10 8h4M10 16h4M17 10v4" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900 sm:text-xl">对阵表等待抽签生成</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    后台完成报名和抽签后,这里会自动展示完整的淘汰赛签表与实时比分。下面是签表样式预览。
                  </p>
                </div>
              </div>
              <Link
                href="/admin/draws"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-[#0a5dd1] px-5 text-sm font-black text-white shadow-sm transition hover:bg-[#0a4fb0]"
              >
                进入抽签后台 →
              </Link>
            </div>
          </div>
          <KnockoutBracket data={demoBracket()} allowAdminSwap />
        </div>
      )}
    </PortalFeaturePage>
  );
}
