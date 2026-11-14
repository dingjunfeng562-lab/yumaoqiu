import type { Metadata } from 'next';
import { CheckInBoard } from '@/components/check-in/CheckInBoard';

export const metadata: Metadata = { title: '赛事对阵 | 羽动云赛' };

export default async function MatchCheckInPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params;
  return <CheckInBoard tournamentId={tournamentId} />;
}
