import Image from 'next/image';

type Preview = {
  id: string;
  title: string;
  players: string[];
};

function MiniBracket({ players }: { players: string[] }) {
  const normalized = [...players, '待定', '待定', '待定'].slice(0, 4);
  return (
    <div className="relative mt-4 grid min-w-[330px] grid-cols-[80px_46px_28px_46px_48px] items-center gap-2">
      <div className="space-y-3">
        {normalized.map((player, index) => (
          <div key={`${player}-${index}`} className="flex items-center gap-2">
            <span className="h-4 w-4 rounded-full bg-slate-200" />
            <span className="w-14 rounded-md bg-white/80 px-2 py-1 text-sm font-semibold text-slate-700 shadow-sm">
              {player}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-7">
        <div className="h-10 border-y-2 border-r-2 border-blue-300" />
        <div className="h-10 border-y-2 border-r-2 border-blue-300" />
      </div>
      <div className="space-y-9">
        <span className="block h-4 w-4 rounded-full bg-slate-200" />
        <span className="block h-4 w-4 rounded-full bg-slate-200" />
      </div>
      <div className="h-20 border-y-2 border-r-2 border-blue-300" />
      <div className="grid place-items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/80">
          <Image src="/generated/icon-trophy.svg" alt="" width={24} height={24} className="h-6 w-6 shrink-0" />
        </div>
      </div>
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
