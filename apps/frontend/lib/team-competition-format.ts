export const TEAM_GROUP_KNOCKOUT_2023 = 'GROUP_PLUS_KNOCKOUT_STD';
export const TEAM_GROUP_KNOCKOUT_2023_LABEL = '小组循环赛-淘汰赛2023';

export function isTeamGroupKnockout(format?: string | null) {
  return format === 'GROUP_PLUS_KNOCKOUT' || format === TEAM_GROUP_KNOCKOUT_2023;
}
