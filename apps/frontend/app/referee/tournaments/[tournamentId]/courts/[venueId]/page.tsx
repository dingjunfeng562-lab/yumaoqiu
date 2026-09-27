import TournamentCourts from '@/components/referee/TournamentCourts';

export default async function CourtMatchesPage({ params }: { params: Promise<{ tournamentId: string; venueId: string }> }) {
  const { tournamentId, venueId } = await params;
  return <TournamentCourts key={`${tournamentId}:${venueId}`} tournamentId={tournamentId} initialCourt={venueId} />;
}
