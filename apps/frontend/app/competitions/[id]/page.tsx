import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, '');

type EventOption = {
  id: string;
  type: string;
  label: string;
  isDouble: boolean;
};

type CompetitionDetail = {
  id: string;
  title: string;
  subtitle?: string | null;
  coverImage?: string | null;
  startDate: string;
  endDate: string;
  location?: string | null;
  events?: string[];
  projects?: string[];
  eventOptions?: EventOption[];
  description?: string | null;
  registrationNotice?: string | null;
  maxRegistrationEvents?: number;
  allowCrossEventRegistration?: boolean;
  needsRegistrationReview?: boolean;
  statusLabel?: string;
  registrationStatus?: string;
  registrationStartTime?: string | null;
  registrationEndTime?: string | null;
  registeredCount?: number;
};

function normalizeCover(url?: string | null) {
  if (!url) return '/generated/competition-cover-1.png';
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('/api/')) return `${API_ORIGIN}${url}`;
  if (url.startsWith('/')) return url;
  return '/generated/competition-cover-1.png';
}

function formatDate(value?: string | null) {
  if (!value) return '待定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(value?: string | null) {
  if (!value) return '待定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function getCompetition(id: string): Promise<CompetitionDetail | null> {
  try {
    const res = await fetch(`${API_BASE}/competitions/${id}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as CompetitionDetail;
  } catch {
    return null;
  }
}

export default async function CompetitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const competition = await getCompetition(id);
  if (!competition) notFound();

  const projects =
    competition.eventOptions?.map((event) => event.label) ??
    (competition.events?.length ? competition.events : competition.projects) ??
    [];

  const description = (competition.description ?? '').trim();
  const notice = (competition.registrationNotice ?? '').trim();
  const cover = normalizeCover(competition.coverImage);

  return (
    <PortalFeaturePage
      activeHref="/competitions"
      eyebrow="Competition Detail"
      title={competition.title}
      description={competition.subtitle ?? '查看赛事简介、项目设置与报名须知,准备好就立即报名。'}
    >
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[1.55fr_1fr]">
        {/* Left column: cover + intro + notice */}
        <div className="space-y-4 sm:space-y-6">
          <article className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm">
            <div
              className="relative aspect-[16/9] bg-cover bg-center sm:aspect-[16/8]"
              style={{ backgroundImage: `url("${cover}")` }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-[#02133b]/85 via-[#02133b]/35 to-transparent" />
              <div className="absolute left-4 top-4 flex flex-wrap gap-2 sm:left-5 sm:top-5">
                <span className="rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-black text-blue-700 shadow-sm sm:px-3 sm:py-1 sm:text-xs">
                  {competition.registrationStatus ?? competition.statusLabel ?? '报名状态待定'}
                </span>
                {competition.needsRegistrationReview ? (
                  <span className="rounded-full bg-amber-400/95 px-2.5 py-0.5 text-[11px] font-black text-white shadow-sm sm:px-3 sm:py-1 sm:text-xs">
                    需审核
                  </span>
                ) : null}
              </div>
              <div className="absolute bottom-4 left-4 right-4 sm:bottom-5 sm:left-5 sm:right-5">
                <h2 className="text-lg font-black leading-tight text-white sm:text-2xl md:text-3xl">
                  {competition.title}
                </h2>
                {competition.subtitle ? (
                  <p className="mt-1.5 line-clamp-2 text-xs font-semibold text-blue-50/90 sm:mt-2 sm:line-clamp-none sm:text-sm md:text-base">
                    {competition.subtitle}
                  </p>
                ) : null}
              </div>
            </div>
          </article>

          <section className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-black text-slate-900">赛事简介</h3>
              <span className="text-xs font-semibold text-slate-400">Introduction</span>
            </div>
            <div className="mt-4 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-700">
              {description || <span className="text-slate-400">暂无简介,后台未填写说明。</span>}
            </div>
          </section>

          {notice ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-6 shadow-sm">
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-black text-amber-900">报名须知</h3>
                <span className="text-xs font-semibold text-amber-700/70">Notice</span>
              </div>
              <div className="mt-4 whitespace-pre-wrap text-sm font-medium leading-7 text-amber-900/90">
                {notice}
              </div>
            </section>
          ) : null}
        </div>

        {/* Right column: facts + projects + actions */}
        <aside className="space-y-4 sm:space-y-6">
          <section className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
            <h3 className="text-lg font-black text-slate-900">赛事信息</h3>
            <dl className="mt-4 space-y-4 text-sm">
              <Fact label="比赛日期">
                {formatDate(competition.startDate)}
                <span className="mx-2 text-slate-400">→</span>
                {formatDate(competition.endDate)}
              </Fact>
              <Fact label="比赛地点">{competition.location || '地点待公布'}</Fact>
              <Fact label="报名时间">
                {formatDateTime(competition.registrationStartTime)}
                <span className="mx-2 text-slate-400">→</span>
                {formatDateTime(competition.registrationEndTime)}
              </Fact>
              <Fact label="已通过审核">
                <span className="text-base font-black text-blue-700">{competition.registeredCount ?? 0}</span>
                <span className="ml-1 text-slate-500">人</span>
              </Fact>
              <Fact label="报名规则">
                {competition.allowCrossEventRegistration
                  ? `可同时报名 ${competition.maxRegistrationEvents ?? 1} 个项目`
                  : '每人只能报名 1 个项目'}
              </Fact>
            </dl>
          </section>

          <section className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
            <h3 className="text-lg font-black text-slate-900">参赛项目</h3>
            {projects.length ? (
              <ul className="mt-4 flex flex-wrap gap-2">
                {projects.map((project) => (
                  <li
                    key={project}
                    className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-black text-blue-700"
                  >
                    {project}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm font-semibold text-slate-500">项目待公布</p>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-blue-100 bg-white p-6 shadow-sm">
            <Link
              href={`/competitions/${competition.id}/register`}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-amber-400 text-sm font-black text-white shadow-sm transition hover:bg-amber-500"
            >
              立即报名
            </Link>
            <Link
              href={`/competitions/${competition.id}/players`}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-blue-200 text-sm font-black text-blue-700 transition hover:bg-blue-50"
            >
              查看选手
            </Link>
            <Link
              href="/competitions"
              className="inline-flex h-11 w-full items-center justify-center rounded-lg text-sm font-semibold text-slate-500 transition hover:text-blue-700"
            >
              ← 返回赛事列表
            </Link>
          </section>
        </aside>
      </div>
    </PortalFeaturePage>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-blue-50 pb-3 last:border-b-0 last:pb-0">
      <dt className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="text-right text-sm font-semibold text-slate-700">{children}</dd>
    </div>
  );
}
