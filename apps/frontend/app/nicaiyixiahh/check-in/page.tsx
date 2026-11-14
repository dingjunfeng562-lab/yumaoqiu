'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Alert, Empty, Select, Space, Spin, Typography } from 'antd';
import { apiFetch } from '@/lib/api';
import { useCurrentAccess } from '@/lib/use-current-role';
import { CheckInBoard } from '@/components/check-in/CheckInBoard';

export default function CheckInPage() {
  const { data: session } = useSession();
  const access = useCurrentAccess();
  const token = session?.user?.accessToken;
  const allowed = access.can('SCHEDULING') || access.can('SCORING');
  const [tournaments, setTournaments] = useState<Array<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!token || !access.ready || !allowed) return;
    const abort = new AbortController();
    apiFetch<Array<{ id: string; name: string }>>('/check-in/tournaments', { token, signal: abort.signal, cache: 'no-store', redirectOnForbidden: false })
      .then((items) => {
        setTournaments(items);
        const requested = new URLSearchParams(window.location.search).get('tournamentId');
        setSelected(items.find((item) => item.id === requested)?.id ?? items[0]?.id ?? '');
      })
      .catch((reason) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '加载赛事失败'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [token, access.ready, allowed]);
  if (access.ready && !allowed) return <Alert type="error" title="需要赛事排程或裁判分配权限才能办理签到。" />;
  return <div>
    <Space wrap style={{ marginBottom: 16 }}><Typography.Title level={3} style={{ margin: 0, marginRight: 12 }}>赛事签到</Typography.Title><Select aria-label="选择赛事" showSearch optionFilterProp="label" loading={loading} placeholder="选择赛事" value={selected || undefined} onChange={setSelected} style={{ width: 320, maxWidth: '100%' }} options={tournaments.map((item) => ({ value: item.id, label: item.name }))} /></Space>
    {error && <Alert type="error" title={error} />}
    {selected && token ? <CheckInBoard key={selected} tournamentId={selected} token={token} staff canForfeit={access.ready && access.can('SCORING')} /> : loading ? <Spin /> : <Empty description="暂无可管理的赛事" />}
  </div>;
}
