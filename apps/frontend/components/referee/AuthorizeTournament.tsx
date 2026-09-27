'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Spin } from 'antd';
import { apiFetch } from '@/lib/api';

export default function AuthorizeTournament({ accessCode }: { accessCode: string }) {
  const { data: session, status } = useSession();
  const token = session?.user?.accessToken;
  const role = session?.user?.role;
  const router = useRouter();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token || role !== 'REFEREE') return;
    const controller = new AbortController();
    apiFetch<{ tournamentId: string }>('/referee/authorize', {
      token, method: 'POST', body: JSON.stringify({ accessCode }),
      signal: controller.signal, redirectOnForbidden: false,
    }).then((result) => {
      if (!controller.signal.aborted) router.replace(`/referee/tournaments/${encodeURIComponent(result.tournamentId)}`);
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '赛事授权失败');
    });
    return () => controller.abort();
  }, [accessCode, token, role, router, attempt]);

  return <main className="grid min-h-screen place-items-center bg-slate-50 !p-5">
    <section className="flex w-full max-w-md flex-col gap-5 rounded-2xl border border-blue-100 bg-white !p-6 text-center">
      <h1 className="text-xl font-black">赛事扫码授权</h1>
      {error ? <><Alert type="error" title={error} /><Button onClick={() => { setError(''); setAttempt((value) => value + 1); }}>重试授权</Button><Button href="/referee/scan">重新扫码</Button></>
        : status !== 'loading' && role !== 'REFEREE' ? <Alert type="error" title="请使用裁判账号登录后扫码授权" />
        : <><Spin /><p className="text-slate-500">正在获取该赛事授权，成功后进入场地列表…</p></>}
    </section>
  </main>;
}
