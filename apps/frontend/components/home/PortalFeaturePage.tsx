import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Header } from './Header';
import { MobileBottomNav } from '@/components/mobile/MobileBottomNav';

type PortalFeaturePageProps = {
  activeHref: string;
  eyebrow: string;
  title: string;
  description: string;
  /** 标题区右上角的按钮（如「切换赛事」），可选。 */
  actions?: ReactNode;
  /**
   * 标题区左上角「返回上一级」，可选。指向固定的上一级页面（不用浏览器后退，
   * 分享链接直接打开也能用）；label 是上一级页面名，作为悬停提示和读屏文字。
   */
  back?: { href: string; label: string };
  children?: ReactNode;
};

export function PortalFeaturePage({
  activeHref,
  eyebrow,
  title,
  description,
  actions,
  back,
  children,
}: PortalFeaturePageProps) {
  const eyebrowText = (
    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-100 sm:text-xs">{eyebrow}</p>
  );
  return (
    <main className="min-h-screen bg-[#f5f8ff] text-slate-950">
      <Header activeHref={activeHref} />
      <section className="relative overflow-hidden bg-[#04163f] px-4 py-7 text-white sm:px-6 sm:py-12 lg:px-8 lg:py-14">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(2,11,39,0.98),rgba(4,50,123,0.88)_48%,rgba(2,12,42,0.98))]" />
        <Image
          src="/generated/shuttlecock-glow.svg"
          alt=""
          width={520}
          height={340}
          className="pointer-events-none absolute right-[8%] top-4 hidden h-48 w-72 opacity-45 lg:block"
        />
        <div className="relative z-10 mx-auto max-w-[1440px]">
          {back || actions ? (
            <div className={`flex items-center justify-between gap-3 ${back ? 'mb-4 sm:mb-5' : ''}`}>
              {back ? (
                <Link
                  href={back.href}
                  title={`返回${back.label}`}
                  aria-label={`返回上一级：${back.label}`}
                  className="tappable inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-white/25 bg-white/10 px-3.5 text-xs font-black text-white transition hover:bg-white/20 sm:h-10 sm:text-sm"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-4 w-4" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 5l-7 7 7 7" />
                  </svg>
                  返回上一级
                </Link>
              ) : (
                eyebrowText
              )}
              {actions}
            </div>
          ) : (
            eyebrowText
          )}
          {back ? eyebrowText : null}
          <h1 className="mt-2 text-xl font-black leading-tight sm:mt-3 sm:text-3xl md:text-5xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-[13px] font-semibold leading-6 text-blue-50/78 sm:mt-4 sm:text-sm sm:leading-7 md:text-base">
            {description}
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-[1440px] px-3 py-5 sm:px-6 sm:py-8 lg:px-8">{children}</section>
      <MobileBottomNav activeHref={activeHref} />
    </main>
  );
}
