import { TournamentScreen } from '@/components/screen/TournamentScreen';

export const metadata = { title: '赛事大屏 | 羽动云赛' };

export default async function TournamentScreenPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;
  return <TournamentScreen key={tournamentId} tournamentId={tournamentId} />;
}
