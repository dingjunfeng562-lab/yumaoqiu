'use client';

import { useEffect, useRef } from 'react';
import { API_BASE } from './types';

/**
 * 赛事主页打开一次，浏览量 +1（每次打开都算，含刷新和站内再次进入）。
 * 放在客户端 effect 里：链接预取、爬虫拿服务端 HTML 都不会计数。
 * ref 防的是开发模式 StrictMode 把 effect 跑两遍，不影响正常的每次打开。
 */
export function ViewCounter({ competitionId }: { competitionId: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void fetch(`${API_BASE}/competitions/${encodeURIComponent(competitionId)}/view`, {
      method: 'POST',
      keepalive: true,
    }).catch(() => {});
  }, [competitionId]);
  return null;
}
