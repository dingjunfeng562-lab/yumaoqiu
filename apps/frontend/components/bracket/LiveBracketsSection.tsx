'use client';

import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { KnockoutBracket, type KnockoutBracketData } from './KnockoutBracket';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const SOCKET_BASE = API_BASE.replace(/\/api$/, '');

type BracketUpdate = { tournamentId?: string | null; eventId?: string | null; matchId?: string | null };

// Live wrapper around the bracket section: keeps the server-rendered
// brackets as initial state and refetches on every bracket:update broadcast
// from the scoring service so advances / forfeits / clears show up without
// a page reload. We also listen to scoreboard:update so live scores during
// matches keep the bracket detail modal in sync.
export function LiveBracketsSection({
  tournamentId,
  initialBrackets,
}: {
  tournamentId: string;
  initialBrackets: KnockoutBracketData[];
}) {
  const [brackets, setBrackets] = useState(initialBrackets);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/public/brackets`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { brackets?: KnockoutBracketData[] };
      setBrackets((data.brackets ?? []).filter((bracket) => bracket.tournamentId === tournamentId));
    } catch {
      /* leave previous state on transient errors */
    }
  }, [tournamentId]);

  useEffect(() => {
    const socket: Socket = io(`${SOCKET_BASE}/scores`, {
      transports: ['websocket'],
      withCredentials: true,
    });
    socket.on('bracket:update', (payload: BracketUpdate) => {
      // Best-effort filter: a bracket update for an unrelated tournament
      // doesn't need to retrigger our fetch.
      if (payload?.tournamentId && payload.tournamentId !== tournamentId) return;
      void reload();
    });
    socket.on('scoreboard:update', () => {
      void reload();
    });
    return () => {
      socket.disconnect();
    };
  }, [reload, tournamentId]);

  if (!brackets.length) {
    return (
      <div className="rounded-xl border border-dashed border-blue-200 bg-white px-5 py-8 text-center shadow-sm sm:py-10">
        <p className="text-sm font-black text-slate-700">该赛事未发布对阵表</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          报名截止并完成抽签后,这里会自动展示完整的淘汰赛签表。
        </p>
      </div>
    );
  }

  return (
    <>
      {brackets.map((bracket) => (
        <KnockoutBracket key={bracket.id} data={bracket} />
      ))}
    </>
  );
}
