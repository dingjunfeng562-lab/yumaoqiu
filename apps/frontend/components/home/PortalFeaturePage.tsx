import Image from 'next/image';
import type { ReactNode } from 'react';
import { Header } from './Header';

type PortalFeaturePageProps = {
  activeHref: string;
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
};

export function PortalFeaturePage({
  activeHref,
  eyebrow,
  title,
  description,
  children,
}: PortalFeaturePageProps) {
  return (
    <main className="min-h-screen bg-[#f5f8ff] text-slate-950">
      <Header activeHref={activeHref} />
      <section className="relative overflow-hidden bg-[#04163f] px-6 py-14 text-white lg:px-8">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(2,11,39,0.98),rgba(4,50,123,0.88)_48%,rgba(2,12,42,0.98))]" />
        <Image
          src="/generated/shuttlecock-glow.svg"
          alt=""
          width={520}
          height={340}
          className="pointer-events-none absolute right-[8%] top-4 hidden h-48 w-72 opacity-45 lg:block"
        />
        <div className="relative z-10 mx-auto max-w-[1440px]">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-black md:text-5xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-sm font-semibold leading-7 text-blue-50/78 md:text-base">
            {description}
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-[1440px] px-6 py-8 lg:px-8">{children}</section>
    </main>
  );
}
