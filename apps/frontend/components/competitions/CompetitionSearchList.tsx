'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { matchesSearch } from '@/lib/search-text';
import { HighlightText, SearchBox, replaceSearchParam } from './SearchBox';
import { formatDateTime, normalizeCover, type PublicCompetition } from './types';

// 赛事列表：顶部按赛事名即时筛选，搜索词同步到网址 ?q=。
export function CompetitionSearchList({
  competitions,
  initialQuery,
}: {
  competitions: PublicCompetition[];
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const keyword = query.trim();
  const visible = useMemo(
    () => competitions.filter((competition) => matchesSearch(competition.title, keyword)),
    [competitions, keyword],
  );

  const handleChange = (value: string) => {
    setQuery(value);
    replaceSearchParam('q', value);
  };

  if (!competitions.length) {
    return (
      <div className="rounded-lg border border-blue-100 bg-white p-10 text-center shadow-sm">
        <h2 className="text-xl font-black">暂无公开赛事</h2>
        <p className="mt-2 text-sm font-semibold text-slate-500">后台发布赛事后，会在这里展示。</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="sm:max-w-xl sm:flex-1">
          <SearchBox
            value={query}
            onChange={handleChange}
            label="搜索赛事"
            placeholder="输入赛事名称搜索…"
          />
        </div>
        <p className="px-1 text-xs font-semibold text-slate-500" aria-live="polite">
          {keyword ? `找到 ${visible.length} 个赛事` : `共 ${competitions.length} 个赛事`}
        </p>
      </div>

      {visible.length ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((competition) => (
            <CompetitionCard key={competition.id} competition={competition} query={keyword} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-blue-100 bg-white px-6 py-10 text-center shadow-sm">
          <h2 className="text-lg font-black text-slate-800">没有找到包含「{keyword}」的赛事</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">换个关键词试试，或者清空搜索查看全部赛事。</p>
          <button
            type="button"
            onClick={() => handleChange('')}
            className="tappable mt-5 inline-flex h-11 items-center justify-center rounded-lg border border-blue-200 px-5 text-sm font-black text-blue-700 transition hover:bg-blue-50"
          >
            清空搜索
          </button>
        </div>
      )}
    </div>
  );
}

// 列表里每个赛事只放封面图，图上显示赛事名、报名起止时间和是否需要审核；
// 整张卡片点进赛事主页（报名、选手名单、对阵、比分直播都在那里）。
function CompetitionCard({ competition, query }: { competition: PublicCompetition; query: string }) {
  const review = competition.needsRegistrationReview;
  return (
    <article className="group overflow-hidden rounded-lg border border-blue-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
      <Link href={`/competitions/${competition.id}`} className="block">
        <div
          className="relative aspect-[16/9] bg-cover bg-center"
          style={{ backgroundImage: `url("${normalizeCover(competition.coverImage)}")` }}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#02133b]/85 via-[#02133b]/35 to-transparent" />
          {typeof review === 'boolean' ? (
            <span
              className={`pointer-events-none absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-black text-white shadow-sm ${
                review ? 'bg-amber-400' : 'bg-emerald-500'
              }`}
            >
              {review ? '需审核' : '无需审核'}
            </span>
          ) : null}
          <div className="pointer-events-none absolute bottom-4 left-4 right-4">
            <h2 className="line-clamp-2 text-xl font-black text-white">
              <HighlightText
                text={competition.title}
                query={query}
                markClassName="rounded-sm bg-amber-300 px-0.5 text-slate-900"
              />
            </h2>
            <div className="mt-2 flex items-end justify-between gap-3">
              <dl className="min-w-0 space-y-1 text-xs font-semibold text-blue-50/90">
                <div className="flex gap-2">
                  <dt className="text-white/70">报名开始</dt>
                  <dd className="tabular-nums">{formatDateTime(competition.registrationStartTime)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-white/70">报名结束</dt>
                  <dd className="tabular-nums">{formatDateTime(competition.registrationEndTime)}</dd>
                </div>
              </dl>
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/25 bg-white/10 px-2.5 py-0.5 text-xs font-bold tabular-nums text-white"
                title="浏览次数"
                aria-label={`浏览 ${(competition.viewCount ?? 0).toLocaleString('zh-CN')} 次`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
                  <circle cx="12" cy="12" r="2.8" />
                </svg>
                {(competition.viewCount ?? 0).toLocaleString('zh-CN')}
              </span>
            </div>
          </div>
        </div>
      </Link>
    </article>
  );
}
