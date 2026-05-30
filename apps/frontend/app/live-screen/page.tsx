import { getBracketList } from '@/app/bracket/data';
import { LiveScreenClient } from '@/components/screen/LiveScreenClient';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

async function getCurrentTournamentId() {
  try {
    const res = await fetch(`${API_BASE}/public/screen`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { competition?: { id?: string | null } | null };
    return data.competition?.id ?? null;
  } catch {
    return null;
  }
}

export default async function LiveScreenPage() {
  const [brackets, currentTournamentId] = await Promise.all([
    getBracketList(),
    getCurrentTournamentId(),
  ]);

  return <LiveScreenClient initialBrackets={brackets} initialTournamentId={currentTournamentId} />;
}
