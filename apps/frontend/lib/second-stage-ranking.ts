export const SECOND_STAGE_MAX_RANK = 8;

export function compactGroupRankLabel(label: string) {
  return label.replace(/^([A-Z]+)组第([1-9]\d*)名$/, '$1$2');
}

export function secondStageRankingLimit(data?: { rankingLimit?: number | null; rankingMode?: string | null }) {
  return data?.rankingLimit ?? (data?.rankingMode === 'TOP_6' ? 6 : SECOND_STAGE_MAX_RANK);
}

export function includesSecondStageMatch(matchNo: number, rankLimit: number) {
  if (matchNo === 8) return rankLimit >= 3;
  if (matchNo >= 9 && matchNo <= 11) return rankLimit >= 5;
  if (matchNo === 12) return rankLimit >= 7;
  return true;
}
