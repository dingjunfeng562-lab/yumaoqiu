import { CompetitionShowcase } from './CompetitionShowcase';
import { FeatureEntrances } from './FeatureEntrances';
import { Header } from './Header';
import { HeroLanding } from './HeroLanding';
import type { PlatformCompetition } from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, '');

type LobbyResponse = {
  competitions?: Array<Omit<PlatformCompetition, 'cover'> & { cover?: string | null }>;
};

function normalizeCover(url?: string | null) {
  if (!url) return '/generated/competition-cover-1.png';
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('/api/')) return `${API_ORIGIN}${url}`;
  if (url.startsWith('/')) return url;
  return '/generated/competition-cover-1.png';
}

async function getCompetitions(): Promise<PlatformCompetition[]> {
  try {
    const res = await fetch(`${API_BASE}/public/lobby`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as LobbyResponse;
    return (data.competitions ?? []).map((competition) => ({
      ...competition,
      cover: normalizeCover(competition.cover),
    }));
  } catch {
    return [];
  }
}

export async function HomePage() {
  const competitions = await getCompetitions();

  return (
    <main className="animate-page-rise min-h-screen overflow-x-hidden bg-[#04163f] text-white">
      <Header />
      <HeroLanding />
      <CompetitionShowcase competitions={competitions} />
      <FeatureEntrances />
    </main>
  );
}
