import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { RankingBrowser, type RankingOption } from '@/components/ranking/RankingBrowser';

export const dynamic = 'force-dynamic';
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export default async function RankingPage() {
  let tournaments: RankingOption[] = [];
  let loadError = false;
  try {
    const response = await fetch(`${API_BASE}/public/ranking`, { cache: 'no-store' });
    if (!response.ok) throw new Error('赛事加载失败');
    tournaments = (await response.json()).tournaments;
  } catch { loadError = true; }

  return <PortalFeaturePage activeHref="/ranking" eyebrow="Ranking" title="成绩排行"
    description="选择赛事，查看各项目的最终名次，也可以搜索选手或队伍名称。">
    <RankingBrowser tournaments={tournaments} loadError={loadError} />
  </PortalFeaturePage>;
}
