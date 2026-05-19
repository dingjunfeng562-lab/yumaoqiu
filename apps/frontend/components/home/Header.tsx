import Image from 'next/image';
import Link from 'next/link';

const navItems = [
  { label: '首页', href: '/' },
  { label: '赛事列表', href: '/competitions' },
  { label: '报名入口', href: '/signup' },
  { label: '赛程安排', href: '/schedule' },
  { label: '对阵表', href: '/bracket' },
  { label: '成绩排行', href: '/ranking' },
  { label: '通知公告', href: '/notice' },
];

export function Header({ activeHref = '/' }: { activeHref?: string }) {
  return (
    <header className="sticky top-0 z-30 h-[72px] border-b border-white/10 bg-gradient-to-r from-[#052163] via-[#0a5dd1] to-[#03205c] shadow-[0_10px_32px_rgba(0,44,120,0.18)]">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:gap-6 lg:px-8">
        <Link href="/" className="flex w-[188px] shrink-0 items-center gap-2.5 sm:w-[250px] sm:gap-3">
          <Image
            src="/logo.png"
            alt="羽动云赛 Logo"
            width={1536}
            height={1024}
            priority
            className="h-10 w-[56px] shrink-0 object-contain sm:h-11 sm:w-[64px]"
          />
          <div className="min-w-0 text-white">
            <p className="truncate text-sm font-black tracking-wide sm:text-base lg:text-lg">羽动云赛</p>
            <p className="mt-0.5 text-[11px] font-semibold text-blue-100/90">羽毛球赛事管理平台</p>
          </div>
        </Link>

        <nav className="hidden flex-1 items-center justify-center gap-6 lg:flex xl:gap-8">
          {navItems.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`relative whitespace-nowrap px-1 py-2 text-sm font-bold transition duration-300 ${
                  active ? 'text-amber-300' : 'text-white/95 hover:text-amber-200'
                }`}
              >
                {item.label}
                {active && (
                  <span className="absolute -bottom-0.5 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-amber-300" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <Link
            href="/login"
            className="hidden h-10 items-center rounded-lg border border-white/60 px-4 text-sm font-bold text-white transition duration-300 hover:bg-white/10 sm:inline-flex"
          >
            登录
          </Link>
          <Link
            href="/admin"
            className="inline-flex h-10 items-center whitespace-nowrap rounded-lg bg-gradient-to-r from-amber-400 to-amber-300 px-3 text-sm font-bold text-[#03205c] shadow-[0_6px_18px_rgba(245,158,11,0.4)] transition duration-300 hover:scale-105 sm:px-4"
          >
            管理后台
          </Link>
        </div>
      </div>
    </header>
  );
}
