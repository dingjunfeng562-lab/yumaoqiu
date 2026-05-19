import Image from 'next/image';
import Link from 'next/link';
import type { PlatformCompetition, PlatformCompetitionStatus } from './types';

const statusClass: Record<PlatformCompetitionStatus, string> = {
  报名中: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  即将开始: 'bg-blue-100 text-blue-700 ring-blue-200',
  进行中: 'bg-orange-100 text-orange-700 ring-orange-200',
  已结束: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export function CompetitionShowcase({ competitions }: { competitions: PlatformCompetition[] }) {
  return (
    <section id="competitions" className="bg-gradient-to-b from-[#eef6ff] via-white to-[#f7fbff] px-6 py-12 text-slate-950 lg:px-8">
      <div className="mx-auto max-w-[1440px] space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Competition Entry</p>
            <h2 className="mt-2 text-3xl font-black md:text-4xl">推荐赛事</h2>
            <p className="mt-3 text-sm font-semibold text-slate-500">
              赛事由后台创建并维护，封面、时间、地点、项目和状态会在这里动态展示。
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)] transition duration-300 hover:-translate-y-0.5 hover:bg-blue-700"
          >
            进入系统
          </Link>
        </div>

        {competitions.length ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {competitions.map((competition) => (
              <article
                key={competition.id}
                className="group overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <div
                  className="relative aspect-[16/9] overflow-hidden bg-cover bg-center"
                  style={{ backgroundImage: `url("${competition.cover}")` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-[#02133b]/78 via-[#02133b]/16 to-transparent" />
                  <span className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-black ring-1 ${statusClass[competition.status]}`}>
                    {competition.status}
                  </span>
                  <h3 className="absolute bottom-4 left-4 right-4 line-clamp-2 text-xl font-black leading-snug text-white drop-shadow">
                    {competition.title}
                  </h3>
                </div>

                <div className="space-y-4 p-5">
                  <div className="space-y-3 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <Image src="/generated/icon-calendar.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {competition.startDate}—{competition.endDate}
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

                  <div className="flex items-center gap-3 border-t border-blue-50 pt-4">
                    <Link
                      href={`/competitions/${competition.id}/register`}
                      className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-gradient-to-r from-orange-400 to-amber-300 text-sm font-black text-white shadow-[0_8px_18px_rgba(245,158,11,0.28)] transition duration-300 hover:scale-[1.02]"
                    >
                      立即报名
                    </Link>
                    <Link
                      href={`/competitions/${competition.id}`}
                      className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-blue-200 text-sm font-black text-blue-700 transition duration-300 hover:border-blue-500 hover:bg-blue-50"
                    >
                      查看详情
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-blue-100 bg-white/90 p-8 text-center shadow-sm">
            <Image src="/generated/icon-trophy.svg" alt="" width={56} height={56} className="mx-auto h-14 w-14" />
            <h3 className="mt-4 text-xl font-black text-slate-950">暂无推荐赛事</h3>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              后台创建比赛并上传封面图后，会自动展示在羽动云赛首页。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
