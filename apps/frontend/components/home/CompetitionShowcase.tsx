import Image from 'next/image';
import Link from 'next/link';
import type { PlatformCompetition } from './types';
import { announcementPlainText } from '@/lib/announcement-html';

const statusClass: Record<string, string> = {
  报名中: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  即将开始: 'bg-blue-100 text-blue-700 ring-blue-200',
  进行中: 'bg-orange-100 text-orange-700 ring-orange-200',
  已结束: 'bg-slate-100 text-slate-600 ring-slate-200',
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function formatSummary(competition: PlatformCompetition) {
  if (competition.formatText?.trim()) return competition.formatText.trim();
  const hasTeam = (competition.teamCompetitionCount ?? 0) > 0;
  const projectText = competition.projects.length ? competition.projects.join(' / ') : '项目待公布';
  return hasTeam ? `单项赛 + 团体赛 · ${projectText}` : `单项赛 · ${projectText}`;
}

function introSummary(competition: PlatformCompetition) {
  const text = announcementPlainText(competition.description ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  return '查看比赛项目、报名状态与参赛选手。';
}

export function CompetitionShowcase({ competitions }: { competitions: PlatformCompetition[] }) {
  return (
    <section id="competitions" className="bg-[#f5f8ff] px-6 py-12 text-slate-950 lg:px-8">
      <div className="mx-auto max-w-[1440px] space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Competition Entry</p>
            <h2 className="mt-2 text-3xl font-black md:text-4xl">赛事列表</h2>
            <p className="mt-3 text-sm font-semibold text-slate-500">
              查看当前公开赛事、比赛形式、报名项目与参赛入口。
            </p>
          </div>
          <Link
            href="/competitions"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-black text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)] transition duration-300 hover:-translate-y-0.5 hover:bg-blue-700"
          >
            查看全部赛事
          </Link>
        </div>

        {competitions.length ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {competitions.map((competition) => (
              <article
                key={competition.id}
                className="group relative overflow-hidden rounded-lg border border-blue-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <Link
                  href={`/competitions/${competition.id}`}
                  aria-label={`查看 ${competition.title} 赛事详情`}
                  className="absolute inset-0 z-10 block rounded-lg"
                />
                <div
                  className="relative aspect-[16/9] overflow-hidden bg-cover bg-center"
                  style={{ backgroundImage: `url("${competition.cover}")` }}
                >
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#02133b]/82 via-[#02133b]/22 to-transparent" />
                  <span className={`pointer-events-none absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-black ring-1 ${statusClass[competition.status] ?? 'bg-white/90 text-blue-700 ring-blue-100'}`}>
                    {competition.status}
                  </span>
                  <div className="pointer-events-none absolute bottom-4 left-4 right-4">
                    <h3 className="line-clamp-2 text-xl font-black leading-snug text-white drop-shadow">
                      {competition.title}
                    </h3>
                    {competition.subtitle ? (
                      <p className="mt-1 line-clamp-1 text-xs font-semibold text-blue-50/85">{competition.subtitle}</p>
                    ) : null}
                  </div>
                </div>

                <div className="relative z-0 space-y-4 p-5">
                  <div className="rounded-lg border border-blue-50 bg-blue-50/60 p-4">
                    <p className="text-xs font-black text-blue-700">比赛形式简介</p>
                    <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-slate-700">
                      {formatSummary(competition)}
                    </p>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                      {introSummary(competition)}
                    </p>
                  </div>

                  <div className="space-y-3 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <Image src="/generated/icon-calendar.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {formatDate(competition.startDate)} - {formatDate(competition.endDate)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Image src="/generated/icon-location.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{competition.location}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Image src="/generated/icon-trophy.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{competition.projects.join(' / ') || '项目待公布'}</span>
                    </div>
                  </div>

                  <div className="relative z-20 grid grid-cols-2 gap-3 border-t border-blue-50 pt-4">
                    <Link
                      href={`/competitions/${competition.id}/players`}
                      className="inline-flex h-10 items-center justify-center rounded-lg border border-blue-200 text-sm font-black text-blue-700 transition duration-300 hover:border-blue-500 hover:bg-blue-50"
                    >
                      查看报名人数
                    </Link>
                    <Link
                      href={`/competitions/${competition.id}/register`}
                      className="inline-flex h-10 items-center justify-center rounded-lg bg-gradient-to-r from-orange-400 to-amber-300 text-sm font-black text-white shadow-[0_8px_18px_rgba(245,158,11,0.28)] transition duration-300 hover:scale-[1.02]"
                    >
                      立即报名
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-blue-100 bg-white p-8 text-center shadow-sm">
            <Image src="/generated/icon-trophy.svg" alt="" width={56} height={56} className="mx-auto h-14 w-14" />
            <h3 className="mt-4 text-xl font-black text-slate-950">暂无公开赛事</h3>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              后台创建并公开赛事后，会显示在这里。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
