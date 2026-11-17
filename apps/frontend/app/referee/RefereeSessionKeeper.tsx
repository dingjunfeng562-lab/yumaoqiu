'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';

// 裁判员账号的「比赛保活」：登录固定 7 天，但在裁判端时要保证离自动退出至少还有 48 小时，
// 免得比赛打到一半到点被踢回登录页（11-17 旅职校两台手机同时掉线）。
// 剩余不足 47 小时就请后端续到 48 小时（auth.service.ts REFEREE_KEEPALIVE_SECONDS）；
// 留 1 小时余量，免得每进一个页面都续一次。
const TOP_UP_BELOW_MS = 47 * 60 * 60 * 1000;
// 计分页可能一直亮屏开着，定时再看一次。
const CHECK_EVERY_MS = 30 * 60 * 1000;
// 续期失败（如场馆网络差）隔 5 分钟再试；失败不会登出。
const RETRY_AFTER_MS = 5 * 60 * 1000;

export function RefereeSessionKeeper() {
  const { data: session, status, update } = useSession();
  const role = session?.user?.role;
  const expiresAt = session?.accessTokenExpiresAt;
  const lastTryAt = useRef(0);

  useEffect(() => {
    if (status !== 'authenticated' || role !== 'REFEREE') return;

    const check = () => {
      if (document.visibilityState !== 'visible') return;
      if (expiresAt && expiresAt - Date.now() >= TOP_UP_BELOW_MS) return;
      const now = Date.now();
      if (now - lastTryAt.current < RETRY_AFTER_MS) return;
      lastTryAt.current = now;
      void update({ refereeKeepAlive: true }).catch(() => undefined);
    };

    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [status, role, expiresAt, update]);

  return null;
}
