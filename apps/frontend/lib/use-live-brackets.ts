'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { KnockoutBracketData } from '@/components/bracket/KnockoutBracket';
import {
  BracketPatchLog,
  fetchPublicBrackets,
  patchBracketMatch,
  replaceTournamentBrackets,
  type BracketMatchPush,
  type BracketUpdatePush,
} from './live-brackets';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');

type Options = {
  /** Tournament this view shows. Refetches load only it; null loads all. */
  tournamentId: string | null;
  /** Safety-net refetch interval. Socket pushes are the primary channel. */
  pollMs?: number;
  onSocketState?: (state: 'synced' | 'offline') => void;
  onRefetchError?: () => void;
};

/**
 * Live public brackets for the visitor-facing bracket / live-screen pages.
 *
 * - Score changes arrive as `bracket:match` pushes and patch that one match
 *   card in place. No refetch happens. That's the bulk of match-day traffic,
 *   which used to re-download every bracket on every point.
 * - Structural changes (`bracket:update`: advances, forfeits, clears), a
 *   reconnect after a dropped socket, and the poll refetch only this
 *   tournament. Refetches are coalesced so at most one is in flight.
 *
 * The admin tournament screen (/live-screen/[id]) does NOT use this. It keeps
 * its own scoreboard:update handling.
 */
export function useLiveBrackets(
  initial: KnockoutBracketData[],
  { tournamentId, pollMs, onSocketState, onRefetchError }: Options,
) {
  const [brackets, setBrackets] = useState(initial);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());

  // Latest values for socket/interval callbacks that are bound once. Synced in
  // an effect (declared first, so it runs before the effects below).
  const scopeRef = useRef(tournamentId);
  const callbacksRef = useRef({ onSocketState, onRefetchError });
  useEffect(() => {
    scopeRef.current = tournamentId;
    callbacksRef.current = { onSocketState, onRefetchError };
  });

  const patchLogRef = useRef(new BracketPatchLog());
  const syncRef = useRef({ running: false, rerun: false });

  const reload = useCallback(async () => {
    const sync = syncRef.current;
    if (sync.running) {
      sync.rerun = true;
      return;
    }
    sync.running = true;
    const patchLog = patchLogRef.current;
    try {
      do {
        sync.rerun = false;
        const scope = scopeRef.current;
        const mark = patchLog.mark();
        try {
          const fresh = await fetchPublicBrackets(scope);
          setBrackets((prev) =>
            patchLog.reapply(scope ? replaceTournamentBrackets(prev, scope, fresh) : fresh, mark),
          );
          patchLog.prune(mark);
          setUpdatedAt(new Date());
        } catch {
          callbacksRef.current.onRefetchError?.();
        }
      } while (sync.rerun);
    } finally {
      sync.running = false;
    }
  }, []);

  useEffect(() => {
    const socket: Socket = io(`${SOCKET_BASE}/scores`, {
      transports: ['polling', 'websocket'],
      withCredentials: true,
    });
    let connectedBefore = false;
    socket.on('connect', () => {
      callbacksRef.current.onSocketState?.('synced');
      // Pushes sent while we were disconnected are lost; catch up once.
      if (connectedBefore) void reload();
      connectedBefore = true;
    });
    socket.on('disconnect', () => callbacksRef.current.onSocketState?.('offline'));
    socket.on('connect_error', () => callbacksRef.current.onSocketState?.('offline'));

    socket.on('bracket:match', (push: BracketMatchPush) => {
      if (!push?.matchId) return;
      if (!push.match) {
        if (!scopeRef.current || push.tournamentId === scopeRef.current) void reload();
        return;
      }
      if (syncRef.current.running) patchLogRef.current.record(push);
      setBrackets((prev) => patchBracketMatch(prev, push));
      setUpdatedAt(new Date());
    });

    socket.on('bracket:update', (payload: BracketUpdatePush) => {
      // Best-effort filter: another tournament's bracket change needn't refetch ours.
      if (payload?.tournamentId && scopeRef.current && payload.tournamentId !== scopeRef.current) return;
      void reload();
    });

    return () => {
      socket.disconnect();
    };
  }, [reload]);

  useEffect(() => {
    if (!pollMs) return;
    const timer = window.setInterval(() => void reload(), pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, reload]);

  // Switching tournaments (live screen selector): load the newly shown one.
  const mountedScopeRef = useRef(tournamentId);
  useEffect(() => {
    if (mountedScopeRef.current === tournamentId) return;
    mountedScopeRef.current = tournamentId;
    void reload();
  }, [tournamentId, reload]);

  return { brackets, updatedAt, reload };
}
