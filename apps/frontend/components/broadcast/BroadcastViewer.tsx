'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowsAltOutlined, FullscreenExitOutlined, FullscreenOutlined, ShrinkOutlined } from '@ant-design/icons';
import { Alert, Card, Space, Tag, Typography } from 'antd';
import { BROADCAST_STATUS_LABELS, type PublicBroadcast } from '@/lib/broadcast-types';
import { BroadcastOverlay } from './BroadcastOverlay';
import { LivePlayer } from './LivePlayer';
import { LiveProgramPlayer } from './LiveProgramPlayer';
import styles from './BroadcastViewer.module.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const STATUS_COLORS: Record<PublicBroadcast['status'], string> = {
  READY: 'default', LIVE: 'red', INTERRUPTED: 'orange', ENDED: 'default',
};

export function BroadcastViewer({ broadcastId }: { broadcastId: string }) {
  const [broadcast, setBroadcast] = useState<PublicBroadcast | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      // Public read: no session token, so a logged-out viewer is never
      // redirected to the login page.
      const response = await fetch(`${API_BASE}/public/broadcasts/${encodeURIComponent(broadcastId)}`, { cache: 'no-store' });
      if (response.status === 404) { setBroadcast(null); setError('直播间不存在或未公开'); return; }
      if (!response.ok) throw new Error('load failed');
      setBroadcast(await response.json() as PublicBroadcast);
      setError('');
    } catch {
      setError('直播信息加载失败，正在重试');
    }
  }, [broadcastId]);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    // Status and playback address change on the operator's side, not per score.
    const interval = setInterval(() => void load(), 3000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(initial); clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const match = broadcast?.currentMatch ?? null;
  const playback = broadcast?.playbackUrl
    ? new URL(broadcast.playbackUrl, new URL(API_BASE).origin).toString()
    : null;

  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <div>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            {broadcast?.title ?? '赛事视频直播'}
          </Typography.Title>
          <Space size={8} wrap>
            {broadcast && <Tag color={STATUS_COLORS[broadcast.status]}>{BROADCAST_STATUS_LABELS[broadcast.status]}</Tag>}
            {broadcast && <Typography.Text type="secondary">{broadcast.tournament.name}</Typography.Text>}
            {broadcast?.venueName && <Typography.Text type="secondary">{broadcast.venueName}</Typography.Text>}
          </Space>
        </div>

        {error && <Alert type="warning" showIcon message={error} />}

        {broadcast && (
          <>
            {broadcast.status === 'READY' && <Alert type="info" showIcon message="正在等待直播画面，开始后将自动播放。" />}
            {broadcast.status === 'INTERRUPTED' && <Alert type="warning" showIcon message="信号暂时中断，正在尝试恢复。" />}
            {broadcast.status === 'ENDED' && <Alert type="info" showIcon message="本场直播已结束。" />}
            <ViewerPlayer>
              {broadcast.status === 'LIVE' ? <>
                {broadcast.mediaMode === 'livekit' ? <LiveProgramPlayer broadcastId={broadcast.id} /> : <LivePlayer src={playback} fillFrame />}
                {(playback || broadcast.mediaMode === 'livekit') && <BroadcastOverlay broadcastId={broadcast.id} />}
              </> : <LivePlayer src={null} fillFrame placeholder={broadcast.status === 'ENDED' ? '直播已结束' : broadcast.status === 'INTERRUPTED' ? '信号暂时中断' : '待开始'} />}
            </ViewerPlayer>
            {match && (
              <Card size="small" title={`${match.eventName} · ${match.round}`}>
                <Space orientation="vertical" size={4}>
                  <Typography.Text strong>{match.side1Name}　vs　{match.side2Name}</Typography.Text>
                  {match.venueName && <Typography.Text type="secondary">{match.venueName}</Typography.Text>}
                </Space>
              </Card>
            )}
            <Typography.Text type="secondary">
              {broadcast.mediaMode === 'livekit'
                ? '画面上的比分与裁判记分实时同步；切换机位时，比分和主音频独立保持。'
                : '画面上的比分由本页实时叠加，与裁判记分同步；抖音等外部平台收到的是原始画面，不含比分。'}
            </Typography.Text>
          </>
        )}
      </div>
    </main>
  );
}

function ViewerPlayer({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [displayHint, setDisplayHint] = useState('');
  const immersive = expanded || fullscreen;

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  useEffect(() => {
    if (!immersive) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) {
        setExpanded(false);
        setDisplayHint('');
        expandButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [immersive]);

  async function toggleExpanded() {
    setDisplayHint('');
    if (fullscreen) {
      try { await document.exitFullscreen(); }
      catch { setDisplayHint('请按 Esc 退出全屏'); return; }
    }
    setExpanded(!immersive);
  }

  async function toggleFullscreen() {
    setDisplayHint('');
    try {
      if (document.fullscreenElement === frameRef.current) await document.exitFullscreen();
      else if (frameRef.current?.requestFullscreen) await frameRef.current.requestFullscreen();
      else throw new Error('Fullscreen unavailable');
    } catch {
      // Keep the score overlay visible on browsers without element fullscreen.
      setExpanded(true);
      setDisplayHint('当前浏览器已使用网页放大模式');
    }
  }

  return (
    <section
      ref={frameRef}
      className={styles.player}
      data-broadcast-player
      data-expanded={immersive}
      aria-label="赛事直播播放器"
    >
      <div className={styles.playerViewport}>
        <div className={styles.videoFrame} data-broadcast-video-frame>
          {children}
        </div>
      </div>
      <div className={styles.controls}>
        <span className={styles.displayHint} role="status">{displayHint || '画面自动适应窗口'}</span>
        <div className={styles.actions}>
          <button ref={expandButtonRef} type="button" aria-pressed={immersive} onClick={() => void toggleExpanded()}>
            {immersive ? <ShrinkOutlined aria-hidden="true" /> : <ArrowsAltOutlined aria-hidden="true" />}
            {immersive ? '适应网页' : '放大观看'}
          </button>
          <button type="button" onClick={() => void toggleFullscreen()}>
            {fullscreen ? <FullscreenExitOutlined aria-hidden="true" /> : <FullscreenOutlined aria-hidden="true" />}
            {fullscreen ? '退出全屏' : '全屏观看'}
          </button>
        </div>
      </div>
    </section>
  );
}
