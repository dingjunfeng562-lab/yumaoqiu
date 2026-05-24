import Image from 'next/image';

type Preview = {
  id: string;
  title: string;
  players: string[];
};

function MiniBracket({ players }: { players: string[] }) {
  // Always render a 4-team bracket: 4 participants → 2 semifinal winners → champion
  const normalized = [...players, '待定', '待定', '待定', '待定'].slice(0, 4);
  const semi1Winner = normalized[0] && normalized[0] !== '待定' ? normalized[0] : '待定';
  const semi2Winner = normalized[2] && normalized[2] !== '待定' ? normalized[2] : '待定';
  const champion =
    semi1Winner !== '待定' ? semi1Winner : semi2Winner !== '待定' ? semi2Winner : '待定';

  return (
    <div className="relative mt-4 grid min-w-[360px] grid-cols-[100px_28px_88px_28px_84px] items-center gap-1.5">
      {/* Column 0: participant boxes paired */}
      <div className="space-y-1.5">
        <ParticipantPill name={normalized[0]} />
        <ParticipantPill name={normalized[1]} />
        <div className="h-2" />
        <ParticipantPill name={normalized[2]} />
        <ParticipantPill name={normalized[3]} />
      </div>
      {/* Connector 0→1 */}
      <div className="flex h-full flex-col justify-around">
        <div className="h-12 border-y border-r border-blue-300/80" />
        <div className="h-12 border-y border-r border-blue-300/80" />
      </div>
      {/* Column 1: semifinal winners */}
      <div className="flex h-full flex-col justify-around">
        <WinnerPill name={semi1Winner} />
        <WinnerPill name={semi2Winner} />
      </div>
      {/* Connector 1→2 */}
      <div className="flex h-full items-center">
        <div className="h-24 w-full border-y border-r border-blue-300/80" />
      </div>
      {/* Column 2: champion */}
      <div className="flex h-full items-center justify-center">
        <div
          className={`flex h-20 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 px-1.5 text-center shadow-sm ${
            champion !== '待定'
              ? 'border-amber-300 bg-gradient-to-br from-amber-50 via-white to-amber-100'
              : 'border-dashed border-amber-200 bg-amber-50/40'
          }`}
        >
          <Image src="/generated/icon-trophy.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0" />
          <span
            className={`block max-w-full truncate text-[11px] ${
              champion !== '待定' ? 'font-black text-[#03205c]' : 'font-semibold italic text-slate-400'
            }`}
          >
            {champion}
          </span>
        </div>
      </div>
    </div>
  );
}

function ParticipantPill({ name }: { name: string }) {
  const bye = name === '待定';
  return (
    <div
      className={`flex h-7 items-center rounded-md border bg-white px-2 text-[11px] shadow-sm ${
        bye
          ? 'border-dashed border-slate-200 italic text-slate-400'
          : 'border-blue-100 font-bold text-slate-700'
      }`}
    >
      <span className="truncate">{name}</span>
    </div>
  );
}

function WinnerPill({ name }: { name: string }) {
  const empty = name === '待定';
  return (
    <div
      className={`flex h-8 items-center rounded-md border bg-white px-2 text-[11px] shadow-sm ${
        empty
          ? 'border-dashed border-slate-200 italic text-slate-400'
          : 'border-amber-200 font-black text-[#03205c]'
      }`}
    >
      <span className="truncate">{name}</span>
    </div>
  );
}

export function BracketPreview({
  previews,
}: {
  previews: Preview[];
}) {
  return (
    <section className="relative flex h-full min-h-[300px] flex-col overflow-hidden rounded-2xl border border-blue-100 bg-white/90 p-5 shadow-sm">
      <Image
        src="/generated/racket-watermark.svg"
        alt=""
        width={520}
        height={380}
        className="pointer-events-none absolute -bottom-16 right-0 z-0 h-56 w-72 opacity-10"
      />
      <div className="relative z-10 mb-4 flex items-center justify-between gap-4 border-b border-blue-50 pb-4">
        <div className="flex items-center gap-3">
          <span className="h-6 w-1.5 rounded-full bg-blue-600" />
          <h2 className="text-lg font-black text-slate-950">对阵预览</h2>
        </div>
      </div>
      {previews.length ? (
        <div className="relative z-10 grid flex-1 gap-4 sm:grid-cols-2">
          {previews.map((item) => (
            <article
              key={item.id}
              className="overflow-hidden rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-sky-50 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80">
                    <Image src="/generated/icon-bracket.svg" alt="" width={24} height={24} className="h-6 w-6 shrink-0" />
                  </div>
                  <h3 className="truncate text-sm font-black text-slate-900">{item.title}</h3>
                </div>
                <a className="shrink-0 text-xs font-bold text-blue-600 hover:text-orange-500" href={`/competitions/${item.id}/bracket`}>
                  查看 &gt;
                </a>
              </div>
              <div className="overflow-x-auto">
                <MiniBracket players={item.players} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="relative z-10 grid flex-1 place-items-center rounded-xl bg-blue-50/60 text-sm font-semibold text-slate-500">
          当前比赛暂未生成对阵
        </div>
      )}
    </section>
  );
}
