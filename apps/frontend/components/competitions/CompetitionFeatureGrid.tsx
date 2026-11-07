import Link from 'next/link';
import type { ReactNode } from 'react';

// 赛事主页的功能宫格：只放本站已有的功能 + 比分直播。

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6 sm:h-7 sm:w-7"
      aria-hidden
    >
      {children}
    </svg>
  );
}

type Feature = {
  key: string;
  label: string;
  href: string;
  color: string;
  icon: ReactNode;
  badge?: string;
};

export function CompetitionFeatureGrid({ competitionId, ongoing }: { competitionId: string; ongoing: boolean }) {
  const base = `/competitions/${encodeURIComponent(competitionId)}`;
  const features: Feature[] = [
    {
      key: 'register',
      label: '比赛报名',
      href: `${base}/register`,
      color: 'bg-sky-500 shadow-sky-500/30',
      icon: (
        <Icon>
          <path d="M4 20h4l10-10-4-4L4 16v4z" />
          <path d="M13 7l4 4" />
        </Icon>
      ),
    },
    {
      key: 'players',
      label: '选手名单',
      href: `${base}/players`,
      color: 'bg-rose-500 shadow-rose-500/30',
      icon: (
        <Icon>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="11" r="2" />
          <path d="M6 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4M14.5 10h3.5M14.5 13.5h3.5" />
        </Icon>
      ),
    },
    {
      key: 'brackets',
      label: '对阵成绩',
      href: `${base}/brackets`,
      color: 'bg-orange-500 shadow-orange-500/30',
      icon: (
        <Icon>
          <circle cx="6" cy="12" r="2.2" />
          <circle cx="18" cy="6" r="2.2" />
          <circle cx="18" cy="18" r="2.2" />
          <path d="M8 11l8-4M8 13l8 4" />
        </Icon>
      ),
    },
    {
      key: 'live',
      label: '比分直播',
      href: `${base}/live`,
      color: 'bg-emerald-500 shadow-emerald-500/30',
      badge: ongoing ? 'LIVE' : undefined,
      icon: (
        <Icon>
          <rect x="3" y="4.5" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16.5V20" />
          <path d="M9 10.5l2 2 4-4" />
        </Icon>
      ),
    },
    {
      key: 'query',
      label: '报名查询',
      href: '/registration-query',
      color: 'bg-violet-500 shadow-violet-500/30',
      icon: (
        <Icon>
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.5-4.5M8.5 11h5M11 8.5v5" />
        </Icon>
      ),
    },
    {
      key: 'intro',
      label: '赛事简介',
      href: `${base}/intro`,
      color: 'bg-indigo-500 shadow-indigo-500/30',
      icon: (
        <Icon>
          <path d="M7 3.5h7l4 4V20a.5.5 0 01-.5.5h-10.5a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5z" />
          <path d="M14 3.5V8h4M9.5 12h5M9.5 15.5h5" />
        </Icon>
      ),
    },
  ];

  return (
    <nav aria-label="赛事功能" className="rounded-xl border border-blue-100 bg-white px-2 py-4 shadow-sm sm:px-4 sm:py-5">
      <ul className="grid grid-cols-4 gap-x-1 gap-y-4 sm:grid-cols-6 sm:gap-3">
        {features.map((feature) => (
          <li key={feature.key}>
            <Link
              href={feature.href}
              className="tappable group flex flex-col items-center gap-2 rounded-lg px-0.5 py-1 text-center transition hover:bg-blue-50/70"
            >
              <span
                className={`relative flex h-12 w-12 items-center justify-center rounded-full text-white shadow-md transition group-hover:scale-105 sm:h-14 sm:w-14 ${feature.color}`}
              >
                {feature.icon}
                {feature.badge ? (
                  <span aria-hidden className="absolute -right-2 -top-1.5 rounded-full border-2 border-white bg-red-500 px-1.5 text-[9px] font-black leading-[14px] text-white">
                    {feature.badge}
                  </span>
                ) : null}
              </span>
              <span className="whitespace-nowrap text-[12.5px] font-black text-slate-700 sm:text-sm">{feature.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
