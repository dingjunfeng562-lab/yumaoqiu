'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert } from 'antd';
import { apiFetch } from '@/lib/api';

type Unpaid = { id: string; name: string };

/**
 * 抽签编排前的未缴费提示。后端会拒绝含未缴费参赛方的抽签/对阵生成，这里提前列出名单。
 * kind=event 读单项抽签详情里的 unpaidEntrants；kind=team 读团体赛未缴费队伍。
 */
export function UnpaidNotice({ kind, id, token, revision }: {
  kind: 'event' | 'team';
  id?: string;
  token?: string;
  revision?: unknown;
}) {
  const [unpaid, setUnpaid] = useState<Unpaid[]>([]);

  useEffect(() => {
    if (!token || !id) return;
    let alive = true;
    const request = kind === 'event'
      ? apiFetch<{ unpaidEntrants?: Unpaid[] }>(`/events/${id}/draw`, { token, redirectOnForbidden: false }).then((data) => data.unpaidEntrants ?? [])
      : apiFetch<Unpaid[]>(`/team-competitions/${id}/unpaid-teams`, { token, redirectOnForbidden: false });
    request.then((rows) => { if (alive) setUnpaid(rows); }).catch(() => { if (alive) setUnpaid([]); });
    return () => { alive = false; };
  }, [kind, id, token, revision]);

  if (!id || !unpaid.length) return null;
  const subject = kind === 'event' ? '选手' : '队伍';
  const names = unpaid.slice(0, 20).map((row) => row.name).join('、');
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      title={`有 ${unpaid.length} 个${subject}未缴费，确认缴费后才能抽签编排`}
      description={(
        <span>
          {names}{unpaid.length > 20 ? ` 等 ${unpaid.length} 个` : ''}。
          <Link href="/nicaiyixiahh/payments">前往缴费管理 →</Link>
        </span>
      )}
    />
  );
}
