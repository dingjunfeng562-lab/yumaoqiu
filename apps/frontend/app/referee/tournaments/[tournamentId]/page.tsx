import TournamentCourts from '@/components/referee/TournamentCourts';

export default async function RefereeTournamentPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;
  return <TournamentCourts key={tournamentId} tournamentId={tournamentId} />;
}
