import Link from 'next/link';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import type { KnockoutBracketData } from '@/components/bracket/KnockoutBracket';
import { getBracketList } from './data';

export const dynamic = 'force-dynamic';

function statusCounts(bracket: KnockoutBracketData) {
  let live = 0;
  let done = 0;
  for (const match of bracket.matches) {
    const s = String(match.status || '').toUpperCase();
    if (s === 'LIVE' || match.status === '进行中') live += 1;
    else if (s === 'COMPLETED' || match.status === '已结束' || match.status === '已完成') done += 1;
  }
  return { total: bracket.matches.length, live, done };
}

export default async function BracketListPage() {
  const brackets = await getBracketList();

  return (
    <PortalFeaturePage
      activeHref="/bracket"
      eyebrow="对阵"
      title="淘汰赛对阵表"
      description="选择要查看的对阵表。点击卡片进入对阵表的专属页面，可查看完整签表、轮次详情、实时状态与选手晋级路径。"
    >
      <div className="space-y-5 sm:space-y-6">
        {brackets.length === 0 ? (
          <div className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
            <div className="flex flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-7">
              <div className="flex items-start gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#0a5dd1] to-[#03205c] text-white shadow-md">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                    <path strokeLinecap="round" d="M4 6h6v4H4zM4 14h6v4H4zM14 4h6v6h-6zM14 14h6v6h-6z" />
                    <path strokeLinecap="round" d="M10 8h4M10 16h4M17 10v4" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900 sm:text-xl">对阵表等待抽签生成</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    后台完成报名和抽签后，这里会自动列出可查看的对阵表。下方可查看签表样式预览。
                  </p>
                </div>
              </div>
              <Link
                href="/admin/draws"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-[#0a5dd1] px-5 text-sm font-black text-white shadow-sm transition hover:bg-[#0a4fb0]"
              >
                进入抽签后台 →
              </Link>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {/* Demo card is always present so the visual is browseable even with no data */}
          <BracketListCard
            href="/bracket/visual-demo"
            title="签表视觉预览"
            subtitle="32 签位 · 1/16 决赛至决赛 · 含轮空、种子、状态与路径高亮"
            tag="演示"
            tagTone="amber"
            stats={{ total: 10, live: 1, done: 4 }}
          />
          {brackets.map((bracket) => (
            <BracketListCard
              key={bracket.id}
              href={`/bracket/${encodeURIComponent(bracket.id)}`}
              title={bracket.title}
              subtitle={bracket.subtitle}
              tag={`${bracket.participants.length} 签位`}
              tagTone="blue"
              stats={statusCounts(bracket)}
            />
          ))}
        </div>
      </div>
    </PortalFeaturePage>
  );
}

function BracketListCard({
  href,
  title,
  subtitle,
  tag,
  tagTone,
  stats,
}: {
  href: string;
  title: string;
  subtitle?: string;
  tag: string;
  tagTone: 'amber' | 'blue';
  stats: { total: number; live: number; done: number };
}) {
  const tagClass =
    tagTone === 'amber'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-blue-50 text-blue-700';
  return (
    <Link
      href={href}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-blue-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#0a5dd1] hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#0a5dd1] to-[#03205c] text-white shadow-md">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path strokeLinecap="round" d="M4 6h6v4H4zM4 14h6v4H4zM14 4h6v6h-6zM14 14h6v6h-6z" />
            <path strokeLinecap="round" d="M10 8h4M10 16h4M17 10v4" />
          </svg>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${tagClass}`}>{tag}</span>
      </div>
      <h3 className="mt-3 line-clamp-2 text-base font-black text-slate-900">{title}</h3>
      {subtitle ? (
        <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-500">{subtitle}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[11px] font-black">
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          {stats.total} 场
        </span>
        {stats.live > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-red-700">
            <span className="bracket-live-pulse h-1.5 w-1.5 rounded-full bg-red-500" />
            {stats.live} 直播中
          </span>
        ) : null}
        {stats.done > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {stats.done} 已完成
          </span>
        ) : null}
      </div>

      <div className="mt-auto pt-4 text-right">
        <span className="text-xs font-black text-[#0a5dd1] group-hover:text-orange-500">
          查看对阵表 →
        </span>
      </div>
    </Link>
  );
}
