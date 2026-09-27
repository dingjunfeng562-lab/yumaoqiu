'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { Alert, Button, Empty, Spin, Tag } from 'antd';
import { LogoutOutlined, ReloadOutlined, ScanOutlined, UserOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type AuthorizedTournament = { id: string; name: string; courtCount: number };

export default function RefereeHomePage() {
  const { data: session, status } = useSession();
  const token = session?.user?.accessToken;
  const role = session?.user?.role;
  const [tournaments, setTournaments] = useState<AuthorizedTournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!token || role !== 'REFEREE') return;
    const controller = new AbortController();
    apiFetch<AuthorizedTournament[]>('/referee/tournaments', { token, signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setTournaments(result); setError(''); } })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '加载已授权赛事失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, role, revision]);

  if (status === 'loading') return <div className="grid min-h-screen place-items-center"><Spin /></div>;
  if (!token || role !== 'REFEREE') return <main className="!p-6"><Alert type="info" title="请使用裁判账号登录" /><Button href="/login?redirect=%2Freferee%2Fmy-matches">去登录</Button></main>;

  return <main className="min-h-screen bg-gradient-to-b from-blue-50 to-white !px-4 !py-5 text-slate-900">
    <div className="!mx-auto flex max-w-4xl flex-col gap-5">
      <header className="flex flex-col gap-4 rounded-2xl border border-blue-100 bg-white !p-5 shadow-sm">
        <div><h1 className="text-2xl font-black">裁判端</h1><p className="!mt-2 text-sm text-slate-500">你好，{session.user.name || session.user.username}。请先扫描赛事二维码获得授权，再选择场地查看比赛。</p></div>
        <div className="flex flex-wrap gap-2">
          <Button size="large" type="primary" icon={<ScanOutlined />} href="/referee/scan">扫码执裁</Button>
          <Button size="large" icon={<UserOutlined />} href="/account">账户设置</Button>
          <Button size="large" icon={<LogoutOutlined />} onClick={() => signOut({ callbackUrl: '/' })}>退出</Button>
        </div>
      </header>
      <div className="flex items-center justify-between"><h2 className="text-xl font-black">已授权赛事</h2><Button icon={<ReloadOutlined />} loading={loading} onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>刷新</Button></div>
      {error && <Alert type="error" title={error} showIcon />}
      {loading ? <div className="!py-10 text-center"><Spin /></div> : tournaments.length ? <section className="flex flex-col gap-3">
        {tournaments.map((tournament) => <Link key={tournament.id} href={`/referee/tournaments/${encodeURIComponent(tournament.id)}`} className="flex items-center justify-between gap-4 rounded-2xl border border-blue-100 bg-white !p-5 shadow-sm hover:border-blue-400">
          <div><h3 className="font-black">{tournament.name}</h3><p className="!mt-2 text-sm text-slate-500">{tournament.courtCount} 个场地 · 点击选择场地</p></div><Tag color="green">已授权</Tag>
        </Link>)}
      </section> : <section className="flex flex-col items-center gap-5 rounded-2xl border border-blue-100 bg-white !p-8">
        <Empty description="尚未获得赛事授权，请先扫描该赛事二维码" />
        <Button type="primary" size="large" href="/referee/scan">扫描赛事二维码</Button>
      </section>}
    </div>
  </main>;
}
