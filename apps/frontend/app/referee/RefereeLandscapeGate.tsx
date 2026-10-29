'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { ConfigProvider } from 'antd';
import { canLockLandscape, isMobileReferee, lockLandscape, releaseLandscape } from '@/components/referee/orientation';

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}

// A string snapshot keeps useSyncExternalStore stable between resizes.
const readPortraitViewport = () =>
  isMobileReferee() && window.innerHeight > window.innerWidth
    ? `${window.innerWidth}x${window.innerHeight}`
    : '';

// Wait a moment before rotating so the screen turning from the lock started in
// the match list (see TournamentCourts) doesn't flash a rotated frame.
const ROTATE_DELAY_MS = 400;

// Landscape is locked when the referee taps into a match (see TournamentCourts).
// If the match page is still portrait — the lock was lost (e.g. a back swipe
// left fullscreen) or the browser can't lock (iOS Safari, WeChat) — the page is
// rotated 90° with CSS so the console is always landscape; turning the phone
// counter-clockwise makes it upright. Modals and messages are mounted inside
// the rotated box so they turn with it. Where the browser can lock, a small
// prompt offers to retry the real fullscreen lock.
// Leaving the match page releases the lock so the lists follow the device.
export function RefereeLandscapeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onMatchPage = pathname?.startsWith('/referee/matches/') ?? false;
  const portraitViewport = useSyncExternalStore(subscribe, readPortraitViewport, () => '');
  const wantRotate = onMatchPage && portraitViewport !== '';
  const [rotateReady, setRotateReady] = useState(false);
  const [lockFailed, setLockFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onMatchPage) releaseLandscape();
  }, [onMatchPage]);

  useEffect(() => {
    if (!wantRotate) return;
    const timer = setTimeout(() => setRotateReady(true), ROTATE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setRotateReady(false);
    };
  }, [wantRotate]);

  const rotated = wantRotate && rotateReady;
  const [portraitWidth, portraitHeight] = portraitViewport.split('x').map(Number);
  const getPopupContainer = useCallback(() => boxRef.current ?? document.body, []);

  async function retry() {
    if (busy || lockFailed) return;
    setBusy(true);
    const ok = await lockLandscape();
    setBusy(false);
    if (!ok) setLockFailed(true);
  }

  const showPrompt = rotated && canLockLandscape() && !lockFailed && !dismissed;

  return (
    <div
      ref={boxRef}
      data-referee-rotated={rotated ? '' : undefined}
      style={
        rotated
          ? ({
              position: 'fixed',
              top: 0,
              left: 0,
              zIndex: 1,
              width: portraitHeight,
              height: portraitWidth,
              overflow: 'hidden',
              transformOrigin: 'top left',
              transform: `translateX(${portraitWidth}px) rotate(90deg)`,
              // The match console sizes itself from these: after rotating, the
              // landscape height is the portrait width, and the notch (portrait
              // top) sits on the console's left edge.
              '--referee-viewport-height': `${portraitWidth}px`,
              '--referee-safe-left': 'env(safe-area-inset-top)',
              '--referee-safe-right': 'env(safe-area-inset-bottom)',
              '--referee-safe-bottom': '0px',
            } as React.CSSProperties)
          : undefined
      }
    >
      <ConfigProvider getPopupContainer={rotated ? getPopupContainer : undefined}>
        {children}
      </ConfigProvider>
      {showPrompt ? (
        <div
          role="status"
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9998,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            maxWidth: 'calc(100% - 24px)',
            borderRadius: 18,
            background: 'rgba(15,23,42,0.86)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            boxShadow: '0 10px 20px rgba(15,23,42,0.28)',
          }}
        >
          <button
            type="button"
            onClick={() => void retry()}
            disabled={busy}
            style={{ padding: '8px 4px 8px 14px', background: 'none', border: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}
          >
            {busy ? '切换中…' : '点此全屏横屏'}
          </button>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setDismissed(true)}
            style={{ padding: '8px 12px 8px 6px', background: 'none', border: 0, color: 'rgba(255,255,255,0.7)', fontSize: 16, lineHeight: 1, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
