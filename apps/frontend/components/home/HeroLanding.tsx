import Image from 'next/image';
import Link from 'next/link';

const title = '羽动云赛';

export function HeroLanding() {
  return (
    <section
      id="intro"
      className="relative isolate flex min-h-[calc(100vh-72px)] overflow-hidden bg-[#04163f] bg-cover bg-center"
      style={{ backgroundImage: "url('/generated/hero-bg.svg')" }}
    >
      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_22%,rgba(67,198,255,0.34),transparent_34%),linear-gradient(135deg,rgba(2,11,39,0.98),rgba(4,50,123,0.88)_48%,rgba(2,12,42,0.98))]" />
      <div className="absolute inset-0 z-0 bg-[linear-gradient(180deg,rgba(2,8,26,0.08),rgba(2,8,26,0.72))]" />

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

      <div className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-center px-6 py-16 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
          <div className="landing-logo mb-8 flex items-center gap-4 rounded-3xl border border-white/20 bg-white/10 px-5 py-3 shadow-[0_18px_48px_rgba(15,118,255,0.24)] backdrop-blur-xl">
            <Image
              src="/logo.png"
              alt="羽动云赛 Logo"
              width={1536}
              height={1024}
              priority
              className="h-14 w-20 shrink-0 object-contain sm:h-16 sm:w-24"
            />
            <div className="text-left">
              <p className="text-sm font-black tracking-wide text-white sm:text-base">羽动云赛</p>
              <p className="mt-1 text-xs font-semibold text-blue-100/85">羽毛球赛事管理平台</p>
            </div>
          </div>

          <p className="mb-5 inline-flex rounded-full border border-cyan-200/30 bg-cyan-100/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-cyan-100 backdrop-blur">
            Badminton Event Management Platform
          </p>

          <h1
            aria-label={title}
            className="landing-title-gradient landing-title-reveal max-w-none break-keep text-center text-[clamp(1.55rem,8vw,6.5rem)] font-black leading-[1.05] whitespace-nowrap"
          >
            {title}
          </h1>

          <p className="landing-subtitle mt-7 max-w-3xl text-base leading-8 text-blue-50/86 sm:text-lg lg:text-xl">
            <span className="mb-2 block text-lg font-black text-amber-200 sm:text-xl">羽毛球赛事管理平台</span>
            报名、赛程、对阵、成绩，一站式管理羽毛球赛事。
          </p>

          <div className="landing-actions mt-9 flex flex-wrap justify-center gap-4">
            <Link
              href="/login"
              className="inline-flex h-12 min-w-36 items-center justify-center rounded-full bg-gradient-to-r from-orange-400 to-amber-300 px-8 text-sm font-black text-white shadow-[0_12px_28px_rgba(245,158,11,0.34)] transition duration-300 hover:scale-105"
            >
              进入系统
            </Link>
            <Link
              href="/competitions"
              className="inline-flex h-12 min-w-36 items-center justify-center rounded-full border border-white/60 bg-white/10 px-8 text-sm font-black text-white shadow-[0_12px_30px_rgba(20,184,255,0.15)] backdrop-blur transition duration-300 hover:scale-105 hover:bg-white/18"
            >
              查看赛事
            </Link>
          </div>

          <a
            href="mailto:wulibigger@foxmail.com"
            className="landing-actions mt-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-blue-100/85 backdrop-blur transition duration-300 hover:border-amber-300/50 hover:bg-white/10 hover:text-amber-200 sm:text-sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16v12H4z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7l8 6 8-6" />
            </svg>
            <span className="font-bold tracking-wide">联系方式</span>
            <span className="text-white/40">·</span>
            <span className="font-mono tracking-wide">wulibigger@foxmail.com</span>
          </a>
        </div>
      </div>
    </section>
  );
}
