import Image from 'next/image';

type StatCardProps = {
  label: string;
  value: string;
  icon: string;
  gradient: string;
  delay?: string;
};

export function StatCard({ label, value, icon, gradient, delay = '0ms' }: StatCardProps) {
  return (
    <article className="group relative h-28 overflow-hidden rounded-2xl border border-blue-100 bg-white/90 p-4 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(30,90,180,0.16)]">
      <div className="pointer-events-none absolute -right-10 -top-12 z-0 h-24 w-24 rounded-full bg-blue-100/70 opacity-20 blur-2xl" />
      <div className="relative z-10 flex h-full items-center gap-4 pr-8">
        <div className={`flex h-12 min-w-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${gradient}`}>
          <Image src={icon} alt="" width={24} height={24} className="h-6 w-6 shrink-0" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-500">{label}</p>
          <strong
            className="animate-number-pop mt-1.5 block text-3xl font-black leading-none text-blue-700"
            style={{ animationDelay: delay }}
          >
            {value}
          </strong>
        </div>
      </div>
      <Image
        src="/generated/icon-arrow.svg"
        alt=""
        width={28}
        height={28}
        className="pointer-events-none absolute bottom-3 right-3 z-10 h-6 w-6 opacity-55 transition duration-300 group-hover:opacity-100"
      />
    </article>
  );
}
