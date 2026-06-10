'use client';

import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { KnockoutBracket, type KnockoutBracketData } from './KnockoutBracket';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const SOCKET_BASE = API_BASE.replace(/\/api$/, '');

// Single-bracket live wrapper. Used by the bracket detail page so winner
// advances / forfeits / clears (and live score ticks) re-render the bracket
// without a manual reload.
export function LiveBracket({ initial }: { initial: KnockoutBracketData }) {
  const [bracket, setBracket] = useState(initial);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/public/brackets`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { brackets?: KnockoutBracketData[] };
      const next = (data.brackets ?? []).find((item) => item.id === initial.id);
      if (next) setBracket(next);
    } catch {
      /* leave the previous bracket on transient errors */
    }
  }, [initial.id]);

  useEffect(() => {
    const socket: Socket = io(`${SOCKET_BASE}/scores`, {
      transports: ['websocket'],
      withCredentials: true,
    });
    socket.on('bracket:update', () => {
      void reload();
    });
    socket.on('scoreboard:update', () => {
      void reload();
    });
    return () => {
      socket.disconnect();
    };
  }, [reload]);

  return <KnockoutBracket data={bracket} />;
}
