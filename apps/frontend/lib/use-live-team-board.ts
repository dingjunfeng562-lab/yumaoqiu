'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { fetchTeamBoard, type TeamBoardCompetition } from './team-board';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');
/** 兜底刷新间隔；平时靠计分推送更新，页面不可见时不刷新。 */
const POLL_MS = 60_000;

/** scoreboard:update 推送里用得到的字段（裁判端每记一分都会推）。 */
type ScorePush = {
  id?: string;
  status?: string;
  winnerSide?: number | null;
  forfeitedSide?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  matchPaused?: boolean;
  games?: Array<{ gameNo: number; side1Score: number; side2Score: number; winnerSide: number | null }>;
};

function findChild(competitions: TeamBoardCompetition[], id: string) {
  for (const competition of competitions) {
    for (const encounter of competition.encounters) {
      const child = encounter.children.find((item) => item.id === id);
      if (child) return child;
    }
  }
  return null;
}

/** 把一条计分推送里的比分写进对应子项，其它数据不动。 */
function patchChild(competitions: TeamBoardCompetition[], push: ScorePush): TeamBoardCompetition[] {
  let changed = false;
  const next = competitions.map((competition) => {
    let competitionChanged = false;
    const encounters = competition.encounters.map((encounter) => {
      const index = encounter.children.findIndex((child) => child.id === push.id);
      if (index < 0) return encounter;
      competitionChanged = true;
      const children = encounter.children.slice();
      const child = children[index];
      children[index] = {
        ...child,
        status: push.status ?? child.status,
        winnerSide: push.winnerSide !== undefined ? push.winnerSide : child.winnerSide,
        forfeitedSide: push.forfeitedSide !== undefined ? push.forfeitedSide : child.forfeitedSide,
        startedAt: push.startedAt === undefined ? child.startedAt : push.startedAt,
        finishedAt: push.finishedAt === undefined ? child.finishedAt : push.finishedAt,
        matchPaused: push.matchPaused ?? child.matchPaused,
        games: push.games
          ? push.games.map((game) => ({ gameNo: game.gameNo, side1Score: game.side1Score, side2Score: game.side2Score, winnerSide: game.winnerSide }))
          : child.games,
      };
      return { ...encounter, children };
    });
    if (!competitionChanged) return competition;
    changed = true;
    return { ...competition, encounters };
  });
  return changed ? next : competitions;
}

/**
 * 团体赛对阵表的实时数据。
 * - 子项每记一分：直接用推送里的比分改这一个子项，不重新拉取。
 * - 子项开赛或结束（出场名单、团体总比分、积分榜会变）、对阵变化、断线重连：重新拉取本赛事的团体赛。
 */
export function useLiveTeamBoard(initial: TeamBoardCompetition[], tournamentId: string) {
  const [competitions, setCompetitions] = useState(initial);
  const competitionsRef = useRef(competitions);
  useEffect(() => {
    competitionsRef.current = competitions;
  });

  const syncRef = useRef({ running: false, rerun: false, patches: null as Map<string, ScorePush> | null });
  const reload = useCallback(async () => {
    const sync = syncRef.current;
    if (sync.running) {
      sync.rerun = true;
      return;
    }
    sync.running = true;
    try {
      do {
        sync.rerun = false;
        const patches = new Map<string, ScorePush>();
        sync.patches = patches;
        try {
          const fresh = await fetchTeamBoard(tournamentId);
          setCompetitions([...patches.values()].reduce(patchChild, fresh));
        } catch {
          // 网络抖动时保留当前数据，下一次推送或兜底刷新再取。
        }
      } while (sync.rerun);
    } finally {
      sync.running = false;
      sync.patches = null;
    }
  }, [tournamentId]);

  const timerRef = useRef<number | null>(null);
  const scheduleReload = useCallback((delay: number) => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void reload();
    }, delay);
  }, [reload]);
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    const socket: Socket = io(`${SOCKET_BASE}/scores`, { transports: ['polling', 'websocket'], withCredentials: true });
    socket.on('connect', () => {
      // 补上服务端渲染后或断线期间丢失的更新。
      scheduleReload(0);
    });
    socket.on('scoreboard:update', (push: ScorePush) => {
      if (!push?.id) return;
      const patches = syncRef.current.patches;
      if (patches) patches.set(push.id, { ...patches.get(push.id), ...push });
      const current = findChild(competitionsRef.current, push.id);
      if (!current) return;
      const structural = (push.status !== undefined && push.status !== current.status)
        || (push.forfeitedSide !== undefined && push.forfeitedSide !== current.forfeitedSide);
      setCompetitions((prev) => patchChild(prev, push));
      if (structural) scheduleReload(1500);
    });
    socket.on('bracket:update', (payload: { tournamentId?: string | null }) => {
      if (payload?.tournamentId && payload.tournamentId !== tournamentId) return;
      scheduleReload(800);
    });
    return () => {
      socket.disconnect();
    };
  }, [tournamentId, scheduleReload]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    const timer = window.setInterval(refreshIfVisible, POLL_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [reload]);

  return competitions;
}
