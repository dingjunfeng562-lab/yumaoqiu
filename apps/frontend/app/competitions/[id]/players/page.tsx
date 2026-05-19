'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type Competition = {
  id: string;
  title: string;
  location?: string | null;
};

type Player = {
  id: string;
  name: string;
  className: string;
  eventName: string;
  createdAt: string;
  statusLabel: string;
};

type PlayersResponse = {
  players: Player[];
  groups: {
    mensSingles: Player[];
    womensSingles: Player[];
  };
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CompetitionPlayersPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [data, setData] = useState<PlayersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let alive = true;
    async function loadPlayers() {
      setLoading(true);
      setError('');
      try {
        const [competitionRes, playersRes] = await Promise.all([
          fetch(`${API_BASE}/competitions/${id}`, { cache: 'no-store' }),
          fetch(`${API_BASE}/competitions/${id}/players`, { cache: 'no-store' }),
        ]);
        if (!competitionRes.ok || !playersRes.ok) throw new Error('选手列表加载失败');
        const [competitionData, playersData] = await Promise.all([
          competitionRes.json(),
          playersRes.json(),
        ]);
        if (!alive) return;
        setCompetition(competitionData);
        setData(playersData);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '选手列表加载失败');
      } finally {
        if (alive) setLoading(false);
      }
    }
    loadPlayers();
    return () => {
      alive = false;
    };
  }, [id]);

  const hasPlayers = Boolean(data?.players.length);

  return (
    <PortalFeaturePage
      activeHref="/competitions"
      eyebrow="Players"
      title="参赛选手列表"
      description="这里只展示当前赛事中已通过管理员审核的报名人员，待审核和已拒绝报名不会出现在这里。"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-950">{competition?.title ?? '赛事选手'}</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {competition?.location || '地点待公布'}
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/competitions/${id}/register`}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-amber-400 px-4 text-sm font-black text-white"
          >
            立即报名
          </Link>
          <Link
            href="/competitions"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-blue-200 px-4 text-sm font-black text-blue-700"
          >
            返回赛事列表
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-blue-100 bg-white p-8 text-sm font-semibold text-slate-500 shadow-sm">
          选手列表加载中...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-sm font-bold text-red-600">
          {error}
        </div>
      ) : hasPlayers ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <PlayerGroup title="男子单打" players={data?.groups.mensSingles ?? []} />
          <PlayerGroup title="女子单打" players={data?.groups.womensSingles ?? []} />
        </div>
      ) : (
        <div className="rounded-lg border border-blue-100 bg-white p-10 text-center shadow-sm">
          <h3 className="text-xl font-black text-slate-950">暂无已通过审核的参赛选手。</h3>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            报名通过管理员审核后，会显示在对应项目列表中。
          </p>
        </div>
      )}
    </PortalFeaturePage>
  );
}

function PlayerGroup({ title, players }: { title: string; players: Player[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-blue-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-blue-50 bg-blue-50 px-5 py-4">
        <h3 className="text-lg font-black text-blue-900">{title}</h3>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-blue-700">
          {players.length} 人
        </span>
      </div>
      {players.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-white text-xs font-black uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">姓名</th>
                <th className="px-5 py-3">班级</th>
                <th className="px-5 py-3">参赛项目</th>
                <th className="px-5 py-3">报名时间</th>
                <th className="px-5 py-3">审核状态</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.id} className="border-t border-blue-50">
                  <td className="px-5 py-4 font-bold text-slate-900">{player.name}</td>
                  <td className="px-5 py-4 text-slate-600">{player.className}</td>
                  <td className="px-5 py-4 text-slate-600">{player.eventName}</td>
                  <td className="px-5 py-4 text-slate-600">{formatDateTime(player.createdAt)}</td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black text-green-700">
                      {player.statusLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-6 text-sm font-semibold text-slate-500">该项目暂无已通过审核的参赛选手。</p>
      )}
    </section>
  );
}
