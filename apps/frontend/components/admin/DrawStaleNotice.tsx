'use client';

import { useEffect, useState } from 'react';
import { Alert } from 'antd';
import { apiFetch } from '@/lib/api';

/**
 * 签表生成后报名有删除、调出或调入（缴费管理、参赛选手页操作），签表与参赛名单不一致。
 * 后端在重新抽签前会拒绝冻结和发布，这里提前提示。
 */
export function DrawStaleNotice({ eventId, token, revision }: { eventId?: string; token?: string; revision?: unknown }) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!token || !eventId) return;
    let alive = true;
    apiFetch<{ drawStale?: boolean }>(`/events/${eventId}/draw`, { token, redirectOnForbidden: false })
      .then((data) => { if (alive) setStale(Boolean(data.drawStale)); })
      .catch(() => { if (alive) setStale(false); });
    return () => { alive = false; };
  }, [eventId, token, revision]);

  if (!eventId || !stale) return null;
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 16 }}
      title="报名有删除或调整，请重新抽签"
      description="签表生成后，有报名被删除、调到其他项目或从其他项目调入，签表与参赛名单不一致。重新抽签之前不能冻结或发布；如设置了种子，请一并核对。"
    />
  );
}
