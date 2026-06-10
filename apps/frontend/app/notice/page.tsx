import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { isRichAnnouncementContent, sanitizeAnnouncementHtml } from '@/lib/announcement-html';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type PublicAnnouncement = {
  id: string;
  title: string;
  content: string;
  type: string;
  isPinned: boolean;
  publishedAt: string;
};

async function getAnnouncements() {
  try {
    const res = await fetch(`${API_BASE}/public/announcements`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { announcements?: PublicAnnouncement[] };
    return data.announcements ?? [];
  } catch {
    return [];
  }
}

function formatDate(value: string) {
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

export default async function NoticePage() {
  const announcements = await getAnnouncements();

  return (
    <PortalFeaturePage
      activeHref="/notice"
      eyebrow="Notice"
      title="通知公告"
      description="集中查看赛事通知、报名提醒、赛程变更和参赛须知。"
    >
      {announcements.length ? (
        <div className="space-y-4">
          {announcements.map((announcement) => (
            <article key={announcement.id} className="rounded-lg border border-blue-100 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                  {announcement.type}
                </span>
                {announcement.isPinned ? (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">
                    置顶
                  </span>
                ) : null}
                <time className="text-xs font-semibold text-slate-400">
                  {formatDate(announcement.publishedAt)}
                </time>
              </div>
              <h2 className="mt-4 text-xl font-black text-slate-950">{announcement.title}</h2>
              {isRichAnnouncementContent(announcement.content) ? (
                <div
                  className="global-announcement-modal__content--rich mt-3 text-sm leading-7 text-slate-600"
                  dangerouslySetInnerHTML={{ __html: sanitizeAnnouncementHtml(announcement.content) }}
                />
              ) : (
                <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-7 text-slate-600">
                  {announcement.content}
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-blue-100 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-black">暂无新的公开公告</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            赛事公告由后台维护后，会在此页面展示。
          </p>
        </div>
      )}
    </PortalFeaturePage>
  );
}
