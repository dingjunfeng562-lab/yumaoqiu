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
      <section className="relative overflow-hidden bg-[#04163f] px-4 py-9 text-white sm:px-6 sm:py-12 lg:px-8 lg:py-14">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(2,11,39,0.98),rgba(4,50,123,0.88)_48%,rgba(2,12,42,0.98))]" />
        <Image
          src="/generated/shuttlecock-glow.svg"
          alt=""
          width={520}
          height={340}
          className="pointer-events-none absolute right-[8%] top-4 hidden h-48 w-72 opacity-45 lg:block"
        />
        <div className="relative z-10 mx-auto max-w-[1440px]">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-100 sm:text-xs">{eyebrow}</p>
          <h1 className="mt-2 text-2xl font-black leading-tight sm:mt-3 sm:text-3xl md:text-5xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-[13px] font-semibold leading-6 text-blue-50/78 sm:mt-4 sm:text-sm sm:leading-7 md:text-base">
            {description}
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</section>
    </main>
  );
}
