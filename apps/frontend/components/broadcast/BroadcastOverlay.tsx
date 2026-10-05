'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { OverlayMatch, OverlaySide, OverlaySnapshot } from '@/lib/broadcast-types';
import styles from './BroadcastOverlay.module.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const MAX_QUEUE = 40;

type Props = {
  /** OBS browser source: unguessable token, full-viewport transparent board. */
  token?: string;
  /** Website viewer page: broadcast id, board drawn inside the video frame. */
  broadcastId?: string;
  /** Admin preview: renders this snapshot and never connects. */
  preview?: OverlaySnapshot | null;
};

/** Delay queue entry: snapshots apply in receive order, never by score value. */
type Queued = { at: number; snapshot: OverlaySnapshot };

function sideRow(side: OverlaySide) {
  return side.players.length
    ? side.players
    : [{ name: side.name ?? '选手待定', affiliation: side.teamName ?? null }];
}

function currentScores(match: OverlayMatch) {
  const game = match.games.find((item) => item.gameNo === match.currentGameNo)
    ?? match.games.at(-1)
    ?? null;
  return { side1: game?.side1Score ?? 0, side2: game?.side2Score ?? 0 };
}

function statusText(match: OverlayMatch) {
  if (match.status === 'COMPLETED') return '比赛结束';
  if (match.pendingFinish) return '待裁判确认完赛';
  if (match.paused) return '暂停中';
  if (match.status === 'PENDING') return '未开赛';
  return null;
}

/**
 * The scorecard board. One component serves three callers so the delay queue,
 * ordering and styling rules cannot drift apart between them.
 */
export function BroadcastOverlay({ token, broadcastId, preview }: Props) {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot | null>(preview ?? null);
  const snapshotRef = useRef<OverlaySnapshot | null>(preview ?? null);
  const [connection, setConnection] = useState<'ok' | 'retrying' | 'revoked'>(preview ? 'ok' : 'retrying');
  // Applied state is what the board renders; it trails the latest snapshot by
  // the configured score delay.
  const [applied, setApplied] = useState<OverlaySnapshot | null>(preview ?? null);
  const queueRef = useRef<Queued[]>([]);
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // The frame is authored at 1920x1080; the viewer board is scaled to the video
  // box so a laptop and a phone show the same layout, only smaller.
  const [viewerScale, setViewerScale] = useState(0.5);

  // Settings come from the newest snapshot and apply immediately; only scores
  // wait for the delay.
  const settings = snapshot?.settings ?? applied?.settings ?? null;
  const source = token ? { path: `/broadcast-overlays/${encodeURIComponent(token)}` } : null;
  const frame = token ? 'live' : broadcastId ? 'viewer' : 'preview';

  useEffect(() => {
    if (preview) { setSnapshot(preview); snapshotRef.current = preview; setApplied(preview); }
  }, [preview]);

  useEffect(() => {
    if (preview || (!token && !broadcastId)) return;
    let disposed = false;
    let inFlight = false;
    let controller: AbortController | undefined;
    let socketRef: Socket | undefined;

    const flush = () => {
      if (disposed) return;
      clearTimeout(timerRef.current);
      const queue = queueRef.current;
      const now = Date.now();
      let next: OverlaySnapshot | undefined;
      while (queue.length && queue[0].at <= now) next = queue.shift()!.snapshot;
      if (next) setApplied(next);
      if (queue.length) timerRef.current = setTimeout(flush, Math.max(16, queue[0].at - Date.now()));
    };

    const accept = (incoming: OverlaySnapshot, immediate: boolean) => {
      if (disposed || !incoming) return;
      // Drop stale and out-of-order updates.
      if (incoming.seq <= seqRef.current) return;
      seqRef.current = incoming.seq;
      const previous = snapshotRef.current;
      setSnapshot(incoming);
      snapshotRef.current = incoming;
      setConnection('ok');
      const switched = !previous
        || previous.configVersion !== incoming.configVersion
        || previous.match?.id !== incoming.match?.id;
      const delay = incoming.settings.scoreDelaySeconds * 1000;
      if (immediate || switched || delay <= 0) {
        // Match switch / reconnect / no delay: clear the old queue so the
        // previous match's scores can never leak into the new one.
        queueRef.current = [];
        clearTimeout(timerRef.current);
        setApplied(incoming);
        return;
      }
      const queue = queueRef.current;
      queue.push({ at: Date.now() + delay, snapshot: incoming });
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
      flush();
    };

    const read = async (immediate = false) => {
      if (disposed || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10000);
      try {
        const endpoint = source
          ? `${API_BASE}${source.path}`
          : `${API_BASE}/public/broadcasts/${encodeURIComponent(broadcastId!)}/score`;
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
        if (response.status === 404 || response.status === 403) {
          // Token reset, broadcast switched off, or the tournament stopped
          // being public: clear at once instead of freezing a stale board.
          if (!disposed) {
            queueRef.current = [];
            snapshotRef.current = null;
            setSnapshot(null);
            setApplied(null);
            setConnection('revoked');
          }
          return;
        }
        if (!response.ok) throw new Error('scorecard refresh failed');
        accept(await response.json() as OverlaySnapshot, immediate);
        // A revoke disconnects the socket server-side and socket.io does not
        // reconnect on its own; once the broadcast is valid again, rejoin so
        // realtime pushes resume instead of relying on the poll.
        if (!disposed && socketRef?.disconnected) socketRef.connect();
      } catch {
        // Keep the last good board and show the configurable hint.
        if (!disposed) setConnection((current) => (current === 'revoked' ? current : 'retrying'));
      } finally {
        clearTimeout(timeout);
        inFlight = false;
      }
    };

    const socket = io(`${API_BASE.replace(/\/api\/?$/, '')}/broadcasts`, {
      transports: ['websocket', 'polling'],
    });
    socketRef = socket;
    const join = () => {
      const event = token ? 'joinOverlay' : 'joinViewer';
      const payload = token ? { token } : { broadcastId };
      socket.emit(event, payload, (reply: { ok?: boolean; snapshot?: OverlaySnapshot }) => {
        if (reply?.ok && reply.snapshot) accept(reply.snapshot, true);
        else void read(true);
      });
    };
    socket.on('connect', join);
    socket.on('disconnect', () => { if (!disposed) setConnection('retrying'); });
    socket.on('connect_error', () => void read());
    socket.on('broadcast:update', (payload: OverlaySnapshot) => accept(payload, false));
    socket.on('broadcast:config', (payload: OverlaySnapshot) => accept(payload, true));
    socket.on('broadcast:revoked', () => void read(true));

    // Fallback sync: covers missed events and a dropped socket.
    const interval = setInterval(() => void read(), 5000);
    void read(true);

    return () => {
      disposed = true;
      clearInterval(interval);
      clearTimeout(timerRef.current);
      controller?.abort();
      socket.disconnect();
    };
  }, [preview, token, broadcastId, source]);

  useEffect(() => {
    if (frame !== 'viewer') return;
    const root = rootRef.current;
    const box = root?.parentElement;
    if (!box) return;
    const measure = () => setViewerScale(box.clientWidth / 1920);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [frame]);

  const match = applied?.match ?? null;
  const anchorStyle = useMemo<CSSProperties>(() => {
    if (!settings) return {};
    const [vertical, horizontal] = settings.position.split('-');
    const style: CSSProperties = {};
    if (vertical === 'top') style.top = settings.offsetY; else style.bottom = settings.offsetY;
    if (horizontal === 'left') style.left = settings.offsetX;
    else if (horizontal === 'right') style.right = settings.offsetX;
    else { style.left = '50%'; style.transform = 'translateX(-50%)'; }
    return style;
  }, [settings]);

  if (!settings || !settings.visible) {
    return <div ref={rootRef} className={styles.root} data-broadcast-overlay={frame} aria-hidden="true" />;
  }

  const swap = settings.swapSides;
  const scores = match ? currentScores(match) : { side1: 0, side2: 0 };
  const rows = match ? [
    {
      key: 1 as 1 | 2, side: match.side1, score: scores.side1, games: match.side1Games,
      serving: match.servingSide === 1, winner: match.winnerSide === 1,
      gameScores: match.games.map((game) => ({ gameNo: game.gameNo, value: game.side1Score, won: game.winnerSide === 1 })),
    },
    {
      key: 2 as 1 | 2, side: match.side2, score: scores.side2, games: match.side2Games,
      serving: match.servingSide === 2, winner: match.winnerSide === 2,
      gameScores: match.games.map((game) => ({ gameNo: game.gameNo, value: game.side2Score, won: game.winnerSide === 2 })),
    },
  ] : [];
  const orderedRows = swap ? [...rows].reverse() : rows;
  const status = match ? statusText(match) : null;
  const anchorRight = settings.position.endsWith('right');

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-broadcast-overlay={frame}
      style={frame === 'viewer' ? ({ '--viewer-scale': viewerScale } as CSSProperties) : undefined}
    >
      <div className={styles.anchor} style={anchorStyle}>
        <div
          className={styles.board}
          data-anchor-right={anchorRight}
          style={{
            // On a phone the 1920-wide frame shrinks to ~0.19x and the text
            // would be unreadable; enlarge the board itself (not its offsets)
            // so it stays at least ~0.36x of the design size.
            '--board-scale': (settings.scale / 100) * (frame === 'viewer' ? Math.min(2.2, Math.max(1, 0.36 / viewerScale)) : 1),
            '--font-scale': settings.fontScale / 100,
          } as CSSProperties}
        >
          {settings.showTitle && (
            <div className={styles.title}>
              <span>{applied?.title ?? snapshot?.title ?? ''}</span>
              {match && <span className={styles.titleMeta}>{match.eventTypeLabel} · {match.round}</span>}
            </div>
          )}

          {match ? (
            <div className={styles.rows}>
              {orderedRows.map((row) => (
                <div key={row.key} className={styles.row} data-serving={row.serving && settings.showServe} data-winner={row.winner}>
                  <div className={styles.names}>
                    {sideRow(row.side).map((player, index) => (
                      <div key={index} className={styles.playerLine}>
                        {settings.showServe && (
                          <span className={row.serving && index === 0 ? styles.serveDot : styles.serveDotPlaceholder} />
                        )}
                        <span className={styles.playerName}>{player.name}</span>
                        {settings.showAffiliation && (
                          <span className={styles.affiliation}>{player.affiliation || row.side.teamName || ''}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {settings.showGames ? (
                    <div className={styles.games}>
                      {row.gameScores.map((game) => (
                        <span key={game.gameNo} className={styles.gameScore} data-won={game.won}>{game.value}</span>
                      ))}
                    </div>
                  ) : <div className={styles.games} />}
                  {settings.showGameWins && <div className={styles.gameWins}>{row.games}</div>}
                  <div className={styles.score}>{row.score}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.placeholder}>等待选择比赛</div>
          )}

          {(status || connection !== 'ok') && (
            <div className={styles.statusBar}>
              {status && <span>{status}</span>}
              {connection === 'retrying' && <span className={styles.statusWarn}>{settings.connectingText}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
