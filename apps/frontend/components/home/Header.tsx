'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';

const navItems = [
  { label: '首页', href: '/' },
  { label: '赛事列表', href: '/competitions' },
  { label: '赛程安排', href: '/schedule' },
  { label: '直播大屏幕', href: '/live-screen' },
  { label: '赛事图片', href: '/photos' },
  { label: '成绩排行', href: '/ranking' },
  { label: '通知公告', href: '/notice' },
];

function isActiveNavItem(href: string, currentPath: string) {
  if (href === '/') return currentPath === '/';
  if (href === '/competitions') {
    return currentPath.startsWith('/competitions') || currentPath.startsWith('/bracket');
  }
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

export function Header({ activeHref }: { activeHref?: string }) {
  const pathname = usePathname() ?? '/';
  const currentPath = activeHref ?? pathname;
  const { data: session, status } = useSession();
  const role = session?.user?.role;
  const roleHref =
    role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'ROOT'
      ? '/admin'
      : role === 'REFEREE'
        ? '/referee/my-matches'
        : role === 'PLAYER'
          ? '/my-registrations'
          : role === 'PHOTOGRAPHER'
            ? '/photographer/upload'
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
    <header className="sticky top-0 z-30 border-b border-white/10 bg-gradient-to-r from-[#052163] via-[#0a5dd1] to-[#03205c] shadow-[0_10px_32px_rgba(0,44,120,0.18)]">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-3 px-3 sm:h-[72px] sm:gap-4 sm:px-6 lg:gap-6 lg:px-8">
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
            const active = isActiveNavItem(item.href, currentPath);
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
            href="/live-screen"
            onClick={closeMenu}
            style={{ color: '#fff' }}
            className={`tappable inline-flex h-10 min-h-[44px] items-center rounded-lg px-3 text-xs font-black !text-white shadow-[0_6px_18px_rgba(245,158,11,0.25)] transition duration-300 lg:hidden ${
              isActiveNavItem('/live-screen', currentPath)
                ? 'border border-white/45 bg-white/18'
                : 'border border-white/35 bg-white/10 hover:bg-white/16'
            }`}
          >
            直播
          </Link>
          {status === 'authenticated' ? (
            <>
              {/* Mobile already has a "我的"/"后台" entry in the bottom nav,
                  so hide the redundant "个人中心" CTA below lg. */}
              <Link
                href={roleHref}
                onClick={closeMenu}
                className="hidden h-10 items-center whitespace-nowrap rounded-lg bg-gradient-to-r from-amber-400 to-amber-300 px-4 text-sm font-bold text-[#03205c] shadow-[0_6px_18px_rgba(245,158,11,0.4)] transition duration-300 hover:scale-105 lg:inline-flex"
              >
                个人中心
              </Link>
              <Link
                href="/account"
                onClick={closeMenu}
                className="hidden h-10 items-center whitespace-nowrap rounded-lg border border-white/60 px-4 text-sm font-bold text-white transition duration-300 hover:bg-white/10 lg:inline-flex"
              >
                账户设置
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
              style={{ color: '#fff' }}
              className="tappable inline-flex h-10 min-h-[44px] items-center rounded-lg border border-white/60 px-3 text-xs font-bold !text-white transition duration-300 hover:bg-white/10 sm:px-4 sm:text-sm"
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
            style={{ color: '#fff' }}
            className="tappable inline-flex h-10 min-h-[44px] w-10 min-w-[44px] items-center justify-center rounded-lg border border-white/40 !text-white transition hover:bg-white/10 lg:hidden"
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

      {/* Mobile quick nav: 汉堡菜单里的页面入口平铺成顶部横向滑动条，免开抽屉一键直达 */}
      <nav
        aria-label="快捷导航"
        className="scrollbar-none flex gap-2 overflow-x-auto border-t border-white/10 px-3 py-2 lg:hidden"
      >
        {navItems.map((item) => {
          const active = isActiveNavItem(item.href, currentPath);
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={closeMenu}
              style={{ color: active ? '#03205c' : '#fff' }}
              className={`tappable inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-xs font-bold transition ${
                active
                  ? 'bg-amber-300 shadow-[0_4px_14px_rgba(245,158,11,0.35)]'
                  : 'border border-white/25 bg-white/10 hover:bg-white/16'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

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
              const active = isActiveNavItem(item.href, currentPath);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={closeMenu}
                  style={{ color: '#fff' }}
                  className={`flex items-center justify-between border-b border-white/5 px-5 py-3.5 text-sm font-bold transition last:border-b-0 ${
                    active ? 'bg-white/12 !text-white' : '!text-white hover:bg-white/5 hover:!text-white'
                  }`}
                >
                  <span>{item.label}</span>
                  <span style={{ color: '#fff' }} className={`text-base ${active ? '!text-white' : '!text-white/70'}`}>›</span>
                </Link>
              );
            })}
            {status === 'authenticated' ? (
              <>
                <Link
                  href="/account"
                  onClick={closeMenu}
                  style={{ color: '#fff' }}
                  className="flex items-center justify-between border-t border-white/10 px-5 py-3.5 text-sm font-bold !text-white transition hover:bg-white/5 hover:!text-amber-200"
                >
                  <span>账户设置</span>
                  <span className="text-base text-white/40">›</span>
                </Link>
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
              </>
            ) : null}
          </nav>
        </div>
      </div>
    </header>
  );
}
