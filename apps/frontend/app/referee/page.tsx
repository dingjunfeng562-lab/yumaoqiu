'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { Button, Empty, Spin, Tag, message } from 'antd';
import { LogoutOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type MatchSummary = {
  id: string;
  status: 'PENDING' | 'LIVE' | 'COMPLETED';
  winnerSide?: number | null;
  round: string;
  matchNo: number;
  eventTypeLabel: string;
  tournament: { name: string; edition: number };
  venue?: { id: string; name: string } | null;
  scheduledAt?: string | null;
  side1?: { name: string; affiliation: string } | null;
  side2?: { name: string; affiliation: string } | null;
  games: Array<{ gameNo: number; side1Score: number; side2Score: number; winnerSide?: number | null }>;
};

const statusMeta: Record<MatchSummary['status'], { label: string; color: string }> = {
  PENDING: { label: '未开始', color: 'default' },
  LIVE: { label: '进行中', color: 'green' },
  COMPLETED: { label: '已结束', color: 'blue' },
};

function sideName(side?: { name: string } | null) {
  return side?.name ?? '待定';
}

function scoreLine(match: MatchSummary) {
  if (!match.games.length) return '0 : 0';
  const current = match.games.find((game) => !game.winnerSide) ?? match.games[match.games.length - 1];
  return `${current.side1Score} : ${current.side2Score}`;
}

export default function RefereeMatchesPage() {
  const { data: session, status } = useSession();
  const token = session?.user?.accessToken;
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadMatches() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<MatchSummary[]>('/referee/matches', { token });
      setMatches(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载裁判场次失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMatches();
  }, [token]);

  if (status === 'loading') {
    return <div className="grid min-h-screen place-items-center bg-slate-950 text-white"><Spin /></div>;
  }

  if (!token || session?.user?.role !== 'REFEREE') {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-5 text-white">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/10 p-6 text-center backdrop-blur">
          <h1 className="text-2xl font-black">裁判端</h1>
          <p className="mt-3 text-sm text-blue-100">请使用裁判账号登录后查看分配场次。</p>
          <Link
            href="/login"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-blue-500 px-6 text-sm font-black text-white"
          >
            去登录
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#e8f1ff] via-[#f7fbff] to-white px-4 py-5 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-col gap-3 rounded-2xl border border-blue-100 bg-white/90 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Referee Console</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">我的裁判场次</h1>
            <p className="mt-2 text-sm text-slate-500">选择当前负责的场次，进入实时记分页。</p>
          </div>
          <div className="flex gap-2">
            <Button icon={<ReloadOutlined />} onClick={loadMatches} loading={loading}>
              刷新
            </Button>
            <Button icon={<LogoutOutlined />} onClick={() => signOut({ callbackUrl: '/login' })}>
              退出
            </Button>
          </div>
        </header>

        {loading ? (
          <div className="grid min-h-60 place-items-center rounded-2xl border border-blue-100 bg-white/90">
            <Spin />
          </div>
        ) : matches.length ? (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {matches.map((match) => (
              <article key={match.id} className="rounded-2xl border border-blue-100 bg-white/92 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black text-slate-950">{match.eventTypeLabel} 第 {match.matchNo} 场</h2>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      第{match.tournament.edition}届 {match.tournament.name} · {match.round}
                    </p>
                  </div>
                  <Tag color={statusMeta[match.status].color}>{statusMeta[match.status].label}</Tag>
                </div>

                <div className="mt-5 rounded-xl bg-blue-50/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">{sideName(match.side1)}</span>
                    <strong className="shrink-0 text-2xl font-black text-blue-700">{scoreLine(match)}</strong>
                    <span className="min-w-0 flex-1 truncate text-right text-sm font-bold text-slate-700">{sideName(match.side2)}</span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-500">
                  <span>场地：{match.venue?.name ?? '未排场地'}</span>
                  <span className="text-right">
                    {match.scheduledAt ? new Date(match.scheduledAt).toLocaleString('zh-CN') : '未排时间'}
                  </span>
                </div>

                <Link
                  href={`/referee/matches/${match.id}`}
                  className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-sm font-black text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)] transition hover:-translate-y-0.5"
                >
                  进入记分
                </Link>
              </article>
            ))}
          </section>
        ) : (
          <div className="rounded-2xl border border-blue-100 bg-white/90 p-8 shadow-sm">
            <Empty description="暂无分配给你的场次" />
          </div>
        )}
      </div>
    </main>
  );
}
