'use client';

import { useEffect, useRef } from 'react';
import { Room, Track } from 'livekit-client';
import { retainVideoQuality } from '@/lib/live-video-quality';

export function LiveCameraVideo({ room, cameraId, revision, quality = 'low' }: {
  room: Room | null; cameraId: string | null; revision: number; quality?: 'low' | 'high';
}) {
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const publication = cameraId && room?.remoteParticipants.get(`camera_${cameraId}`)?.getTrackPublication(Track.Source.Camera);
    if (!publication) return;
    publication.setSubscribed(true);
    const releaseQuality = retainVideoQuality(publication, quality);
    const track = publication.videoTrack;
    const video = element.current;
    if (track && video) {
      // 机位重连/切换镜头后会换成新轨道，先清空 srcObject 再挂，
      // 否则个别浏览器会继续显示上一帧，看起来像"卡死"。
      video.srcObject = null;
      track.attach(video);
      void video.play().catch(() => undefined);
    }
    return () => { releaseQuality(); if (track && video) track.detach(video); };
  }, [room, cameraId, revision, quality]);
  return <video ref={element} data-camera-quality={quality} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#080e17' }} />;
}
