import Link from 'next/link';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type ScheduleMatch = {
  id: string;
  eventTypeLabel: string;
  round: string;
  matchNo: number;
  side1?: { name: string } | null;
  side2?: { name: string } | null;
  venueName?: string | null;
  scheduledAt?: string | null;
  status: string;
};

type ScheduleData = {
  matches: ScheduleMatch[];
};

async function getSchedule() {
  try {
    const res = await fetch(`${API_BASE}/public/home`, { cache: 'no-store' });
    if (!res.ok) return { schedules: [] };
    return res.json();
  } catch {
    return { schedules: [] };
  }
}

export default async function SchedulePage() {
  const data = await getSchedule();
  const schedules: Array<{ id: string; time: string; event: string; match: string; court: string; status: string }> = data.schedules ?? [];

  return (
    <PortalFeaturePage
      activeHref="/schedule"
      eyebrow="Schedule"
      title="赛程安排"
      description="查看按时间、场地、项目组织的比赛安排，包括单项赛和团体赛。"
    >
      {schedules.length ? (
        <div className="space-y-4">
          {schedules.map((item) => (
            <div key={item.id} className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">{item.event}</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">{item.match}</p>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{item.status}</span>
              </div>
              <div className="mt-3 text-sm font-semibold text-slate-600">
                <p>时间：{item.time}</p>
                <p>场地：{item.court}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-blue-100 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-black">赛程由后台排程后发布</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            管理员完成抽签与场地排程后，完整赛程会在这里集中展示。
          </p>
          <Link href="/admin/scheduling" className="mt-5 inline-flex h-11 items-center rounded-lg bg-blue-600 px-5 text-sm font-black text-white">
            进入排程后台
          </Link>
        </div>
      )}
    </PortalFeaturePage>
  );
}
