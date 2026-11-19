'use client';

import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Empty, Spin, Timeline, Typography } from 'antd';
import { apiFetch } from '@/lib/api';
import { LOG_ACTION_LABELS, describeLogChanges, type MatchLogRow } from '@/lib/match-management';

const { Text } = Typography;

/** 管理抽屉「操作记录」：谁、什么时候、对这一场做了什么、改前改后。最新的在上面。 */
export function MatchLogs({ matchId, token, refreshKey }: { matchId: string; token?: string; refreshKey: number }) {
  const [rows, setRows] = useState<MatchLogRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<MatchLogRow[]>(`/match-management/matches/${matchId}/logs`, { token, cache: 'no-store' })
      .then((data) => { if (alive) { setRows(data); setError(''); } })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : '加载操作记录失败'); });
    return () => { alive = false; };
  }, [matchId, token, refreshKey]);

  if (error) return <Text type="danger">{error}</Text>;
  if (!rows) return <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>;
  if (!rows.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这一场还没有在这里改过" />;
  const formatTime = (iso: string) => dayjs(iso).format('MM-DD HH:mm');
  return (
    <Timeline
      style={{ marginTop: 8 }}
      items={rows.map((row) => ({
        key: row.id,
        content: (
          <div>
            <div>
              <Text strong>{LOG_ACTION_LABELS[row.action] ?? row.action}</Text>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                {dayjs(row.createdAt).format('YYYY-MM-DD HH:mm:ss')} · {row.operatorName ?? '—'}
              </Text>
            </div>
            {describeLogChanges(row, formatTime).map((line) => (
              <div key={line} style={{ fontSize: 12, color: '#475569' }}>{line}</div>
            ))}
          </div>
        ),
      }))}
    />
  );
}
