'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';

const navItems = [
  { label: '首页', href: '/' },
  { label: '赛事列表', href: '/competitions' },
  { label: '赛程安排', href: '/schedule' },
  { label: '成绩排行', href: '/ranking' },
  { label: '通知公告', href: '/notice' },
];

export function Header({ activeHref = '/' }: { activeHref?: string }) {
  const { data: session, status } = useSession();
  const role = session?.user?.role;
  const roleHref =
    role === 'ADMIN' || role === 'SUPER_ADMIN'
      ? '/admin'
      : role === 'REFEREE'
        ? '/referee/my-matches'
        : role === 'PLAYER'
          ? '/my-registrations'
          : '/';
  const [menuOpen, setMenuOpen] = useState(false);

  // Lock body scroll while menu is open + close on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-white/10 bg-gradient-to-r from-[#052163] via-[#0a5dd1] to-[#03205c] shadow-[0_10px_32px_rgba(0,44,120,0.18)] sm:h-[72px]">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-3 px-3 sm:gap-4 sm:px-6 lg:gap-6 lg:px-8">
        <Link
          href="/"
          className="flex min-w-0 shrink items-center gap-2 sm:w-[250px] sm:shrink-0 sm:gap-3"
          onClick={closeMenu}
        >
          <Image
            src="/logo.png"
            alt="羽动云赛 Logo"
            width={1536}
            height={1024}
            priority
            className="h-9 w-[50px] shrink-0 object-contain sm:h-11 sm:w-[64px]"
          />
          <div className="min-w-0 text-white">
            <p className="truncate text-sm font-black tracking-wide sm:text-base lg:text-lg">羽动云赛</p>
            <p className="mt-0.5 hidden text-[11px] font-semibold text-blue-100/90 sm:block">
              羽毛球赛事管理平台
            </p>
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
          {status === 'authenticated' ? (
            <>
              <Link
                href={roleHref}
                onClick={closeMenu}
                className="inline-flex h-9 items-center whitespace-nowrap rounded-lg bg-gradient-to-r from-amber-400 to-amber-300 px-3 text-xs font-bold text-[#03205c] shadow-[0_6px_18px_rgba(245,158,11,0.4)] transition duration-300 hover:scale-105 sm:h-10 sm:px-4 sm:text-sm"
              >
                个人中心
              </Link>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/' })}
                className="hidden h-10 items-center rounded-lg border border-white/60 px-4 text-sm font-bold text-white transition duration-300 hover:bg-white/10 lg:inline-flex"
              >
                退出
              </button>
            </>
          ) : (
            <Link
              href="/login"
              onClick={closeMenu}
              className="inline-flex h-9 items-center rounded-lg border border-white/60 px-3 text-xs font-bold text-white transition duration-300 hover:bg-white/10 sm:h-10 sm:px-4 sm:text-sm"
            >
              登录
            </Link>
          )}

          {/* Mobile menu button */}
          <button
            type="button"
            aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/40 text-white transition hover:bg-white/10 sm:h-10 sm:w-10 lg:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-5 w-5">
              {menuOpen ? (
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              ) : (
                <>
                  <path strokeLinecap="round" d="M4 7h16" />
                  <path strokeLinecap="round" d="M4 12h16" />
                  <path strokeLinecap="round" d="M4 17h16" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-x-0 top-16 z-20 sm:top-[72px] lg:hidden ${menuOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={!menuOpen}
      >
        <div
          className={`absolute inset-x-0 top-0 -z-10 h-[100dvh] bg-[#02133b]/60 backdrop-blur-sm transition-opacity duration-200 ${
            menuOpen ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={closeMenu}
        />
        <div
          id="mobile-nav"
          className={`mx-3 origin-top overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#052163] to-[#03205c] shadow-[0_24px_60px_rgba(2,11,39,0.55)] transition duration-200 ${
            menuOpen ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
          }`}
        >
          <nav className="flex flex-col py-2">
            {navItems.map((item) => {
              const active = item.href === activeHref;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={closeMenu}
                  className={`flex items-center justify-between border-b border-white/5 px-5 py-3.5 text-sm font-bold transition last:border-b-0 ${
                    active ? 'bg-white/5 text-amber-300' : 'text-white/95 hover:bg-white/5 hover:text-amber-200'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className={`text-base ${active ? 'text-amber-300' : 'text-white/40'}`}>›</span>
                </Link>
              );
            })}
            {status === 'authenticated' ? (
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  void signOut({ callbackUrl: '/' });
                }}
                className="flex items-center justify-between border-t border-white/10 px-5 py-3.5 text-sm font-bold text-white/95 transition hover:bg-white/5 hover:text-amber-200"
              >
                <span>退出登录</span>
                <span className="text-base text-white/40">›</span>
              </button>
            ) : null}
          </nav>
        </div>
      </div>
    </header>
  );
}
