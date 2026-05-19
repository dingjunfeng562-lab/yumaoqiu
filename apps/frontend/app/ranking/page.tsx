import Link from 'next/link';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

export default function RankingPage() {
  return (
    <PortalFeaturePage
      activeHref="/ranking"
      eyebrow="Ranking"
      title="成绩排行"
      description="查看各单项的胜负统计、名次和最终成绩。"
    >
      <div className="rounded-lg border border-blue-100 bg-white p-8 shadow-sm">
        <h2 className="text-xl font-black">成绩随比赛进程更新</h2>
        <p className="mt-2 text-sm font-semibold text-slate-500">
          裁判完成记分后，排名和成绩数据会逐步沉淀到公开页。
        </p>
        <Link href="/history" className="mt-5 inline-flex h-11 items-center rounded-lg bg-blue-600 px-5 text-sm font-black text-white">
          查看历届数据
        </Link>
      </div>
    </PortalFeaturePage>
  );
}
