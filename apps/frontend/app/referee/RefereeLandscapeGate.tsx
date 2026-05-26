'use client';

import { useCallback, useEffect, useState } from 'react';

// Phones held in portrait have very little room for the scoring layout, so we
// surface an opt-in switch that lets the referee pick the orientation they
// prefer. We never force landscape — both modes stay supported.
const MOBILE_MAX_WIDTH = 820;

type OrientationState = {
  isMobile: boolean;
  isPortrait: boolean;
};

function readOrientation(): OrientationState {
  if (typeof window === 'undefined') {
    return { isMobile: false, isPortrait: false };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const shortSide = Math.min(width, height);
  const isMobile = shortSide <= MOBILE_MAX_WIDTH && (
    'ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
  );
  return {
    isMobile,
    isPortrait: height > width,
  };
}

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: 'landscape' | 'portrait' | 'any' | 'natural' | 'landscape-primary' | 'landscape-secondary' | 'portrait-primary' | 'portrait-secondary') => Promise<void>;
};

async function tryLock(target: 'landscape' | 'portrait') {
  const orientation = window.screen.orientation as ScreenOrientationWithLock | undefined;
  if (target === 'landscape') {
    const docEl = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    if (!document.fullscreenElement && docEl.requestFullscreen) {
      await docEl.requestFullscreen();
    } else if (!document.fullscreenElement && docEl.webkitRequestFullscreen) {
      await docEl.webkitRequestFullscreen();
    }
    if (orientation?.lock) await orientation.lock('landscape');
    return;
  }

  // Going back to portrait: drop the lock first, then leave fullscreen so the
  // user isn't stuck in landscape after toggling off.
  if (orientation?.unlock) orientation.unlock();
  if (document.fullscreenElement && document.exitFullscreen) {
    await document.exitFullscreen();
  }
}

export function RefereeLandscapeGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OrientationState>(() => ({ isMobile: false, isPortrait: false }));
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => {
    function handle() {
      setState(readOrientation());
    }
    handle();
    window.addEventListener('resize', handle);
    window.addEventListener('orientationchange', handle);
    return () => {
      window.removeEventListener('resize', handle);
      window.removeEventListener('orientationchange', handle);
    };
  }, []);

  const toggle = useCallback(async () => {
    setBusy(true);
    setHint('');
    try {
      await tryLock(state.isPortrait ? 'landscape' : 'portrait');
    } catch (error) {
      setHint(
        error instanceof Error && error.message
          ? `自动旋转失败：${error.message}。请手动旋转设备。`
          : '自动旋转失败，请手动旋转设备。',
      );
    } finally {
      setBusy(false);
    }
  }, [state.isPortrait]);

  return (
    <>
      {children}
      {state.isMobile ? (
        <div
          style={{
            position: 'fixed',
            right: 16,
            bottom: 'calc(16px + env(safe-area-inset-bottom))',
            zIndex: 9998,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 6,
            pointerEvents: 'none',
          }}
        >
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            aria-label={state.isPortrait ? '切换到横屏' : '切换到竖屏'}
            style={{
              pointerEvents: 'auto',
              height: 44,
              padding: '0 14px',
              borderRadius: 22,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(15,23,42,0.82)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 800,
              boxShadow: '0 12px 24px rgba(15,23,42,0.32)',
              cursor: busy ? 'wait' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              backdropFilter: 'blur(6px)',
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 18,
                height: 12,
                borderRadius: 2,
                border: '2px solid currentColor',
                transform: state.isPortrait ? 'rotate(0deg)' : 'rotate(90deg)',
                transition: 'transform 0.25s ease',
              }}
            />
            {busy ? '切换中…' : state.isPortrait ? '切换到横屏' : '切换到竖屏'}
          </button>
          {hint ? (
            <span
              role="status"
              style={{
                pointerEvents: 'auto',
                maxWidth: 220,
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(251,191,36,0.95)',
                color: '#451a03',
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1.4,
                boxShadow: '0 10px 20px rgba(15,23,42,0.18)',
              }}
            >
              {hint}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
