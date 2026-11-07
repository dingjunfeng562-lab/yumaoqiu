'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type EventType = 'MENS_SINGLES' | 'WOMENS_SINGLES' | 'MENS_DOUBLES' | 'WOMENS_DOUBLES' | 'MIXED_DOUBLES';
type EventGroupKey = 'mensSingles' | 'womensSingles' | 'mensDoubles' | 'womensDoubles' | 'mixedDoubles';

const EVENT_GROUPS: Array<{ type: EventType; key: EventGroupKey; fallbackTitle: string }> = [
  { type: 'MENS_SINGLES', key: 'mensSingles', fallbackTitle: '男子单打' },
  { type: 'WOMENS_SINGLES', key: 'womensSingles', fallbackTitle: '女子单打' },
  { type: 'MENS_DOUBLES', key: 'mensDoubles', fallbackTitle: '男子双打' },
  { type: 'WOMENS_DOUBLES', key: 'womensDoubles', fallbackTitle: '女子双打' },
  { type: 'MIXED_DOUBLES', key: 'mixedDoubles', fallbackTitle: '混合双打' },
];

type EventOption = {
  id: string;
  type: EventType;
  label: string;
  isDouble: boolean;
  entrantType?: 'SCHOOL' | 'SOCIAL';
  groupLabel?: string | null;
};

type Competition = {
  id: string;
  title: string;
  location?: string | null;
  eventOptions?: EventOption[];
};

// 公开名单只有姓名、性别、单位和打码后的联系方式（后端接口也只返回这几项）。
// 单位：学生组是学校，第三方是报名时填的单位。
type Partner = {
  name: string;
  genderLabel?: string;
  unit?: string;
  phone?: string;
};

type Player = {
  id: string;
  name: string;
  primaryName?: string;
  partner?: Partner | null;
  unit?: string;
  phone?: string;
  genderLabel?: string;
  eventId?: string;
  eventType?: string;
  eventName: string;
};

const DOUBLES_TYPES = new Set(['MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES']);

type PlayersResponse = {
  players: Player[];
  eventGroups?: Array<{ eventId: string; label: string; players: Player[] }>;
  groups: Record<EventGroupKey, Player[]>;
};

type VisiblePlayerGroup = {
  id: string;
  title: string;
  players: Player[];
};

function buildVisibleGroups(competition: Competition | null, data: PlayersResponse | null): VisiblePlayerGroup[] {
  if (competition?.eventOptions) {
    return competition.eventOptions
      .map((option) => {
        const group = EVENT_GROUPS.find((item) => item.type === option.type);
        if (!group) return null;
        return {
          id: option.id,
          title: option.label || group.fallbackTitle,
          players: data?.eventGroups?.find((item) => item.eventId === option.id)?.players
            ?? (data?.players ?? []).filter((player) => player.eventId === option.id),
        };
      })
      .filter((group): group is VisiblePlayerGroup => Boolean(group));
  }

  return EVENT_GROUPS.map((group) => ({
    id: group.type,
    title: group.fallbackTitle,
    players: data?.groups[group.key] ?? [],
  }));
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

  const visibleGroups = buildVisibleGroups(competition, data);
  const hasPlayers = Boolean(data?.players.length);
  const hasVisibleGroups = visibleGroups.length > 0;

  return (
    <PortalFeaturePage
      activeHref="/competitions"
      eyebrow="Players"
      title="参赛选手列表"
      description="这里只展示当前赛事中已通过管理员审核的报名人员，待审核和已驳回报名不会出现在这里。"
      back={{ href: `/competitions/${id}`, label: '赛事主页' }}
    >
      <div className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-black text-slate-950 sm:text-2xl">{competition?.title ?? '赛事选手'}</h2>
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
      ) : hasPlayers || hasVisibleGroups ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {visibleGroups.map((group) => (
            <PlayerGroup key={group.id} title={group.title} players={group.players} />
          ))}
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
  const isDoubles = players.some((player) => player.eventType && DOUBLES_TYPES.has(player.eventType));
  const teamCount = isDoubles ? players.length : 0;
  return (
    <section className="overflow-hidden rounded-lg border border-blue-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-blue-50 bg-blue-50 px-4 py-3.5 sm:px-5 sm:py-4">
        <h3 className="text-base font-black text-blue-900 sm:text-lg">{title}</h3>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-blue-700">
          {isDoubles ? `${teamCount} 队` : `${players.length} 人`}
        </span>
      </div>
      {players.length ? (
        isDoubles ? (
          <DoublesTable players={players} />
        ) : (
          <SinglesTable players={players} />
        )
      ) : (
        <p className="p-5 text-sm font-semibold text-slate-500 sm:p-6">该项目暂无已通过审核的参赛选手。</p>
      )}
    </section>
  );
}

const CELL = 'whitespace-nowrap px-4 py-3 sm:px-4 sm:py-4';

function PlayersTableHead() {
  return (
    <thead className="bg-white text-[11px] font-black uppercase text-slate-500 sm:text-xs">
      <tr>
        <th className="whitespace-nowrap px-4 py-2.5 sm:px-4 sm:py-3">姓名</th>
        <th className="whitespace-nowrap px-4 py-2.5 sm:px-4 sm:py-3">性别</th>
        <th className="whitespace-nowrap px-4 py-2.5 sm:px-4 sm:py-3">单位</th>
        <th className="whitespace-nowrap px-4 py-2.5 sm:px-4 sm:py-3">联系方式</th>
      </tr>
    </thead>
  );
}

function PersonCells({ name, genderLabel, unit, phone }: { name: string; genderLabel?: string; unit?: string; phone?: string }) {
  return (
    <>
      <td className={`${CELL} font-bold text-slate-900`}>{name}</td>
      <td className={`${CELL} text-slate-600`}>{genderLabel ?? '-'}</td>
      {/* 单位名称可能很长，允许换行，避免手机上把表格撑得很宽 */}
      <td className="min-w-[7rem] px-4 py-3 font-semibold text-slate-700 sm:px-4 sm:py-4">{unit || '-'}</td>
      <td className={`${CELL} tabular-nums text-slate-600`}>{phone || '-'}</td>
    </>
  );
}

function SinglesTable({ players }: { players: Player[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px] sm:text-sm">
        <PlayersTableHead />
        <tbody>
          {players.map((player) => (
            <tr key={player.id} className="border-t border-blue-50">
              <PersonCells name={player.primaryName || player.name} genderLabel={player.genderLabel} unit={player.unit} phone={player.phone} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 双打每队两行：第一行本人，第二行搭档（浅色底），队与队之间用粗分隔线。
function DoublesTable({ players }: { players: Player[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px] sm:text-sm">
        <PlayersTableHead />
        <tbody>
          {players.map((player) => (
            <Fragment key={player.id}>
              <tr className="border-t-2 border-blue-100">
                <PersonCells name={player.primaryName || player.name} genderLabel={player.genderLabel} unit={player.unit} phone={player.phone} />
              </tr>
              {player.partner ? (
                <tr className="border-t border-blue-50/60 bg-blue-50/30">
                  <PersonCells name={player.partner.name} genderLabel={player.partner.genderLabel} unit={player.partner.unit || player.unit} phone={player.partner.phone} />
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
