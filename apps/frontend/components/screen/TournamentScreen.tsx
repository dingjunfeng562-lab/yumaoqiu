'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import { useSession } from 'next-auth/react';
import { SettingOutlined } from '@ant-design/icons';
import { defaultScreenSettings, readLocalScreenSettings, screenLayout, type ScreenSettings } from '@/lib/screen-settings';
import { TournamentScreenSettings } from './TournamentScreenSettings';
import styles from './TournamentScreen.module.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const EVENT_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打', WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打', WOMENS_DOUBLES: '女子双打', MIXED_DOUBLES: '混合双打',
};

type Side = { players: { name: string; affiliation: string }[]; teamName: string | null };
type Game = { gameNo: number; side1Score: number; side2Score: number; winnerSide: number | null };
type ScreenMatch = {
  id: string; status: 'LIVE' | 'PENDING'; round: string; matchNo: number;
  eventType: string | null; side1: Side; side2: Side; games: Game[]; currentGame: Game | null;
};
type ScreenData = {
  tournament: { id: string; name: string };
  courts: { id: string; name: string; match: ScreenMatch | null }[];
  generatedAt: string;
  settings?: ScreenSettings | null;
};

function Affiliation({ name }: { name: string }) {
  const length = Array.from(name).length;
  if (length <= 8) return <span className={styles.affiliation}>{name}</span>;

  return (
    <span className={`${styles.affiliation} ${styles.scrollingAffiliation}`} title={name}>
      <span
        className={styles.affiliationTrack}
        style={{ '--scroll-duration': `${Math.max(10, length * 0.7)}s` } as CSSProperties}
      >
        <span>{name}</span>
        <span aria-hidden="true">{name}</span>
      </span>
    </span>
  );
}

function CourtCard({ id, children }: { id: string; children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    let frame = 0;
    const fit = () => {
      const scale = Math.min(1, viewport.clientWidth / Math.max(1, content.scrollWidth), viewport.clientHeight / Math.max(1, content.scrollHeight));
      content.style.transform = `translateX(${viewport.clientWidth * (1 - scale) / 2}px) scale(${scale})`;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    observer.observe(content);
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  return <article className={styles.court} data-court-id={id}>
    <div className={styles.cardViewport} ref={viewportRef}>
      <div className={styles.cardContent} ref={contentRef}>{children}</div>
    </div>
  </article>;
}

function SideRow({ side, score }: { side: Side; score: number | null }) {
  return (
    <div className={styles.side}>
      <div className={styles.players}>
        {side.players.length ? side.players.map((player, index) => (
          <div className={styles.player} key={index}>
            <Affiliation name={player.affiliation || side.teamName || '—'} />
            <strong className={styles.name}>{player.name}</strong>
          </div>
        )) : <strong className={styles.undecided}>选手待定</strong>}
      </div>
      <strong className={styles.score}>{score ?? '—'}</strong>
    </div>
  );
}

export function TournamentScreen({ tournamentId }: { tournamentId: string }) {
  const { data: session } = useSession();
  const canSaveGlobally = !session?.authError && ['ADMIN', 'ROOT'].includes(session?.user?.role ?? '');
  const settingsToken = canSaveGlobally ? session?.user?.accessToken as string | undefined : undefined;
  const [data, setData] = useState<ScreenData | null>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const viewportRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLElement>(null);
  const titleViewportRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [localSettings, setLocalSettings] = useState(() => readLocalScreenSettings(tournamentId));
  const [draftSettings, setDraftSettings] = useState<ScreenSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const count = data?.courts.length ?? 0;
  const displaySettings = draftSettings ?? localSettings ?? data?.settings;
  const { columns, rows } = screenLayout(count, displaySettings);
  const requestedScale = (displaySettings?.scale ?? 100) / 100;
  const cardWidth = displaySettings?.cardWidth ?? 560;
  const cardHeight = displaySettings?.cardHeight ?? 360;

  useEffect(() => {
    const viewport = titleViewportRef.current;
    const title = titleRef.current;
    if (!viewport || !title) return;
    let frame = 0;
    const fit = () => {
      const scale = Math.min(1, viewport.clientWidth / Math.max(1, title.scrollWidth), viewport.clientHeight / Math.max(1, title.offsetHeight));
      title.style.transform = `scale(${scale})`;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    observer.observe(title);
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  function closeSettings() { setSettingsOpen(false); setDraftSettings(null); }
  function saveSettings(settings: ScreenSettings) {
    if (settingsToken) {
      setData((current) => current && { ...current, settings });
      setLocalSettings(null);
      try { localStorage.removeItem(`tournament-screen:${tournamentId}`); } catch { /* Server save succeeded. */ }
    } else {
      localStorage.setItem(`tournament-screen:${tournamentId}`, JSON.stringify(settings));
      setLocalSettings(settings);
    }
  }

  useEffect(() => {
    const viewport = viewportRef.current;
    const grid = gridRef.current;
    if (!viewport || !grid) return;
    let frame = 0;
    const fit = () => {
      // Lay out at the requested size, then fit the complete board into the
      // remaining viewport. No courts are paginated or clipped by zooming.
      const scale = Math.min(requestedScale, viewport.clientWidth / Math.max(1, grid.offsetWidth),
        viewport.clientHeight / Math.max(1, grid.offsetHeight));
      grid.style.transform = `translate(-50%, -50%) scale(${Math.max(0, scale)})`;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    observer.observe(grid);
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [count, columns, rows, requestedScale, cardWidth, cardHeight]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let queued = false;
    let controller: AbortController | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (disposed) return;
      if (inFlight) { queued = true; return; }
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10000);
      try {
        const response = await fetch(`${API_BASE}/public/tournaments/${encodeURIComponent(tournamentId)}/screen`, {
          cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 404) {
          if (!disposed) { setData(null); setError('赛事不存在、已下架或尚未发布'); }
          return;
        }
        if (!response.ok) throw new Error('refresh failed');
        const next = await response.json() as ScreenData;
        if (!disposed) { setData(next); setError(''); }
      } catch {
        if (!disposed) setError('连接中断，正在重试；当前比分可能已过期');
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (queued && !disposed) { queued = false; void refresh(); }
      }
    };
    const scheduleRefresh = () => {
      if (debounce) return;
      debounce = setTimeout(() => { debounce = undefined; void refresh(); }, 120);
    };
    const socket = io(`${API_BASE.replace(/\/api\/?$/, '')}/scores`, {
      transports: ['websocket', 'polling'],
    });
    socket.on('connect', () => { setConnected(true); void refresh(); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('scoreboard:update', scheduleRefresh);
    socket.on('bracket:update', scheduleRefresh);
    // Covers scheduling changes, missed events, and disconnected sockets.
    const interval = setInterval(() => void refresh(), 5000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    void refresh();
    return () => {
      disposed = true;
      clearInterval(interval);
      clearTimeout(debounce);
      controller?.abort();
      socket.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tournamentId]);

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError('');
    } catch { setFullscreenError('无法进入全屏，请使用浏览器全屏功能（F11）'); }
  }

  return (
    <main className={styles.screen} data-settings-open={settingsOpen} style={{ '--boundary-padding': `${displaySettings?.boundaryPadding ?? 28}px` } as CSSProperties}>
      <header className={styles.header}>
        <div ref={titleViewportRef} className={styles.titleViewport}>
          <h1 ref={titleRef} style={data && displaySettings ? { fontSize: displaySettings.titleFontSize } : undefined}>{data?.tournament.name ?? (error ? '赛事大屏暂不可用' : '正在加载赛事…')}</h1>
        </div>
        <div className={styles.toolbar}>
          <span className={error ? styles.warning : styles.sync} role="status">
            {error || (data ? connected ? '● 实时同步' : '● 定时同步' : '连接中…')}
          </span>
          <button type="button" onClick={toggleFullscreen}>{fullscreen ? '退出全屏' : '全屏显示'}</button>
        </div>
        {fullscreenError && <p className={styles.warning} role="alert">{fullscreenError}</p>}
      </header>
      {data && count > 0 ? (
        <div ref={viewportRef} className={styles.courtViewport} data-screen-boundary>
        <section
          ref={gridRef}
          className={styles.courts}
          aria-label="场地比分"
          data-requested-scale={displaySettings?.scale ?? 100}
          style={{ '--columns': columns, '--rows': rows, '--card-width': `${cardWidth}px`, '--card-height': `${cardHeight}px`, '--card-font-scale': (displaySettings?.cardFontScale ?? 100) / 100 } as CSSProperties}
        >
          {data.courts.map((court) => {
            const match = court.match;
            const live = match?.status === 'LIVE';
            return (
              <CourtCard key={court.id} id={court.id}>
                <div className={styles.courtHeader}>
                  <h2>{court.name}</h2>
                  <span className={live ? styles.live : styles.pending}>{live ? '进行中' : match ? '待开始' : '空闲'}</span>
                </div>
                {match ? <>
                  <p className={styles.matchInfo}>
                    {EVENT_LABELS[match.eventType ?? ''] ?? '比赛'} · {match.round} · 第 {match.matchNo} 场
                  </p>
                  <div className={styles.labels}><span>单位</span><span>姓名</span><span>分数</span></div>
                  <div className={styles.sides}>
                    <SideRow side={match.side1} score={live ? match.currentGame?.side1Score ?? 0 : 0} />
                    <SideRow side={match.side2} score={live ? match.currentGame?.side2Score ?? 0 : 0} />
                  </div>
                  <div className={styles.gameInfo}>
                    {live ? <>
                      <span>第 {match.currentGame?.gameNo ?? 1} 局</span>
                      <span>局分 {match.games.filter((game) => game.winnerSide === 1).length} : {match.games.filter((game) => game.winnerSide === 2).length}</span>
                    </> : <span>下一场 · 等待开赛</span>}
                  </div>
                </> : <div className={styles.emptyCourt}>等待下一场比赛</div>}
              </CourtCard>
            );
          })}
        </section>
        </div>
      ) : <div className={styles.empty}>{data ? '暂未设置比赛场地' : error || '正在读取场地与比分'}</div>}
      {data && <>
        <div className={styles.settingsCorner}>
          <button className={styles.settingsTrigger} type="button" aria-label="打开大屏设置" aria-expanded={settingsOpen}
            onClick={(event) => {
              event.currentTarget.blur();
              if (settingsOpen) closeSettings();
              else { setDraftSettings(displaySettings ?? defaultScreenSettings(count)); setSettingsOpen(true); }
            }}
          ><SettingOutlined /> 大屏设置</button>
        </div>
        {settingsOpen && draftSettings && <TournamentScreenSettings
          tournamentId={tournamentId} settings={draftSettings} defaults={defaultScreenSettings(count)} courtCount={count}
          token={settingsToken} onChange={setDraftSettings} onSaved={saveSettings} onClose={closeSettings}
        />}
      </>}
    </main>
  );
}
