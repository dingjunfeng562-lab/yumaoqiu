export const PLACEMENT_SEMIFINAL = '5-8名半决赛';
export const FIFTH_PLACE_FINAL = '五六名决赛';
export const SEVENTH_PLACE_FINAL = '七八名决赛';
export const KNOCKOUT_WALKOVER = '轮空（对手签位空缺）';

export function isKnockoutWalkover(match: { forfeitReason?: string | null }): boolean {
  return match.forfeitReason === KNOCKOUT_WALKOVER;
}

type Position = { round: string; roundNo: number; matchNo: number };
type Source = Position & { outcome: 'winner' | 'loser'; label: string };

export function isKnockoutPlacementPlayoff(round: unknown): boolean {
  return round === PLACEMENT_SEMIFINAL || round === FIFTH_PLACE_FINAL || round === SEVENTH_PLACE_FINAL;
}

export function knockoutPlacementPlayoff(quarterfinalRound: number) {
  const quarterfinal = (matchNo: number): Source => ({
    round: 'QF', roundNo: quarterfinalRound, matchNo, outcome: 'loser', label: `1/4决赛第${matchNo}场负者`,
  });
  const semifinal = (matchNo: number, outcome: Source['outcome']): Source => ({
    round: PLACEMENT_SEMIFINAL, roundNo: quarterfinalRound + 1, matchNo, outcome,
    label: `排位半决赛第${matchNo - 2}场${outcome === 'winner' ? '胜者' : '负者'}`,
  });
  return [
    { round: PLACEMENT_SEMIFINAL, roundNo: quarterfinalRound + 1, matchNo: 3, number: 9, sources: [quarterfinal(1), quarterfinal(2)] },
    { round: PLACEMENT_SEMIFINAL, roundNo: quarterfinalRound + 1, matchNo: 4, number: 10, sources: [quarterfinal(3), quarterfinal(4)] },
    { round: FIFTH_PLACE_FINAL, roundNo: quarterfinalRound + 2, matchNo: 3, number: 11, sources: [semifinal(3, 'winner'), semifinal(4, 'winner')] },
    { round: SEVENTH_PLACE_FINAL, roundNo: quarterfinalRound + 2, matchNo: 4, number: 12, sources: [semifinal(3, 'loser'), semifinal(4, 'loser')] },
  ];
}

export function knockoutPlacementSources(match: Position): Source[] {
  if (!isKnockoutPlacementPlayoff(match.round)) return [];
  const quarterfinalRound = match.roundNo - (match.round === PLACEMENT_SEMIFINAL ? 1 : 2);
  return knockoutPlacementPlayoff(quarterfinalRound).find(row => row.round === match.round && row.matchNo === match.matchNo)?.sources ?? [];
}

export function knockoutPlacementTargets(match: Position) {
  if (match.round !== 'QF' && match.round !== PLACEMENT_SEMIFINAL) return [];
  const quarterfinalRound = match.roundNo - (match.round === 'QF' ? 0 : 1);
  return knockoutPlacementPlayoff(quarterfinalRound).flatMap(({ round, roundNo, matchNo, sources }) => {
    const index = sources.findIndex(source => source.round === match.round && source.matchNo === match.matchNo);
    if (index < 0) return [];
    const side = index === 0 ? 'side1Id' : 'side2Id';
    return [{ round, roundNo, matchNo, side, outcome: sources[index].outcome }] as const;
  });
}
