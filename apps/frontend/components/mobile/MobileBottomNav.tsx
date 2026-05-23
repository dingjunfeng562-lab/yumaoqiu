'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { ReactNode } from 'react';

type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
  match: (pathname: string) => boolean;
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      {children}
    </svg>
  );
}

const HomeIcon = (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 11l9-7 9 7" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 10v10h14V10" />
  </Icon>
);
const CompetitionIcon = (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 5h10v4a5 5 0 01-10 0V5z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5h2v3a3 3 0 01-3-3zM19 5h-2v3a3 3 0 003-3z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19h6M12 14v5" />
  </Icon>
);
const RegisterIcon = (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h12M4 12h12M4 17h7" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 14l4 4-4 4" />
  </Icon>
);
const UserIcon = (
  <Icon>
    <circle cx="12" cy="8" r="3.5" strokeLinecap="round" strokeLinejoin="round" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" />
  </Icon>
);
const ConsoleIcon = (
  <Icon>
    <rect x="3" y="4" width="18" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 20h8" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 9l3 3-3 3M12 15h5" />
  </Icon>
);

export function MobileBottomNav({ activeHref }: { activeHref?: string } = {}) {
  const pathname = usePathname() ?? '/';
  const current = activeHref ?? pathname;
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const authed = Boolean(session?.user);

  const myHref =
    role === 'REFEREE'
      ? '/referee/my-matches'
      : role === 'PLAYER'
        ? '/my-registrations'
        : role === 'ADMIN' || role === 'SUPER_ADMIN'
          ? '/admin'
          : authed
            ? '/my-registrations'
            : '/login';

  const adminHref =
    role === 'ADMIN' || role === 'SUPER_ADMIN'
      ? '/admin'
      : role === 'REFEREE'
        ? '/referee/my-matches'
        : authed
          ? '/forbidden'
          : '/login?redirect=/admin';

  const items: NavItem[] = [
    {
      key: 'home',
      label: '首页',
      href: '/',
      icon: HomeIcon,
      match: (p) => p === '/',
    },
    {
      key: 'comp',
      label: '赛事',
      href: '/competitions',
      icon: CompetitionIcon,
      match: (p) => p.startsWith('/competitions') || p.startsWith('/bracket') || p.startsWith('/schedule'),
    },
    {
      key: 'reg',
      label: '报名',
      href: authed ? '/competitions' : '/login?redirect=/competitions',
      icon: RegisterIcon,
      match: (p) => p.startsWith('/register') || p.endsWith('/register') || p.startsWith('/signup'),
    },
    {
      key: 'me',
      label: '我的',
      href: authed ? myHref : '/login',
      icon: UserIcon,
      match: (p) =>
        p.startsWith('/my-registrations') ||
        p.startsWith('/referee') ||
        p === '/login' ||
        p.startsWith('/history'),
    },
    {
      key: 'console',
      label: '后台',
      href: adminHref,
      icon: ConsoleIcon,
      match: (p) => p.startsWith('/admin'),
    },
  ];

  return (
    <>
      {/* Spacer so the floating bar doesn't sit on top of the last bit of page */}
      <div className="mobile-nav-spacer" aria-hidden />

      <nav
        aria-label="主导航"
        className="safe-pb fixed inset-x-0 bottom-0 z-40 border-t border-blue-100 bg-white/95 shadow-[0_-8px_24px_rgba(15,30,80,0.08)] backdrop-blur lg:hidden"
      >
        <ul className="mx-auto flex max-w-[640px] items-stretch justify-between px-1">
          {items.map((item) => {
            const active = item.match(current);
            return (
              <li key={item.key} className="flex-1">
                <Link
                  href={item.href}
                  className={`tappable flex h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-bold leading-none ${
                    active ? 'text-blue-700' : 'text-slate-500'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center ${
                      active ? 'text-blue-700' : 'text-slate-500'
                    }`}
                  >
                    {item.icon}
                  </span>
                  <span className="leading-none">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
