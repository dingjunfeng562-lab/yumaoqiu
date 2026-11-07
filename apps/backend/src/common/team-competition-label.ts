/**
 * 团体赛不单独起名，挂在组别下：名称自动取「组别名团体赛」，组别改名时一起改。
 * 早期手填的名称（如「院系杯」）保留，显示时前面补上组别，避免出现「学生组团体赛 · 学生组团体赛」。
 */
export function defaultTeamCompetitionName(groupName: string) {
  return `${groupName.trim()}团体赛`;
}

export function teamCompetitionLabel(name: string, groupName?: string | null) {
  const trimmed = name.trim();
  if (trimmed.includes('团体赛')) return trimmed;
  return groupName?.trim() ? `${groupName.trim()}团体赛 · ${trimmed}` : `团体赛 · ${trimmed}`;
}
