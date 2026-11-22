export function isTeamGroupKnockout(format?: string | null) {
  return format === 'GROUP_PLUS_KNOCKOUT' || format === 'GROUP_PLUS_KNOCKOUT_STD';
}
