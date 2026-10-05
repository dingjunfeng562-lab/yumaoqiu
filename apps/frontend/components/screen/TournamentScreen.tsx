'use client';

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import { useSession } from 'next-auth/react';
import { SettingOutlined } from '@ant-design/icons';
import { defaultScreenSettings, readLocalScreenSettings, SCREEN_FONT_BOOST, screenCardFontScale, screenCardHeight, screenCardWidth, screenLayout, type BoardViewport, type ScreenSettings } from '@/lib/screen-settings';
import { TournamentScreenSettings } from './TournamentScreenSettings';
import styles from './TournamentScreen.module.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type Side = { players: { name: string; affiliation: string }[]; teamName: string | null };
type Game = { gameNo: number; side1Score: number; side2Score: number; winnerSide: number | null };
type ScreenMatch = {
  id: string; status: 'LIVE' | 'PENDING'; gamesToWin: number;
  side1: Side; side2: Side; games: Game[]; currentGame: Game | null;
};
type ScreenData = {
  tournament: { id: string; name: string };
  courts: { id: string; name: string; match: ScreenMatch | null }[];
  generatedAt: string;
  settings?: ScreenSettings | null;
};

/**
 * Unit name. It always stays on one row: as soon as the text is wider than the
 * column the name scrolls horizontally instead of wrapping. The width is
 * measured with the real computed font, so it keeps working when the card font
 * size changes.
 */
function Affiliation({ name, fontScale }: { name: string; fontScale: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const context = document.createElement('canvas').getContext('2d');
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const current = ref.current;
        if (!current || !context) return;
        const style = getComputedStyle(current);
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const needed = context.measureText(name).width;
        setScrolling((previous) => {
          const next = needed > current.clientWidth + 1;
          return previous === next ? previous : next;
        });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    // Web fonts change the measured width, so re-check once they are ready.
    document.fonts?.ready.then(measure).catch(() => {});
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [name, fontScale]);

  const length = Array.from(name).length;

  return (
    <span
      ref={ref}
      className={scrolling ? `${styles.affiliation} ${styles.scrollingAffiliation}` : styles.affiliation}
      title={name}
    >
      {scrolling ? (
        <span
          className={styles.affiliationTrack}
          style={{ '--scroll-duration': `${Math.max(10, length * 0.7)}s` } as CSSProperties}
        >
          <span>{name}</span>
          <span aria-hidden="true">{name}</span>
        </span>
      ) : name}
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

function SideRow({ side, score, gameWins, fontScale }: { side: Side; score: number | null; gameWins: number | null; fontScale: number }) {
  const rows = Math.max(1, side.players.length);
  return (
    <div className={styles.side} data-players={rows}>
      {side.players.length ? side.players.map((player, index) => (
        <Fragment key={index}>
          <Affiliation name={player.affiliation || side.teamName || '—'} fontScale={fontScale} />
          <strong className={styles.name}>{player.name}</strong>
        </Fragment>
      )) : <strong className={styles.undecided}>选手待定</strong>}
      <strong className={styles.matchScore} style={{ gridRow: `1 / span ${rows}` }}>{gameWins ?? '—'}</strong>
      <strong className={styles.score} style={{ gridRow: `1 / span ${rows}` }}>{score ?? '—'}</strong>
    </div>
  );
}

export function TournamentScreen({ tournamentId }: { tournamentId: string }) {
  const { data: session } = useSession();
  // Mirrors the backend gate for screen settings: ROOT, or an admin whose
  // permissions allow editing this tournament. A missing permission list means
  // the role defaults apply, which include 创建和编辑赛事 for ADMIN.
  const permissions = session?.user?.permissions;
  const canManageTournament = session?.user?.role === 'ROOT'
    || (session?.user?.role === 'ADMIN' && (permissions === undefined
      || permissions.some((key) => key === 'TOURNAMENTS' || key === 'TOURNAMENT_ADMIN')));
  const canSaveGlobally = !session?.authError && canManageTournament;
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
  // Measured board area. Until the first measurement the layout falls back to
  // the configured shape, which keeps server and first client render identical.
  const [viewport, setViewport] = useState<BoardViewport | null>(null);
  const { columns, rows } = screenLayout(count, displaySettings, viewport);
  const requestedScale = (displaySettings?.scale ?? 100) / 100;
  const cardWidth = screenCardWidth(count, displaySettings);
  const cardHeight = screenCardHeight(count, displaySettings);
  const cardFontScale = screenCardFontScale(count, displaySettings);
  // Effective zoom applied to the complete board, surfaced in the settings panel.
  const [fitPercent, setFitPercent] = useState<number | null>(null);

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
  function saveLocally(settings: ScreenSettings) {
    try { localStorage.setItem(`tournament-screen:${tournamentId}`, JSON.stringify(settings)); }
    catch { /* Storage unavailable: the draft still drives this screen until reload. */ }
    setLocalSettings(settings);
  }
  function saveSettings(settings: ScreenSettings) {
    if (settingsToken) {
      setData((current) => current && { ...current, settings });
      setLocalSettings(null);
      try { localStorage.removeItem(`tournament-screen:${tournamentId}`); } catch { /* Server save succeeded. */ }
    } else {
      saveLocally(settings);
    }
  }

  useEffect(() => {
    const viewport = viewportRef.current;
    const grid = gridRef.current;
    if (!viewport || !grid) return;
    let frame = 0;
    let rafHandle = 0;
    const measure = () => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      setViewport((current) => (current && current.width === width && current.height === height ? current : { width, height }));
    };
    const fit = () => {
      // Lay out at the requested size, then fit the complete board into the
      // remaining viewport. No courts are paginated or clipped by zooming.
      const availableWidth = viewport.clientWidth;
      const availableHeight = viewport.clientHeight;
      // A hidden or not-yet-measured viewport must never collapse the board.
      if (!availableWidth || !availableHeight) return;
      // The board always holds every venue: its natural size is
      // columns x cardWidth by rows x cardHeight, so scaling the whole board by
      // the smallest fitting ratio is what guarantees that all courts — however
      // many the tournament has — stay on screen at the same time.
      const scale = Math.min(requestedScale,
        availableWidth / Math.max(1, grid.offsetWidth),
        availableHeight / Math.max(1, grid.offsetHeight));
      if (!Number.isFinite(scale) || scale <= 0) return;
      grid.style.transform = `translate(-50%, -50%) scale(${scale})`;
      const percent = Math.round(scale * 100);
      setFitPercent((current) => (current === percent ? current : percent));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { measure(); fit(); });
    };
    // Schedule an additional fit on next frame to ensure DOM has updated
    const scheduleDelayed = () => {
      cancelAnimationFrame(rafHandle);
      rafHandle = requestAnimationFrame(() => {
        requestAnimationFrame(() => { measure(); fit(); });
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    observer.observe(grid);
    schedule();
    scheduleDelayed();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(rafHandle);
      observer.disconnect();
    };
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
    <main className={styles.screen} data-settings-open={settingsOpen} data-crowded={count > 6} style={{ '--boundary-padding': `${displaySettings?.boundaryPadding ?? 0}px`, '--font-boost': SCREEN_FONT_BOOST } as CSSProperties}>
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
          style={{ '--columns': columns, '--rows': rows, '--card-width': `${cardWidth}px`, '--card-height': `${cardHeight}px`, '--card-font-scale': (cardFontScale / 100) * SCREEN_FONT_BOOST } as CSSProperties}
        >
          {data.courts.map((court) => {
            const match = court.match;
            const live = match?.status === 'LIVE';
            const showMatchScore = match?.gamesToWin === 2;
            const side1Wins = match?.games.filter((game) => game.winnerSide === 1).length ?? 0;
            const side2Wins = match?.games.filter((game) => game.winnerSide === 2).length ?? 0;
            return (
              <CourtCard key={court.id} id={court.id}>
                <div className={styles.courtHeader}>
                  <h2>{court.name}</h2>
                </div>
                {match && <div className={styles.sides}>
                  <SideRow side={match.side1} score={live ? match.currentGame?.side1Score ?? 0 : 0} gameWins={showMatchScore ? side1Wins : null} fontScale={cardFontScale} />
                  <SideRow side={match.side2} score={live ? match.currentGame?.side2Score ?? 0 : 0} gameWins={showMatchScore ? side2Wins : null} fontScale={cardFontScale} />
                </div>}
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
              else { setDraftSettings(displaySettings ?? defaultScreenSettings(count, viewport)); setSettingsOpen(true); }
            }}
          ><SettingOutlined /> 大屏设置</button>
        </div>
        {settingsOpen && draftSettings && <TournamentScreenSettings
          tournamentId={tournamentId} settings={draftSettings} defaults={defaultScreenSettings(count, viewport)} courtCount={count} fitPercent={fitPercent} viewport={viewport}
          token={settingsToken} onChange={setDraftSettings} onSaved={saveSettings} onSavedLocally={saveLocally} onClose={closeSettings}
        />}
      </>}
    </main>
  );
}
