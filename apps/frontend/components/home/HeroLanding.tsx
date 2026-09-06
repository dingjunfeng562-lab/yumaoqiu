import Image from 'next/image';
import Link from 'next/link';

const title = '羽动云赛';

export function HeroLanding() {
  return (
    <section
      id="intro"
      className="relative isolate flex min-h-screen overflow-hidden bg-[#04163f] bg-cover bg-center"
      style={{ backgroundImage: "url('/generated/hero-bg.svg')" }}
    >
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_22%,rgba(67,198,255,0.34),transparent_34%),linear-gradient(135deg,rgba(2,11,39,0.98),rgba(4,50,123,0.88)_48%,rgba(2,12,42,0.98))]" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(180deg,rgba(2,8,26,0.08),rgba(2,8,26,0.72))]" />

      <Image
        src="/generated/court-lines.svg"
        alt=""
        width={900}
        height={360}
        priority
        className="pointer-events-none absolute bottom-[-80px] left-1/2 z-0 w-[980px] max-w-none -translate-x-1/2 opacity-15 mix-blend-screen"
      />
      <Image
        src="/generated/racket-watermark.svg"
        alt=""
        width={520}
        height={380}
        className="pointer-events-none absolute -left-28 bottom-6 z-0 h-72 w-96 opacity-15"
      />
      <Image
        src="/generated/shuttlecock-glow.svg"
        alt=""
        width={520}
        height={340}
        priority
        className="animate-shuttle-drift pointer-events-none absolute right-[6%] top-[13%] z-0 hidden h-64 w-[390px] opacity-65 lg:block"
      />

      <div className="pointer-events-none absolute inset-0 z-0">
        <span className="landing-particle left-[12%] top-[24%]" />
        <span className="landing-particle left-[22%] top-[68%] animation-delay-300" />
        <span className="landing-particle left-[74%] top-[30%] animation-delay-600" />
        <span className="landing-particle left-[84%] top-[72%] animation-delay-900" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-center px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center text-center">
          <div className="landing-logo mb-6 flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 shadow-[0_18px_48px_rgba(15,118,255,0.24)] backdrop-blur-xl sm:mb-8 sm:gap-4 sm:rounded-3xl sm:px-5 sm:py-3">
            <Image
              src="/logo.png"
              alt="羽动云赛 Logo"
              width={1536}
              height={1024}
              priority
              className="h-10 w-14 shrink-0 object-contain sm:h-16 sm:w-24"
            />
            <div className="text-left">
              <p className="text-sm font-black tracking-wide text-white sm:text-base">羽动云赛</p>
              <p className="mt-0.5 text-[11px] font-semibold text-blue-100/85 sm:mt-1 sm:text-xs">羽毛球赛事管理平台</p>
            </div>
          </div>

          <p className="mb-4 inline-flex max-w-full rounded-full border border-cyan-200/30 bg-cyan-100/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100 backdrop-blur sm:mb-5 sm:px-4 sm:py-1.5 sm:text-xs sm:tracking-[0.2em]">
            <span className="truncate">Badminton Event Management Platform</span>
          </p>

          <h1
            aria-label={title}
            className="landing-title-gradient landing-title-reveal max-w-full break-keep text-center text-[clamp(2.4rem,13vw,6.5rem)] font-black leading-[1.05] whitespace-nowrap"
          >
            {title}
          </h1>

          <p className="landing-subtitle mt-5 max-w-3xl text-sm leading-7 text-blue-50/86 sm:mt-7 sm:text-lg sm:leading-8 lg:text-xl">
            <span className="mb-1.5 block text-base font-black text-amber-200 sm:mb-2 sm:text-xl">羽毛球赛事管理平台</span>
            报名、赛程、对阵、成绩，一站式管理羽毛球赛事。
          </p>

          <div className="landing-actions mt-7 flex w-full flex-col items-stretch justify-center gap-3 px-2 sm:mt-9 sm:w-auto sm:flex-row sm:flex-wrap sm:gap-4 sm:px-0">
            <Link
              href="/login"
              className="tappable inline-flex h-12 min-h-[44px] w-full items-center justify-center rounded-full bg-gradient-to-r from-orange-400 to-amber-300 px-8 text-sm font-black text-white shadow-[0_12px_28px_rgba(245,158,11,0.34)] transition duration-300 hover:scale-105 sm:w-auto sm:min-w-36"
            >
              进入系统
            </Link>
            <Link
              href="/competitions"
              className="tappable inline-flex h-12 min-h-[44px] w-full items-center justify-center rounded-full border border-white/60 bg-white/10 px-8 text-sm font-black text-white shadow-[0_12px_30px_rgba(20,184,255,0.15)] backdrop-blur transition duration-300 hover:scale-105 hover:bg-white/18 sm:w-auto sm:min-w-36"
            >
              查看赛事
            </Link>
            <Link
              href="/hawkeye"
              className="tappable inline-flex h-12 min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-emerald-400/50 bg-emerald-500/15 px-8 text-sm font-black text-emerald-200 shadow-[0_12px_30px_rgba(16,185,129,0.18)] backdrop-blur transition duration-300 hover:scale-105 hover:border-emerald-400/70 hover:bg-emerald-500/25 sm:w-auto sm:min-w-36"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <circle cx="12" cy="12" r="3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M2 12h4M18 12h4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              鹰眼系统
            </Link>
          </div>

          <a
            href="mailto:wulibigger@foxmail.com"
            className="landing-actions mt-8 inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-blue-100/85 backdrop-blur transition duration-300 hover:border-amber-300/50 hover:bg-white/10 hover:text-amber-200 sm:mt-10 sm:rounded-full sm:px-4 sm:text-sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16v12H4z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7l8 6 8-6" />
            </svg>
            <span className="font-bold tracking-wide">联系方式</span>
            <span className="hidden text-white/40 sm:inline">·</span>
            <span className="break-all font-mono tracking-wide">wulibigger@foxmail.com</span>
          </a>
        </div>
      </div>
    </section>
  );
}
