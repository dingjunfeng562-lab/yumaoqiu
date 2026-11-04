'use client';

import { useCallback, useEffect, useState } from 'react';
import { MaintenanceView } from './MaintenanceView';
import { safeReturnPath, type MaintenanceStatus } from '@/lib/maintenance';

const POLL_MS = 30_000;
// 前端 proxy 的维护状态缓存 3 秒，等它过期再回原页面，免得回去又被换成维护页。
const RESTORE_DELAY_MS = 4_000;
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

function offsetFrom(status: MaintenanceStatus | null) {
  const server = status?.serverTime ? new Date(status.serverTime).getTime() : NaN;
  return Number.isFinite(server) ? server - Date.now() : 0;
}

export function MaintenanceScreen({ initialStatus }: { initialStatus: MaintenanceStatus | null }) {
  const [status, setStatus] = useState<MaintenanceStatus | null>(initialStatus);
  // 只影响挂载后才开始走的倒计时，服务端和浏览器算出来不同也不会造成水合不一致。
  const [clockOffsetMs, setClockOffsetMs] = useState(() => offsetFrom(initialStatus));
  const [restoring, setRestoring] = useState(() => initialStatus?.enabled === false);

  // 检测到维护结束：稍等片刻再回原页面。
  useEffect(() => {
    if (!restoring) return;
    const id = window.setTimeout(() => {
      // 直接打开的 /maintenance（操作时被转过来的）回到 ?from=；被 proxy 换页的原地刷新。
      if (window.location.pathname === '/maintenance') {
        window.location.replace(safeReturnPath(new URLSearchParams(window.location.search).get('from')));
      } else {
        window.location.reload();
      }
    }, RESTORE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [restoring]);

  const check = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/maintenance/status`, { cache: 'no-store' });
      if (!res.ok) return;
      const next = (await res.json()) as MaintenanceStatus;
      if (typeof next?.enabled !== 'boolean') return;
      setClockOffsetMs(offsetFrom(next));
      if (!next.enabled) {
        setRestoring(true);
        return;
      }
      setStatus(next);
    } catch {
      // 网络抖动时保持当前画面，下一轮再查。
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  // 到了预计恢复时间立刻查一次，不必等下一轮。
  const expectedEndAt = status?.expectedEndAt;
  useEffect(() => {
    if (!expectedEndAt) return;
    const wait = new Date(expectedEndAt).getTime() - (Date.now() + clockOffsetMs);
    if (!Number.isFinite(wait) || wait <= 0 || wait > 24 * 60 * 60 * 1000) return;
    const id = window.setTimeout(() => void check(), wait + 1000);
    return () => window.clearTimeout(id);
  }, [expectedEndAt, clockOffsetMs, check]);

  return (
    <MaintenanceView
      title={status?.title}
      content={status?.content}
      startedAt={status?.startedAt}
      expectedEndAt={status?.expectedEndAt}
      clockOffsetMs={clockOffsetMs}
      restoring={restoring}
    />
  );
}
