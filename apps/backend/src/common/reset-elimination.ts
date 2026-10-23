import { MatchStatus } from '@prisma/client';

type Slot = { id: string | null; resolved: boolean };
type Encounter = { id: string; round: string; roundNo: number; matchNo: number; side1Id: string | null; side2Id: string | null };

/** Restore the original first round, propagate only genuine byes, discard played winners. */
export function resetElimination(matches: Encounter[]) {
  const firstRound = Math.min(...matches.map(match => match.roundNo));
  const outcomes = new Map<string, Slot>();
  return [...matches].sort((a, b) => a.roundNo - b.roundNo || a.matchNo - b.matchNo).map(match => {
    const bronze = match.round === 'BRONZE';
    const side = (index: 1 | 2): Slot => match.roundNo === firstRound && !bronze
      ? { id: index === 1 ? match.side1Id : match.side2Id, resolved: true }
      : outcomes.get(`${match.roundNo - 1}:${match.matchNo * 2 - (index === 1 ? 1 : 0)}`) ?? { id: null, resolved: false };
    const a = bronze ? { id: null, resolved: false } : side(1);
    const b = bronze ? { id: null, resolved: false } : side(2);
    const bye = Boolean(a.id) && b.resolved && !b.id || Boolean(b.id) && a.resolved && !a.id;
    const empty = a.resolved && b.resolved && !a.id && !b.id;
    const winnerSide = bye ? (a.id ? 1 : 2) : null;
    outcomes.set(`${match.roundNo}:${match.matchNo}`, { id: bye ? a.id ?? b.id : null, resolved: bye || empty });
    return { id: match.id, side1Id: a.id, side2Id: b.id, winnerSide,
      status: bye || empty ? MatchStatus.COMPLETED : MatchStatus.PENDING };
  });
}
