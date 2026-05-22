import Link from 'next/link';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, '');

type Competition = {
  id: string;
  title: string;
  coverImage?: string | null;
  startDate: string;
  endDate: string;
  location?: string | null;
  events?: string[];
  projects?: string[];
  statusLabel?: string;
  registrationStatus?: string;
  registeredCount?: number;
};

function normalizeCover(url?: string | null) {
  if (!url) return '/generated/competition-cover-1.png';
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('/api/')) return `${API_ORIGIN}${url}`;
  if (url.startsWith('/')) return url;
  return '/generated/competition-cover-1.png';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

async function getCompetitions() {
  try {
    const res = await fetch(`${API_BASE}/competitions`, { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as Competition[];
  } catch {
    return [];
  }
}

export default async function CompetitionsPage() {
  const competitions = await getCompetitions();

  return (
    <PortalFeaturePage
      activeHref="/competitions"
      eyebrow="Competition"
      title="赛事列表"
      description="查看羽动云赛已发布的校园羽毛球赛事，选择对应赛事完成报名，审核通过后进入该赛事选手名单。"
    >
      {competitions.length ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {competitions.map((competition) => {
            const projects = competition.events?.length ? competition.events : competition.projects;
            return (
              <article
                key={competition.id}
                className="group flex flex-col overflow-hidden rounded-lg border border-blue-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
              >
                <Link
                  href={`/competitions/${competition.id}`}
                  className="block"
                  aria-label={`查看 ${competition.title} 详情`}
                >
                  <div
                    className="relative aspect-[16/9] bg-cover bg-center"
                    style={{ backgroundImage: `url("${normalizeCover(competition.coverImage)}")` }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-t from-[#02133b]/80 to-transparent" />
                    <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-black text-blue-700">
                      {competition.registrationStatus ?? competition.statusLabel ?? '报名状态待定'}
                    </span>
                    <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-blue-700/85 px-3 py-1 text-xs font-black text-white opacity-0 transition group-hover:opacity-100">
                      查看详情 →
                    </span>
                    <h2 className="absolute bottom-4 left-4 right-4 line-clamp-2 text-xl font-black text-white">
                      {competition.title}
                    </h2>
                  </div>
                </Link>
                <div className="flex flex-1 flex-col gap-3 p-5 text-sm font-semibold text-slate-600">
                  <Link
                    href={`/competitions/${competition.id}`}
                    className="block space-y-2 text-slate-600 transition hover:text-blue-700"
                  >
                    <p>{formatDate(competition.startDate)} - {formatDate(competition.endDate)}</p>
                    <p>{competition.location || '地点待公布'}</p>
                    <p>{projects?.join(' / ') || '项目待公布'}</p>
                    <p className="text-xs text-slate-500">已通过审核选手：{competition.registeredCount ?? 0} 人</p>
                  </Link>
                  <Link
                    href={`/competitions/${competition.id}`}
                    className="inline-flex items-center gap-1 text-xs font-black text-blue-700 transition hover:gap-2"
                  >
                    查看赛事详情 →
                  </Link>
                  <div className="mt-auto flex gap-3 border-t border-blue-50 pt-4">
                    <Link
                      href={`/competitions/${competition.id}/register`}
                      className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-amber-400 text-sm font-black text-white shadow-sm transition hover:bg-amber-500"
                    >
                      立即报名
                    </Link>
                    <Link
                      href={`/competitions/${competition.id}/players`}
                      className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-blue-200 text-sm font-black text-blue-700 transition hover:bg-blue-50"
                    >
                      查看选手
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-blue-100 bg-white p-10 text-center shadow-sm">
          <h2 className="text-xl font-black">暂无公开赛事</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">后台发布赛事后，会在这里展示。</p>
        </div>
      )}
    </PortalFeaturePage>
  );
}
