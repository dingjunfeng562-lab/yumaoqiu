import { notFound } from 'next/navigation';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { TournamentSwitcher } from '@/components/competitions/TournamentSwitcher';
import { API_BASE } from '@/components/competitions/types';
import { isRichAnnouncementContent, sanitizeAnnouncementHtml } from '@/lib/announcement-html';

export const dynamic = 'force-dynamic';

export const metadata = { title: '赛事简介 | 羽动云赛' };

type CompetitionIntro = {
  id: string;
  title: string;
  description?: string | null;
  registrationNotice?: string | null;
};

async function getCompetition(id: string): Promise<CompetitionIntro | null> {
  try {
    const res = await fetch(`${API_BASE}/competitions/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as CompetitionIntro;
  } catch {
    return null;
  }
}

// 赛事简介 + 报名须知（从赛事主页移过来，主页宫格「赛事简介」进入）。
export default async function CompetitionIntroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const competition = await getCompetition(id);
  if (!competition) notFound();

  const description = (competition.description ?? '').trim();
  const richDescription = description && isRichAnnouncementContent(description)
    ? sanitizeAnnouncementHtml(description)
    : null;
  const notice = (competition.registrationNotice ?? '').trim();

  return (
    <PortalFeaturePage
      activeHref="/competitions"
      eyebrow="Introduction · 赛事简介"
      title={competition.title}
      description="赛事简介与报名须知。"
      actions={<TournamentSwitcher currentId={competition.id} target="intro" />}
      back={{ href: `/competitions/${encodeURIComponent(competition.id)}`, label: '赛事主页' }}
    >
      <div className="mx-auto max-w-4xl space-y-4 sm:space-y-6">
        <section className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col items-center text-center">
            <h2 className="text-lg font-black text-slate-900">赛事简介</h2>
            <span className="mt-1 text-xs font-semibold text-slate-400">Introduction</span>
          </div>
          {richDescription ? (
            <div
              className="rich-public-content mx-auto mt-4 max-w-3xl text-sm font-medium leading-7 text-slate-700"
              dangerouslySetInnerHTML={{ __html: richDescription }}
            />
          ) : (
            <div className="mx-auto mt-4 max-w-3xl whitespace-pre-wrap text-center text-sm font-medium leading-7 text-slate-700">
              {description || <span className="text-slate-400">暂无简介,后台未填写说明。</span>}
            </div>
          )}
        </section>

        {notice ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-6 shadow-sm">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-black text-amber-900">报名须知</h2>
              <span className="text-xs font-semibold text-amber-700/70">Notice</span>
            </div>
            <div className="mt-4 whitespace-pre-wrap text-sm font-medium leading-7 text-amber-900/90">
              {notice}
            </div>
          </section>
        ) : null}
      </div>
    </PortalFeaturePage>
  );
}
