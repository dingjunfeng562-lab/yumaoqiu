import { BadRequestException } from '@nestjs/common';

export type TeamRosterRules = { malePlayerCount?: number | null; femalePlayerCount?: number | null };

export function validateTeamRosterRules(rules: TeamRosterRules) {
  const { malePlayerCount: male, femalePlayerCount: female } = rules;
  if (male == null || female == null || !Number.isInteger(male) || !Number.isInteger(female) || male < 0 || female < 0 || male + female < 1) {
    throw new BadRequestException('请设置团体赛男、女人数，总人数至少为 1 人');
  }
  return { male, female, total: male + female };
}

export function validateTeamRoster(rules: TeamRosterRules, players: Array<{ gender: string }>) {
  const { male, female, total } = validateTeamRosterRules(rules);
  if (players.length !== total || players.filter(p => p.gender === 'MALE').length !== male || players.filter(p => p.gender === 'FEMALE').length !== female) {
    throw new BadRequestException(`每队须有 ${total} 人（${male} 男 ${female} 女），请调整队员名单`);
  }
}
