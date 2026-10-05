'use client';

import { useEffect, useState } from 'react';
import { ConnectionState, Room, RoomEvent } from 'livekit-client';

export type LiveControl = {
  broadcastId: string; sequence: number; status: string; live: boolean; waiting: boolean;
  activeCameraId: string | null; previewCameraId: string | null; audioCameraId: string | null;
  previousCameraId: string | null; transitionUntil: string | null;
};
export type LiveCamera = {
  id: string; code: string; name: string; paired: boolean; online: boolean; onAir: boolean; audioEnabled: boolean;
  state: { state?: string; fps?: number; bitrateKbps?: number; battery?: number; rttMs?: number; packetLoss?: number;
    networkType?: string; audioSource?: string; audioStatus?: string; audioLevelDb?: number; thermal?: string; message?: string } | null;
};
export type LiveSnapshot = LiveControl & {
  title: string; enabled: boolean; configured: boolean; canAudio: boolean; cameras: LiveCamera[];
  logs: { id: string; kind: string; fromId: string | null; toId: string | null; sequence: number; createdAt: string }[];
};
export const liveApiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export function parseControl(metadata?: string): LiveControl | null {
  try {
    const value = JSON.parse(metadata || 'null') as LiveControl | null;
    return value && Number.isInteger(value.sequence) && typeof value.broadcastId === 'string' ? value : null;
  } catch { return null; }
}

export function useLiveRoom(broadcastId: string, role: 'director' | 'viewer', token?: string) {
  const [room, setRoom] = useState<Room | null>(null);
  const [control, setControl] = useState<LiveControl | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (role === 'director' && !token) return;
    let disposed = false;
    let connecting = false;
    let current: Room | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (disposed || !current) return;
      const next = parseControl(current.metadata);
      if (next) setControl((old) => old && (old.sequence > next.sequence || JSON.stringify(old) === JSON.stringify(next)) ? old : next);
      setRevision((n) => n + 1);
    };
    const connect = async () => {
      if (disposed || connecting) return;
      connecting = true;
      try {
        const path = role === 'director' ? `/broadcasts/${broadcastId}/live/director-token` : `/public/broadcasts/${broadcastId}/live/token`;
        const response = await fetch(liveApiBase + path, { method: 'POST', cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.message || '无法连接直播间');
        }
        const config = await response.json() as { url: string; token: string; control?: LiveControl };
        if (disposed) return;
        if (config.control) setControl(config.control);
        // These players choose thumbnail vs. full-quality PGM explicitly.
        // Adaptive dimensions can override setVideoQuality() and reduce PGM to
        // the CSS element's dimensions even when the camera publishes full HD.
        current = new Room({ adaptiveStream: false, dynacast: true });
        current.on(RoomEvent.RoomMetadataChanged, () => {
          if (disposed || !current) return;
          const next = parseControl(current.metadata);
          if (next) setControl((old) => old && (old.sequence > next.sequence || JSON.stringify(old) === JSON.stringify(next)) ? old : next);
        });
        [RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.TrackSubscribed,
          RoomEvent.TrackUnsubscribed, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected].forEach((event) => current!.on(event, refresh));
        current.on(RoomEvent.Reconnecting, () => { if (!disposed) setError('网络中断，正在恢复直播连接…'); });
        current.on(RoomEvent.Reconnected, () => { if (!disposed) { setError(''); refresh(); } });
        current.on(RoomEvent.Disconnected, () => {
          if (disposed) return;
          setError('直播连接已断开，正在重新验证访问权限…');
          setRoom(null);
          retry = setTimeout(() => void connect(), 3000);
        });
        await current.connect(config.url, config.token, { autoSubscribe: false });
        if (disposed) { await current.disconnect(); return; }
        setRoom(current); setError(''); refresh();
      } catch (error) {
        if (!disposed) {
          setError(error instanceof Error ? error.message : '直播连接失败');
          current?.removeAllListeners();
          await current?.disconnect();
          retry = setTimeout(() => void connect(), 5000);
        }
      } finally { connecting = false; }
    };
    void connect();
    return () => { disposed = true; if (retry) clearTimeout(retry); current?.removeAllListeners(); void current?.disconnect(); setRoom(null); };
  }, [broadcastId, role, token]);
  return { room, control, error, revision, connected: room?.state === ConnectionState.Connected };
}
