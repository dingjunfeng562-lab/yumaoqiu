'use client';

import { useRoleAnnouncements } from '@/components/RoleAnnouncementsProvider';
import { isRichAnnouncementContent, sanitizeAnnouncementHtml } from '@/lib/announcement-html';

export type PublicAnnouncement = {
  id: string;
  title: string;
  content: string;
  type: string;
  isPinned: boolean;
  publishedAt: string;
};

const typeLabels: Record<string, string> = {
  normal: '普通公告',
  event: '赛事公告',
  maintenance: '系统维护',
  urgent: '紧急通知',
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AnnouncementCards({ announcements }: { announcements: PublicAnnouncement[] }) {
  return (
    <div className="space-y-4">
      {announcements.map((announcement) => (
        <article key={announcement.id} className="rounded-lg border border-blue-100 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
              {typeLabels[announcement.type] ?? announcement.type}
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
          <h3 className="mt-4 text-xl font-black text-slate-950">{announcement.title}</h3>
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
  );
}

export function NoticeLists({ announcements }: { announcements: PublicAnnouncement[] }) {
  const roleAnnouncements = useRoleAnnouncements();

  return (
    <div className="space-y-8">
      {roleAnnouncements.length > 0 && (
        <section aria-label="定向通知" className="space-y-4">
          <h2 className="text-xl font-black text-slate-950">定向通知</h2>
          <AnnouncementCards announcements={roleAnnouncements} />
        </section>
      )}
      <section aria-label="公开公告" className="space-y-4">
        {roleAnnouncements.length > 0 && <h2 className="text-xl font-black text-slate-950">公开公告</h2>}
        {announcements.length > 0 ? (
          <AnnouncementCards announcements={announcements} />
        ) : (
          <div className="rounded-lg border border-blue-100 bg-white p-8 shadow-sm">
            <p className="text-xl font-black">暂无新的公开公告</p>
          </div>
        )}
      </section>
    </div>
  );
}
