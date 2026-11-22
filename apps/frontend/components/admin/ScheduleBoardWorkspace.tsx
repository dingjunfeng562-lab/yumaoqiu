'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Alert, Button, Empty, Spin } from 'antd';
import { FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons';
import { io } from 'socket.io-client';
import { apiFetch } from '@/lib/api';
import type { ScheduleMatch } from '@/lib/court-schedule';
import { CourtScheduleBoard } from './CourtScheduleBoard';
import styles from './court-schedule-board.module.css';

type Tournament = { id: string; name: string; breakMinutes: number; dailyStartTime: string };
type BoardData = {
  boardVersion: string; tournamentDays: string[]; boardGap: number; matches: ScheduleMatch[];
  venues: { id: string; name: string; isActive: boolean }[];
  undoable?: { operationId: string; version: string } | null;
};

function TournamentBoard({ token, tournament }: { token: string; tournament: Tournament }) {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState('');
  const requests = useRef({ version: 0 });
  const refresh = useCallback(async () => {
    const current = requests.current;
    const version = ++current.version;
    try {
      const next = await apiFetch<BoardData>('/scheduling?' + new URLSearchParams({ tournamentId: tournament.id }), { token });
      if (version === current.version) { setData(next); setError(''); }
    } catch (e) {
      if (version === current.version) setError(e instanceof Error ? e.message : '读取赛程失败');
    }
  }, [token, tournament.id]);
  useEffect(() => {
    const current = requests.current;
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
    const socket = io(api.replace(/\/api\/?$/, '') + '/scores', { transports: ['polling','websocket'], withCredentials:true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queue = () => {
      if (!timer) timer = setTimeout(() => { timer = undefined; void refresh(); }, 180);
    };
    queue();
    socket.on('connect', queue);
    socket.on('bracket:update', (p: { tournamentId?: string }) => { if (p.tournamentId === tournament.id) queue(); });
    window.addEventListener('focus', queue);
    return () => { ++current.version; clearTimeout(timer); socket.disconnect(); window.removeEventListener('focus',queue); };
  }, [refresh, tournament.id]);
  if (error) return <Alert type="error" showIcon title={error} action={<Button onClick={refresh}>重新读取</Button>} />;
  if (!data) return <Spin aria-label="正在读取赛程" />;
  return <CourtScheduleBoard token={token} tournamentId={tournament.id} version={data.boardVersion}
    matches={data.matches} venues={data.venues} days={data.tournamentDays}
    undoable={data.undoable ?? null}
    dailyStart={tournament.dailyStartTime ?? '08:00'} gap={data.boardGap ?? tournament.breakMinutes} refresh={refresh} />;
}

export function ScheduleBoardWorkspace({ requestedId }: { requestedId: string }) {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const workspace = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!token) return;
    let active = true;
    apiFetch<Tournament[]>('/tournaments', { token }).then(list => {
      if (active) { setTournaments(list); setError(''); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '读取赛事失败'); });
    return () => { active = false; };
  }, [token, attempt]);
  useEffect(() => {
    const sync = () => setExpanded(document.fullscreenElement === workspace.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const tournament = tournaments?.find(t => t.id === (choice || requestedId)) ?? tournaments?.[0];
  return <main className={styles.workspace} ref={workspace}>
    <header className={styles.heading}>
      <h1>场地排程表</h1>
      <div className={styles.controls}>
        {tournament && <label>赛事 <select value={tournament.id} onChange={e => {
          setChoice(e.target.value);
          const url = new URL(window.location.href); url.searchParams.set('tournamentId', e.target.value);
          window.history.replaceState(null,'',url);
        }}>{tournaments?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        <a className={styles.expand} href="/nicaiyixiahh/scheduling">返回自动排程</a>
        {typeof document !== 'undefined' && document.fullscreenEnabled && <button type="button" className={styles.expand} aria-pressed={expanded} onClick={() => {
          const action = expanded ? document.exitFullscreen() : workspace.current?.requestFullscreen();
          void action?.catch(() => {});
        }}>
          {expanded ? <FullscreenExitOutlined /> : <FullscreenOutlined />} {expanded ? '退出全屏' : '全屏'}
        </button>}
      </div>
    </header>
    {error ? <Alert type="error" title={error} action={<Button onClick={() => setAttempt(n => n + 1)}>重试</Button>} /> :
      !tournaments || !token ? <Spin aria-label="正在读取赛事" /> :
      tournament ? <TournamentBoard key={tournament.id} tournament={tournament} token={token} /> : <Empty description="暂无可管理的赛事" />}
  </main>;
}
