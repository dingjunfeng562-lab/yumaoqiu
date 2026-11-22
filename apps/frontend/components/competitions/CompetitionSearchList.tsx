'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { matchesSearch } from '@/lib/search-text';
import { HighlightText, SearchBox, replaceSearchParam } from './SearchBox';
import { formatDateTime, normalizeCover, type PublicCompetition } from './types';

const REGISTRATION_OPEN = 'REGISTRATION_OPEN';
const REGISTRATION_NOT_STARTED = 'REGISTRATION_NOT_STARTED';

type CompetitionPhase = {
  label: string;
  badgeClass: string;
  timeLabel: string;
  timeField: 'registrationStartTime' | 'registrationEndTime' | 'startDate' | 'endDate';
};

const COMPETITION_PHASES: Partial<Record<string, CompetitionPhase>> = {
  [REGISTRATION_NOT_STARTED]: { label: '即将报名', badgeClass: 'bg-blue-700 text-white', timeLabel: '报名开始', timeField: 'registrationStartTime' },
  [REGISTRATION_OPEN]: { label: '报名中', badgeClass: 'bg-emerald-700 text-white', timeLabel: '报名截止', timeField: 'registrationEndTime' },
  REGISTRATION_CLOSED: { label: '报名已截止', badgeClass: 'bg-slate-100 text-slate-800', timeLabel: '比赛开始', timeField: 'startDate' },
  ONGOING: { label: '比赛中', badgeClass: 'bg-violet-700 text-white', timeLabel: '预计结束', timeField: 'endDate' },
  FINISHED: { label: '已完赛', badgeClass: 'bg-slate-800 text-white', timeLabel: '比赛结束', timeField: 'endDate' },
};
const DEFAULT_PHASE: CompetitionPhase = {
  label: '状态待定',
  badgeClass: 'bg-slate-100 text-slate-800',
  timeLabel: '比赛开始',
  timeField: 'startDate',
};

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

function CompetitionCard({ competition, query }: { competition: PublicCompetition; query: string }) {
  const phase = COMPETITION_PHASES[competition.status ?? ''] ?? DEFAULT_PHASE;
  const needsReview = competition.needsRegistrationReview
    && (competition.status === REGISTRATION_OPEN || competition.status === REGISTRATION_NOT_STARTED);
  return (
    <article className="group overflow-hidden rounded-lg border border-blue-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
      <Link href={`/competitions/${competition.id}`} className="block">
        <div
          className="relative aspect-[16/9] bg-cover bg-center"
          style={{ backgroundImage: `url("${normalizeCover(competition.coverImage)}")` }}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#02133b]/85 via-[#02133b]/35 to-transparent" />
          <span className={`pointer-events-none absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-black shadow-sm ${phase.badgeClass}`}>
            {phase.label}
          </span>
          <div className="pointer-events-none absolute bottom-4 left-4 right-4">
            <h2 className="line-clamp-2 text-xl font-black text-white">
              <HighlightText
                text={competition.title}
                query={query}
                markClassName="rounded-sm bg-amber-300 px-0.5 text-slate-900"
              />
            </h2>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <dl className="flex flex-wrap gap-x-2 text-xs font-semibold text-blue-50/90">
                  <dt className="text-white/80">{phase.timeLabel}</dt>
                  <dd className="tabular-nums">{formatDateTime(competition[phase.timeField])}</dd>
                </dl>
                {needsReview ? <p className="text-[11px] font-semibold text-blue-50/85">报名需审核</p> : null}
              </div>
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
