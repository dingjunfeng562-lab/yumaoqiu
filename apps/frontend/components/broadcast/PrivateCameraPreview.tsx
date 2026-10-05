'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Space, Typography } from 'antd';
import { apiFetch } from '@/lib/api';
import { LivePlayer } from './LivePlayer';

/** How often to look for the phone's picture while there is none yet. */
const WAIT_POLL_MS = 5000;
/** Renew the preview ticket this long before it expires. */
const RENEW_MARGIN_MS = 2 * 60_000;

/**
 * ROOT-only preview.
 *
 * While no picture is available it polls for one. Once playing, the URL is
 * left alone - swapping it reloads the player and flashes black - and the
 * ticket is only renewed shortly before it expires.
 */
export function PrivateCameraPreview({ broadcastId, token, onReady }: {
  broadcastId: string;
  token: string | undefined;
  onReady?: (ready: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [note, setNote] = useState('正在等待摄像端推流…');

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const preview = await apiFetch<{ playbackUrl: string; expiresIn?: number }>(
        `/broadcasts/${encodeURIComponent(broadcastId)}/media-preview`, { token },
      );
      // The HLS playlist can return 404 until the phone begins publishing.
      const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? window.location.origin).origin;
      const full = new URL(preview.playbackUrl, apiOrigin).toString();
      const response = await fetch(full, { cache: 'no-store' });
      if (!response.ok) throw new Error('等待画面');
      setUrl(full);
      setExpiresAt(Date.now() + (preview.expiresIn ?? 120) * 1000);
      setNote('后台私有预览。请检查画面、声音、方向，再点击“确认发布”。');
      onReady?.(true);
    } catch {
      setUrl(null);
      setNote('还没有收到手机画面。请确认媒体服务已启动、手机已扫码并按下红色推流按钮。');
      onReady?.(false);
    }
  }, [broadcastId, token, onReady]);

  // Waiting for a picture: check now, then poll.
  useEffect(() => {
    if (url) return;
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), WAIT_POLL_MS);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [url, refresh]);

  // Playing: keep the same URL, renew just before the ticket runs out.
  useEffect(() => {
    if (!url || !expiresAt) return;
    const wait = Math.max(expiresAt - Date.now() - RENEW_MARGIN_MS, 5000);
    const timer = window.setTimeout(() => void refresh(), wait);
    return () => window.clearTimeout(timer);
  }, [url, expiresAt, refresh]);

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size={8}>
      <div style={{ aspectRatio: '16 / 9', width: '100%', background: '#000', overflow: 'hidden', borderRadius: 8 }}>
        {url ? <LivePlayer src={url} /> : <div style={{ color: '#fff', display: 'grid', placeItems: 'center', height: '100%' }}>等待手机画面（16:9）</div>}
      </div>
      <Alert type={url ? 'info' : 'warning'} showIcon message={note} />
      <Button onClick={() => void refresh()}>重新检查画面</Button>
      <Typography.Text type="secondary">预览地址限时有效，媒体原站只允许服务器本机访问；观众在您确认发布前无法获取视频片段。</Typography.Text>
    </Space>
  );
}
