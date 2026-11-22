import { ScheduleBoardWorkspace } from '@/components/admin/ScheduleBoardWorkspace';
export const metadata = { title: '场地排程表 · 羽动云赛' };

export default async function CourtSchedulePage({ searchParams }: {
  searchParams: Promise<{ tournamentId?: string | string[] }>;
}) {
  const { tournamentId } = await searchParams;
  return <ScheduleBoardWorkspace requestedId={typeof tournamentId === 'string' ? tournamentId : ''} />;
}
