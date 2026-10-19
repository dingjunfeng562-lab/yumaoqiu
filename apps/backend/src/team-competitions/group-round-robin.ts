import { BadRequestException } from '@nestjs/common';

/**
 * 单循环赛编排算法（轮转法）
 * Round-Robin Tournament Generator using rotation method
 */

export interface TeamSlot {
  id: string | null;
  name: string;
}

export interface RoundRobinMatch {
  roundNo: number;
  matchNo: number;
  team1Id: string | null;
  team2Id: string | null;
}

export interface RoundRobinRound {
  roundNo: number;
  roundName: string;
  matches: RoundRobinMatch[];
}

/**
 * 生成单循环赛对阵
 * 算法：使用轮转法（固定一个队伍，其他队伍逆时针旋转）
 * 
 * @param teams 队伍列表
 * @returns 每轮的对阵
 * 
 * @example
 * // 4队示例
 * teams = [A, B, C, D]
 * 
 * 第1轮: A-D, B-C
 * 第2轮: A-C, D-B
 * 第3轮: A-B, C-D
 */
export function generateRoundRobin(teams: TeamSlot[]): RoundRobinRound[] {
  if (teams.length < 2) {
    throw new BadRequestException('至少需要2支队伍才能生成循环赛');
  }

  const n = teams.length;
  const rounds: RoundRobinRound[] = [];
  
  // 如果是奇数队伍，添加轮空槽位
  const participants = n % 2 === 0 
    ? [...teams] 
    : [...teams, { id: null, name: '轮空' }];
  
  const total = participants.length;
  const totalRounds = total - 1; // 总轮次
  
  for (let round = 0; round < totalRounds; round++) {
    const matches: RoundRobinMatch[] = [];
    
    for (let i = 0; i < total / 2; i++) {
      // 计算本轮对阵的队伍索引
      let home: number;
      let away: number;
      
      if (i === 0) {
        // 第一个位置固定为最后一个队伍
        home = total - 1;
        away = round;
      } else {
        // 其他位置使用轮转算法
        home = (round + i) % (total - 1);
        away = (total - 1 - i + round) % (total - 1);
      }
      
      const team1 = participants[home];
      const team2 = participants[away];
      
      // 跳过轮空对阵
      if (team1.id && team2.id) {
        matches.push({
          roundNo: round + 1,
          matchNo: matches.length + 1,
          team1Id: team1.id,
          team2Id: team2.id,
        });
      }
    }
    
    if (matches.length > 0) {
      rounds.push({
        roundNo: round + 1,
        roundName: `第${round + 1}轮`,
        matches,
      });
    }
  }
  
  return rounds;
}

/**
 * 将队伍分配到各组
 * 使用蛇形分配确保各组实力均衡
 * 
 * @param teams 队伍列表
 * @param groupCount 组数
 * @returns 分组结果
 * 
 * @example
 * // 8队分成2组
 * teams = [1, 2, 3, 4, 5, 6, 7, 8]
 * groupCount = 2
 * 
 * 结果：
 * A组: [1, 4, 5, 8]  // 蛇形分配
 * B组: [2, 3, 6, 7]
 */
export interface GroupDistribution {
  groupNo: number;
  groupName: string;
  teams: TeamSlot[];
}

export function distributeTeamsToGroups(
  teams: TeamSlot[],
  groupCount: number,
): GroupDistribution[] {
  if (groupCount < 1) {
    throw new BadRequestException('组数至少为1');
  }
  
  if (groupCount > teams.length) {
    throw new BadRequestException(`组数(${groupCount})不能超过队伍数(${teams.length})`);
  }
  
  const groups: GroupDistribution[] = [];
  
  // 初始化各组
  for (let i = 0; i < groupCount; i++) {
    groups.push({
      groupNo: i + 1,
      groupName: String.fromCharCode(65 + i) + '组', // A组, B组, C组...
      teams: [],
    });
  }
  
  // 蛇形分配队伍到各组
  let groupIndex = 0;
  let direction = 1; // 1: 正向, -1: 反向
  
  for (let i = 0; i < teams.length; i++) {
    groups[groupIndex].teams.push(teams[i]);
    
    // 到达边界时反转方向
    if (groupIndex === 0 && direction === -1) {
      direction = 1;
    } else if (groupIndex === groupCount - 1 && direction === 1) {
      direction = -1;
    } else {
      groupIndex += direction;
    }
  }
  
  return groups;
}

/**
 * 简单轮询分配（不使用蛇形）
 * 
 * @example
 * teams = [1, 2, 3, 4, 5, 6, 7, 8]
 * groupCount = 2
 * 
 * 结果：
 * A组: [1, 3, 5, 7]
 * B组: [2, 4, 6, 8]
 */
export function distributeTeamsRoundRobin(
  teams: TeamSlot[],
  groupCount: number,
): GroupDistribution[] {
  if (groupCount < 1) {
    throw new BadRequestException('组数至少为1');
  }
  
  const groups: GroupDistribution[] = [];
  
  // 初始化各组
  for (let i = 0; i < groupCount; i++) {
    groups.push({
      groupNo: i + 1,
      groupName: String.fromCharCode(65 + i) + '组',
      teams: [],
    });
  }
  
  // 轮询分配
  teams.forEach((team, index) => {
    const groupIndex = index % groupCount;
    groups[groupIndex].teams.push(team);
  });
  
  return groups;
}

/**
 * 验证循环赛对阵的完整性
 * 
 * @param teams 队伍列表
 * @param rounds 生成的对阵轮次
 * @returns 验证结果
 */
export function validateRoundRobin(
  teams: TeamSlot[],
  rounds: RoundRobinRound[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const n = teams.filter(t => t.id !== null).length;
  
  // 1. 验证轮次数量
  const expectedRounds = n % 2 === 0 ? n - 1 : n;
  if (rounds.length !== expectedRounds) {
    errors.push(`轮次数量错误：期望${expectedRounds}轮，实际${rounds.length}轮`);
  }
  
  // 2. 验证每支队伍的对阵数量
  const teamMatchCount = new Map<string, number>();
  for (const team of teams) {
    if (team.id) {
      teamMatchCount.set(team.id, 0);
    }
  }
  
  for (const round of rounds) {
    for (const match of round.matches) {
      if (match.team1Id) {
        teamMatchCount.set(match.team1Id, (teamMatchCount.get(match.team1Id) || 0) + 1);
      }
      if (match.team2Id) {
        teamMatchCount.set(match.team2Id, (teamMatchCount.get(match.team2Id) || 0) + 1);
      }
    }
  }
  
  for (const [teamId, count] of teamMatchCount) {
    if (count !== n - 1) {
      errors.push(`队伍${teamId}的对阵数量错误：期望${n - 1}场，实际${count}场`);
    }
  }
  
  // 3. 验证没有重复对阵
  const matchPairs = new Set<string>();
  for (const round of rounds) {
    for (const match of round.matches) {
      const pair = [match.team1Id, match.team2Id].sort().join('-');
      if (matchPairs.has(pair)) {
        errors.push(`重复对阵：${match.team1Id} vs ${match.team2Id}`);
      }
      matchPairs.add(pair);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
