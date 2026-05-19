import Image from 'next/image';

type Announcement = {
  text: string;
  date: string;
};

export function AnnouncementList({ announcements }: { announcements: Announcement[] }) {
  return (
    <section className="relative flex h-full min-h-[300px] flex-col overflow-hidden rounded-2xl border border-blue-100 bg-white/90 p-5 shadow-sm">
      <Image
        src="/generated/shuttlecock-glow.svg"
        alt=""
        width={520}
        height={340}
        className="pointer-events-none absolute -bottom-20 right-0 z-0 h-48 w-64 opacity-10"
      />
      <div className="relative z-10 mb-3 flex items-center justify-between gap-4 border-b border-blue-50 pb-4">
        <div className="flex items-center gap-3">
          <span className="h-6 w-1.5 rounded-full bg-blue-600" />
          <h2 className="text-lg font-black text-slate-950">比赛公告</h2>
        </div>
        <a href="#announcements" className="text-sm font-bold text-blue-600 transition hover:text-orange-500">
          查看更多 &gt;
        </a>
      </div>
      <div className="relative z-10 flex-1 divide-y divide-blue-50">
        {announcements.length ? (
          announcements.map((item) => (
            <article key={`${item.date}-${item.text}`} className="flex items-center gap-3 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50">
                <Image src="/generated/icon-megaphone.svg" alt="" width={24} height={24} className="h-6 w-6 shrink-0" />
              </div>
              <p className="min-w-0 flex-1 truncate text-sm leading-6 text-slate-700">{item.text}</p>
              <time className="shrink-0 text-xs font-semibold text-slate-400">{item.date}</time>
            </article>
          ))
        ) : (
          <div className="grid h-full min-h-40 place-items-center text-sm font-semibold text-slate-500">
            当前暂无比赛公告
          </div>
        )}
      </div>
    </section>
  );
}
