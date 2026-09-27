'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSession } from 'next-auth/react';
import { Alert, Button, QRCode, Spin, Typography } from 'antd';
import { apiFetch } from '@/lib/api';

const subscribe = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => '';

export default function TournamentRefereeQr({ tournamentId, name }: { tournamentId: string; name?: string }) {
  return <TournamentQr key={tournamentId} tournamentId={tournamentId} name={name} />;
}

function TournamentQr({ tournamentId, name }: { tournamentId: string; name?: string }) {
  const origin = useSyncExternalStore(subscribe, getOrigin, getServerOrigin);
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!token || !tournamentId) return;
    const controller = new AbortController();
    apiFetch<{ path: string }>(`/tournaments/${encodeURIComponent(tournamentId)}/referee-access-code`, {
      method: 'POST', token, signal: controller.signal,
    }).then((result) => { if (!controller.signal.aborted) { setPath(result.path); setError(''); } })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '二维码加载失败'); });
    return () => controller.abort();
  }, [token, tournamentId, attempt]);
  if (!tournamentId || !origin) return null;
  if (error) return <div><Alert type="warning" title={error} /><Button onClick={() => { setError(''); setAttempt((value) => value + 1); }}>重新加载二维码</Button></div>;
  if (!path) return <Spin description="正在加载赛事授权二维码" />;
  const url = `${origin}${path}`;
  return (
    <div className="flex items-center gap-4">
      <QRCode value={url} size={128} />
      <div className="min-w-0 space-y-1">
        <p className="font-bold">赛事执裁二维码</p>
        <p className="text-sm text-slate-600">{name}</p>
        <p className="text-xs text-slate-500">裁判登录后扫码获得本赛事授权，再选择场地查看比赛。</p>
        <Typography.Text copyable={{ text: url }}>复制赛事入口</Typography.Text>
      </div>
    </div>
  );
}
