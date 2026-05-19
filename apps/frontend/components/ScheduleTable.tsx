type ScheduleItem = {
  id: string;
  time: string;
  event: string;
  match: string;
  court: string;
  status: string;
};

const statusClass: Record<string, string> = {
  未开始: 'bg-slate-100 text-slate-600',
  进行中: 'bg-emerald-100 text-emerald-700',
  已结束: 'bg-blue-100 text-blue-700',
};

export function ScheduleTable({
  schedules,
  competitionId,
}: {
  schedules: ScheduleItem[];
  competitionId?: string;
}) {
  return (
    <section className="flex h-full min-h-[300px] flex-col rounded-2xl border border-blue-100 bg-white/90 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-4 border-b border-blue-50 pb-4">
        <div className="flex items-center gap-3">
          <span className="h-6 w-1.5 rounded-full bg-blue-600" />
          <h2 className="text-lg font-black text-slate-950">今日赛程</h2>
        </div>
        <a
          href={competitionId ? `/competitions/${competitionId}/schedule` : '#schedule'}
          className="text-sm font-bold text-blue-600 transition hover:text-orange-500"
        >
          查看全部 &gt;
        </a>
      </div>
      {schedules.length ? (
        <div className="-mx-1 flex-1 overflow-x-auto">
          <table className="w-full min-w-[520px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="bg-blue-50 text-blue-700">
                <th className="rounded-l-xl px-4 py-3 font-black">时间</th>
                <th className="px-4 py-3 font-black">项目</th>
                <th className="px-4 py-3 font-black">对阵</th>
                <th className="px-4 py-3 font-black">场地</th>
                <th className="rounded-r-xl px-4 py-3 font-black">状态</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-4 py-3 font-semibold text-slate-700">
                    {new Date(item.time).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{item.event}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{item.match}</td>
                  <td className="px-4 py-3 text-slate-700">{item.court}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusClass[item.status] ?? statusClass['未开始']}`}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center rounded-xl bg-blue-50/60 text-sm font-semibold text-slate-500">
          当前比赛暂未生成赛程
        </div>
      )}
    </section>
  );
}
