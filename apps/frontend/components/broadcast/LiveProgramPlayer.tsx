'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RoomEvent, Track, VideoQuality, type RemoteTrackPublication } from 'livekit-client';
import { useLiveRoom } from '@/lib/multicamera';

/** Two video elements protect the last rendered PGM; audio has its own lifetime. */
export function LiveProgramPlayer({ broadcastId }: { broadcastId: string }) {
  const { room, control, error, revision } = useLiveRoom(broadcastId, 'viewer');
  const videos = useRef<(HTMLVideoElement | null)[]>([null, null]);
  const frozen = useRef<HTMLCanvasElement>(null);
  const switching = useRef(false);
  const activeSlot = useRef(0);
  const shownId = useRef<string | null>(null);
  const shownTrack = useRef<RemoteTrackPublication['videoTrack'] | null>(null);
  const [visibleSlot, setVisibleSlot] = useState(0);
  const [message, setMessage] = useState('正在接入正式画面…');
  const [soundEnabled, setSoundEnabled] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const video = videos.current[activeSlot.current];
      const canvas = frozen.current;
      if (switching.current || !video || !canvas || video.readyState < 2 || !video.videoWidth) return;
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!room || !control?.activeCameraId) return;
    const targetId = control.activeCameraId;
    if (shownId.current && shownId.current !== targetId && frozen.current) {
      switching.current = true; frozen.current.style.opacity = '1';
    }
    const publication = room.remoteParticipants.get(`camera_${targetId}`)?.getTrackPublication(Track.Source.Camera);
    if (!publication?.videoTrack && shownTrack.current && frozen.current) {
      switching.current = true; frozen.current.style.opacity = '1';
    }
    if (!publication) return;
    if (shownId.current === targetId && shownTrack.current === publication.videoTrack) return;
    const oldPublication = shownId.current ? room.remoteParticipants.get(`camera_${shownId.current}`)?.getTrackPublication(Track.Source.Camera) : undefined;
    publication.setSubscribed(true); publication.setVideoQuality(VideoQuality.HIGH);
    let cancelled = false;
    let frameHandle: number | undefined;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const slot = 1 - activeSlot.current;
    const video = videos.current[slot];
    if (!video) return;
    const track = publication.videoTrack;
    const commit = () => {
      if (cancelled || video.readyState < 2 || video.videoWidth === 0) return;
      shownId.current = targetId; activeSlot.current = slot;
      shownTrack.current = track ?? null;
      switching.current = false;
      if (frozen.current) frozen.current.style.opacity = '0';
      setVisibleSlot(slot); setMessage('');
      releaseTimer = setTimeout(() => {
        if (oldPublication && oldPublication !== publication) oldPublication.setSubscribed(false);
      }, 500);
    };
    const ready = () => {
      if ('requestVideoFrameCallback' in video) frameHandle = video.requestVideoFrameCallback(commit);
      else commit();
    };
    if (track) {
      track.attach(video);
      video.addEventListener('loadeddata', ready);
      void video.play().then(ready).catch(() => { if (!cancelled) setMessage('点击画面开始播放'); });
    }
    const timeout = setTimeout(() => {
      if (shownId.current !== targetId || shownTrack.current !== track) { setMessage('新机位信号未就绪，保留上一画面'); publication.setSubscribed(false); }
    }, 7000);
    return () => {
      cancelled = true; clearTimeout(timeout);
      if (releaseTimer) { clearTimeout(releaseTimer); oldPublication?.setSubscribed(false); }
      if (frameHandle !== undefined) video.cancelVideoFrameCallback(frameHandle);
      video.removeEventListener('loadeddata', ready);
      // Keep the displayed element attached; detaching here would black out PGM.
      if (shownId.current !== targetId && track) track.detach(video);
    };
  }, [room, control?.activeCameraId, revision]);

  // 多路音频：场边主音频机位 + 导播的电脑麦克风。每个音轨一个 <audio>，
  // 浏览器会自然地把它们混成一路输出。
  const audioPublications = useMemo(() => {
    const list: RemoteTrackPublication[] = [];
    room?.remoteParticipants.forEach((participant) => {
      const isMainAudio = participant.identity === `camera_${control?.audioCameraId}`;
      const isDirector = participant.identity.startsWith('director_');
      if (!isMainAudio && !isDirector) return;
      participant.audioTrackPublications.forEach((publication) => list.push(publication));
    });
    return list;
  }, [room, control?.audioCameraId, revision]);

  useEffect(() => {
    if (!room) return;
    const allowed = new Set(audioPublications.map((publication) => publication.trackSid));
    // 订阅白名单：主音频 + 导播麦克风，其余（含残留的旧主音频）一律退订。
    room.remoteParticipants.forEach((participant) => participant.audioTrackPublications.forEach((publication) => {
      publication.setSubscribed(allowed.has(publication.trackSid));
    }));
  }, [room, audioPublications]);

  useEffect(() => {
    if (!room) return;
    const restrict = () => {
      room.remoteParticipants.forEach((p) => p.videoTrackPublications.forEach((track: RemoteTrackPublication) => {
        const id = p.identity.replace(/^camera_/, '');
        if (id !== control?.activeCameraId && id !== shownId.current) track.setSubscribed(false);
      }));
    };
    restrict(); room.on(RoomEvent.TrackPublished, restrict);
    return () => { room.off(RoomEvent.TrackPublished, restrict); };
  }, [room, control?.activeCameraId]);

  async function enableSound() {
    await room?.startAudio();
    setSoundEnabled(true);
    videos.current.forEach((video) => { void video?.play().catch(() => undefined); });
  }
  return <div style={{ position: 'absolute', inset: 0, background: '#080e17' }}>
    {[0, 1].map((slot) => <video key={slot} ref={(node) => { videos.current[slot] = node; }} autoPlay muted playsInline
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: visibleSlot === slot ? 1 : 0 }} />)}
    <canvas ref={frozen} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0, pointerEvents: 'none' }} />
    {audioPublications.map((publication) => (
      <AudioSink key={publication.trackSid} publication={publication} enabled={soundEnabled} onBlocked={() => setSoundEnabled(false)} />
    ))}
    {(error || message) && <div role="status" style={{ position: 'absolute', bottom: 12, left: 12, right: 12, color: '#fff', background: '#000a', padding: 8 }}>{error || message}</div>}
    {!soundEnabled && <button onClick={() => void enableSound()} style={{ position: 'absolute', right: 12, top: 12, zIndex: 5, minHeight: 44, padding: '8px 16px', borderRadius: 8 }}>开启声音</button>}
  </div>;
}

/** 一个音轨一个 <audio>；浏览器天然把它们混成一路声音，无需服务端混音。 */
function AudioSink({ publication, enabled, onBlocked }: { publication: RemoteTrackPublication; enabled: boolean; onBlocked: () => void }) {
  const element = useRef<HTMLAudioElement>(null);
  const track = publication.audioTrack;
  useEffect(() => {
    const node = element.current;
    if (!node || !track) return;
    track.attach(node);
    if (enabled) void node.play().catch(onBlocked);
    return () => { track.detach(node); };
    // onBlocked 只用于播放被浏览器拦截时回退按钮，不参与依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, enabled]);
  return <audio ref={element} autoPlay muted={!enabled} />;
}
