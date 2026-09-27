type MatchResult = {
  status: string; round: string; roundNo: number;
  side1Id: string | null; side2Id: string | null; winnerSide: number | null;
};
type EventResults = {
  format: string;
  registrations: Array<{ id: string }>;
  matches: MatchResult[];
  secondStage?: {
    matches: Array<{ status: string }>;
    rankings: Array<{ rank: number; entrantId: string | null }>;
  } | null;
};
type TeamResults = {
  teams: Array<{ id: string }>;
  teamMatches: Array<{ status: string; round: string; winnerTeamId: string | null }>;
};

const terminal = (match: { status: string }) => match.status === 'COMPLETED' || match.status === 'CANCELLED';
const hasWinner = (match: MatchResult) => match.status === 'COMPLETED'
  && Boolean(match.winnerSide === 1 ? match.side1Id : match.winnerSide === 2 ? match.side2Id : null);

export function eventResultsReady(event: EventResults): boolean {
  if (!event.matches.length || !event.matches.every(terminal) || !event.matches.some(hasWinner)) return false;
  if (event.matches.some((match) => match.status === 'COMPLETED' && (match.side1Id || match.side2Id) && !hasWinner(match))) return false;
  if (event.secondStage) {
    return event.secondStage.matches.length > 0 && event.secondStage.matches.every(terminal)
      && event.secondStage.rankings.some((ranking) => ranking.rank === 1 && ranking.entrantId);
  }
  if (event.format === 'SINGLE_ELIMINATION_PLUS_GROUP_RANKING') return false;
  if (event.format === 'ROUND_ROBIN') return true;
  if (event.format === 'GROUP_PLUS_PLAYOFF') {
    return event.matches.some((match) => match.round === 'P1' && hasWinner(match));
  }
  // Group stages alone do not establish final knockout results.
  return event.matches.some((match) => match.round === 'F' && hasWinner(match));
}

export function tournamentResultsReady(tournament: {
  status: string; events: EventResults[]; teamCompetitions: TeamResults[];
}): boolean {
  const events = tournament.events.filter((event) => event.registrations.length || event.matches.length);
  const teams = tournament.teamCompetitions.filter((competition) => competition.teams.length || competition.teamMatches.length);
  const hasMatches = events.some((event) => event.matches.length) || teams.some((competition) => competition.teamMatches.length);
  // Keep explicitly finalized, manually entered historical results available.
  if (!hasMatches) return tournament.status === 'FINISHED';
  return events.every(eventResultsReady) && teams.every((competition) =>
    competition.teamMatches.length > 0 && competition.teamMatches.every(terminal)
    && competition.teamMatches.some((match) => match.round === 'F' && match.status === 'COMPLETED' && match.winnerTeamId),
  );
}
