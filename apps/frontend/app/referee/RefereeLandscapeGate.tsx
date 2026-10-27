'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { isMobileReferee, lockLandscape, releaseLandscape } from '@/components/referee/orientation';

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}

const readPortraitMobile = () => isMobileReferee() && window.innerHeight > window.innerWidth;

// Landscape is locked when the referee taps into a match (see TournamentCourts).
// If the match page is still portrait — the lock was lost (e.g. a back swipe
// left fullscreen) or the browser can't lock (iOS Safari, WeChat) — show a
// small prompt at the top: tap it to retry the lock, or turn the phone by hand.
// Leaving the match page releases the lock so the lists follow the device.
export function RefereeLandscapeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onMatchPage = pathname?.startsWith('/referee/matches/') ?? false;
  const portraitMobile = useSyncExternalStore(subscribe, readPortraitMobile, () => false);
  const [lockFailed, setLockFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!onMatchPage) releaseLandscape();
  }, [onMatchPage]);

  const showPrompt = onMatchPage && portraitMobile && !dismissed;

  async function retry() {
    if (busy || lockFailed) return;
    setBusy(true);
    const ok = await lockLandscape();
    setBusy(false);
    if (!ok) setLockFailed(true);
  }

  return (
    <>
      {children}
      {showPrompt ? (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: 'calc(8px + env(safe-area-inset-top))',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9998,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            maxWidth: 'calc(100vw - 24px)',
            borderRadius: 18,
            background: 'rgba(15,23,42,0.86)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            boxShadow: '0 10px 20px rgba(15,23,42,0.28)',
            // Fade in late so the brief portrait moment while the lock from
            // the match list is rotating the screen doesn't flash the prompt.
            animation: 'referee-rotate-hint 0.2s ease 0.8s both',
          }}
        >
          <style>{'@keyframes referee-rotate-hint{from{opacity:0}to{opacity:1}}'}</style>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={busy || lockFailed}
            style={{ padding: '8px 4px 8px 14px', background: 'none', border: 0, color: 'inherit', font: 'inherit', cursor: lockFailed ? 'default' : 'pointer' }}
          >
            {lockFailed ? '无法自动横屏，请将手机横过来' : busy ? '切换中…' : '点此切换横屏'}
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
    </>
  );
}
