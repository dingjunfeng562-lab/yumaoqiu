'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  /** HLS (.m3u8) playback address from the cloud live provider. */
  src: string | null;
  poster?: string;
  /** Fill the viewer's shared video/score frame, including its fullscreen mode. */
  fillFrame?: boolean;
  placeholder?: string;
};

/**
 * Viewer player. Safari and iOS play HLS natively; other browsers get hls.js,
 * which is imported lazily so it never lands in the first page bundle.
 */
export function LivePlayer({ src, poster, fillFrame = false, placeholder = '待开始' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    setError('');
    let destroyed = false;
    let hls: { destroy(): void } | undefined;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      return () => { video.removeAttribute('src'); video.load(); };
    }

    void import('hls.js').then(({ default: Hls }) => {
      if (destroyed) return;
      if (!Hls.isSupported()) { setError('当前浏览器不支持该直播格式，请改用最新版 Chrome、Edge 或 Safari'); return; }
      const instance = new Hls({ lowLatencyMode: true, enableWorker: true });
      hls = instance;
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) instance.startLoad();
        else setError('直播流播放中断，正在等待信号恢复');
      });
      instance.loadSource(src);
      instance.attachMedia(video);
    }).catch(() => { if (!destroyed) setError('播放组件加载失败，请刷新页面重试'); });

    return () => { destroyed = true; hls?.destroy(); };
  }, [src]);

  if (!src) {
    return (
      <div style={placeholderStyle} role="status">
        {placeholder}
      </div>
    );
  }

  return (
    <div style={{ width: '100%', ...(fillFrame ? { position: 'absolute', inset: 0 } as const : {}) }}>
      <video
        ref={videoRef}
        controls
        controlsList={fillFrame ? 'nofullscreen' : undefined}
        playsInline
        autoPlay
        muted
        poster={poster}
        style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: fillFrame ? 0 : 8,
          ...(fillFrame ? { height: '100%', objectFit: 'contain' } as const : {}) }}
      >
        <track kind="captions" />
      </video>
      {error && <div style={fillFrame
        ? { position: 'absolute', bottom: 56, left: 12, right: 12, padding: 8, color: '#fff', background: '#000a' }
        : { marginTop: 8, color: '#d4380d' }} role="alert">{error}</div>}
    </div>
  );
}

const placeholderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  aspectRatio: '16 / 9',
  borderRadius: 8,
  background: '#0f2147',
  color: '#fff',
  fontSize: 16,
} as const;
