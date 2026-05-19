import Image from 'next/image';

type QuickActionCardProps = {
  title: string;
  description: string;
  icon: string;
  accent: string;
};

export function QuickActionCard({ title, description, icon, accent }: QuickActionCardProps) {
  return (
    <article className="group relative h-32 overflow-hidden rounded-2xl border border-blue-100 bg-white/95 p-4 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(15,84,170,0.16)]">
      <div className={`pointer-events-none absolute -right-10 -top-12 z-0 h-28 w-28 rounded-full bg-gradient-to-br ${accent} opacity-20 blur-xl`} />
      <div className="relative z-10 flex h-full items-center gap-4 pr-10">
        <div className={`flex h-12 min-w-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${accent}`}>
          <Image src={icon} alt="" width={24} height={24} className="h-6 w-6 shrink-0" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-black text-slate-900">{title}</h3>
          <p className="mt-1.5 pr-2 text-sm leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      <button
        type="button"
        aria-label={`进入${title}`}
        className="absolute bottom-4 right-4 z-20 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-white text-blue-600 shadow-sm transition duration-300 group-hover:scale-110 group-hover:border-blue-500 group-hover:bg-blue-600"
      >
        <Image
          src="/generated/icon-arrow.svg"
          alt=""
          width={20}
          height={20}
          className="h-5 w-5 shrink-0 transition duration-300 group-hover:brightness-0 group-hover:invert"
        />
      </button>
    </article>
  );
}
