import { BadRequestException } from '@nestjs/common';

/**
 * 小组积分排名算法
 * Group Stage Standings Calculator
 */

export interface TeamStanding {
  teamId: string;
  teamName: string;
  wins: number;           // 胜场数（团体赛维度）
  losses: number;         // 负场数（团体赛维度）
  matchesWon: number;     // 赢的子项数
  matchesLost: number;    // 输的子项数
  netMatches: number;     // 正式子项所有局的得分减失分，补打不计入
  groupRank: number;      // 小组排名
  advanced: boolean;      // 是否晋级
}

export interface HeadToHeadRecord {
  teamId: string;
  opponentId: string;
  wins: number;
  losses: number;
  matchesWon: number;
  matchesLost: number;
  netMatches: number;
}

/**
 * 计算小组排名
 * 排名规则（优先级从高到低）：
 * 1. 胜场数（团体赛维度）
 * 2. 胜次（正式子项获胜数）
 * 3. 正式子项逐局净胜分
 * 4. 同分队之间的相互战绩：两队同分即比较两队交手胜负；三队及以上同分时，
 *    只统计这几队相互之间的对阵，依次比较胜场、胜次、净胜分（小循环），避免甲胜乙、乙胜丙、丙胜甲时排序前后矛盾
 * 5. 总负次（正式子项失利数，少者列前）
 * 6. 仍相同时保持原顺序
 *
 * @param standings 小组积分数据
 * @param headToHeadRecords 相互战绩记录（可选）
 * @returns 排序后的积分榜
 */
export function calculateGroupStandings(
  standings: Omit<TeamStanding, 'groupRank' | 'advanced'>[],
  headToHeadRecords?: HeadToHeadRecord[],
): TeamStanding[] {
  if (standings.length === 0) {
    return [];
  }

  // 1-3：胜场、胜次、净胜分（均降序）
  const overall = (a: Omit<TeamStanding, 'groupRank' | 'advanced'>, b: Omit<TeamStanding, 'groupRank' | 'advanced'>) =>
    b.wins - a.wins || b.matchesWon - a.matchesWon || b.netMatches - a.netMatches;
  const sorted = [...standings].sort(overall);

  // 4-6：对 1-3 完全相同的一组队伍做小循环
  const ordered: typeof sorted = [];
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && overall(sorted[start], sorted[end]) === 0) end++;
    const tied = sorted.slice(start, end);
    if (tied.length > 1) {
      const mini = miniLeague(tied.map(team => team.teamId), headToHeadRecords ?? []);
      tied.sort((a, b) => {
        const x = mini.get(a.teamId)!, y = mini.get(b.teamId)!;
        return y.wins - x.wins || y.matchesWon - x.matchesWon || y.netMatches - x.netMatches
          || a.matchesLost - b.matchesLost;
      });
    }
    ordered.push(...tied);
    start = end;
  }

  // 分配排名
  return ordered.map((team, index) => ({
    ...team,
    groupRank: index + 1,
    advanced: false, // 晋级状态需要单独设置
  }));
}

/** 只统计 teamIds 这几队相互之间的对阵（两队时即两队交手战绩）。 */
function miniLeague(teamIds: string[], records: HeadToHeadRecord[]) {
  const ids = new Set(teamIds);
  const result = new Map(teamIds.map(teamId => [teamId, { wins: 0, matchesWon: 0, netMatches: 0 }]));
  for (const record of records) {
    if (!ids.has(record.teamId) || !ids.has(record.opponentId)) continue;
    const row = result.get(record.teamId)!;
    row.wins += record.wins;
    row.matchesWon += record.matchesWon;
    row.netMatches += record.netMatches;
  }
  return result;
}

/**
 * 标记晋级队伍
 * 
 * @param standings 已排序的积分榜
 * @param advanceCount 晋级数量
 * @returns 更新后的积分榜
 */
export function markAdvancedTeams(
  standings: TeamStanding[],
  advanceCount: number,
): TeamStanding[] {
  if (advanceCount <= 0 || advanceCount > standings.length) {
    throw new BadRequestException(
      `晋级数量(${advanceCount})必须在1到${standings.length}之间`,
    );
  }

  return standings.map(team => ({
    ...team,
    advanced: team.groupRank <= advanceCount,
  }));
}

/**
 * 更新队伍积分（单场比赛后）
 * 
 * @param currentStanding 当前积分
 * @param matchResult 比赛结果
 * @returns 更新后的积分
 */
export interface MatchResult {
  isWinner: boolean;      // 是否胜利
  matchesWon: number;     // 本场赢的子项数
  matchesLost: number;    // 本场输的子项数
  pointDiff: number;      // 正式子项逐局得分减失分
}

export function updateTeamStanding(
  currentStanding: Omit<TeamStanding, 'groupRank' | 'advanced'>,
  matchResult: MatchResult,
): Omit<TeamStanding, 'groupRank' | 'advanced'> {
  return {
    ...currentStanding,
    wins: currentStanding.wins + (matchResult.isWinner ? 1 : 0),
    losses: currentStanding.losses + (matchResult.isWinner ? 0 : 1),
    matchesWon: currentStanding.matchesWon + matchResult.matchesWon,
    matchesLost: currentStanding.matchesLost + matchResult.matchesLost,
    netMatches: currentStanding.netMatches + matchResult.pointDiff,
  };
}

/**
 * 计算多队相互战绩（用于3队或以上并列时）
 * 
 * @param teamIds 并列的队伍ID列表
 * @param allRecords 所有战绩记录
 * @returns 按相互战绩排序的队伍ID列表
 */
export function calculateMultiTeamHeadToHead(
  teamIds: string[],
  allRecords: HeadToHeadRecord[],
): string[] {
  // 筛选出只涉及这些队伍的战绩
  const relevantRecords = allRecords.filter(
    r => teamIds.includes(r.teamId) && teamIds.includes(r.opponentId),
  );

  // 计算每队在小循环中的战绩
  const miniStandings = teamIds.map(teamId => {
    const teamRecords = relevantRecords.filter(r => r.teamId === teamId);
    const wins = teamRecords.reduce((sum, r) => sum + r.wins, 0);
    const matchesWon = teamRecords.reduce((sum, r) => sum + r.matchesWon, 0);
    const netMatches = teamRecords.reduce((sum, r) => sum + r.netMatches, 0);

    return {
      teamId,
      wins,
      netMatches,
      matchesWon,
    };
  });

  // 按小循环战绩排序
  miniStandings.sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.matchesWon !== b.matchesWon) return b.matchesWon - a.matchesWon;
    return b.netMatches - a.netMatches;
  });

  return miniStandings.map(s => s.teamId);
}

/**
 * 验证积分数据的一致性
 * 
 * @param standings 积分榜
 * @returns 验证结果
 */
export function validateStandings(
  standings: TeamStanding[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const team of standings) {
    // 汇总表没有逐局原始分数，只能验证数值；净胜分不能由胜次减负次推导。
    if (!Number.isInteger(team.netMatches)) {
      errors.push(`队伍${team.teamName}的净胜分必须为整数`);
    }

    // 验证胜负场总和
    const totalMatches = team.wins + team.losses;
    if (totalMatches < 0) {
      errors.push(`队伍${team.teamName}的比赛场数为负数`);
    }

    // 验证排名在合理范围内
    if (team.groupRank < 1 || team.groupRank > standings.length) {
      errors.push(
        `队伍${team.teamName}的排名${team.groupRank}超出范围[1-${standings.length}]`,
      );
    }
  }

  // 验证排名连续且无重复
  const ranks = standings.map(s => s.groupRank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) {
      errors.push(`排名序列不连续：缺少第${i + 1}名`);
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 格式化积分榜为可读字符串（调试用）
 */
export function formatStandingsTable(standings: TeamStanding[]): string {
  const header = '排名\t队伍\t\t胜\t负\t净胜分\t赢局\t输局\t晋级';
  const separator = '-'.repeat(60);
  
  const rows = standings.map(team => {
    const advancedMark = team.advanced ? '✓' : '';
    return `${team.groupRank}\t${team.teamName}\t\t${team.wins}\t${team.losses}\t${team.netMatches >= 0 ? '+' : ''}${team.netMatches}\t${team.matchesWon}\t${team.matchesLost}\t${advancedMark}`;
  });

  return [header, separator, ...rows].join('\n');
}
