// Phones held in portrait have very little room for the scoring layout, so the
// referee console switches to landscape when a match is opened. Browsers only
// allow fullscreen (a prerequisite for orientation.lock) inside a user gesture,
// so lockLandscape must be called synchronously from the click handler, before
// any await. iOS Safari has no orientation.lock; there RefereeLandscapeGate
// rotates the match page with CSS instead.
const MOBILE_MAX_WIDTH = 820;

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
};

function isMobile() {
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return shortSide <= MOBILE_MAX_WIDTH && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
}

export function isMobileReferee() {
  return typeof window !== 'undefined' && isMobile();
}

// iOS Safari and most in-app browsers have no orientation.lock at all.
export function canLockLandscape() {
  if (typeof window === 'undefined') return false;
  return typeof (window.screen.orientation as ScreenOrientationWithLock | undefined)?.lock === 'function';
}

// Resolves true once the screen is locked to landscape. On failure it leaves
// any fullscreen it entered, so the referee isn't stuck fullscreen in portrait.
export function lockLandscape(): Promise<boolean> {
  if (typeof window === 'undefined' || !isMobile()) return Promise.resolve(false);
  const docEl = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  const orientation = window.screen.orientation as ScreenOrientationWithLock | undefined;
  if (!orientation?.lock) return Promise.resolve(false);
  const wasFullscreen = !!document.fullscreenElement;
  let fullscreen: Promise<void> | undefined;
  try {
    if (!wasFullscreen) fullscreen = (docEl.requestFullscreen ?? docEl.webkitRequestFullscreen)?.call(docEl);
  } catch {
    return Promise.resolve(false);
  }
  return Promise.resolve(fullscreen)
    .then(() => orientation.lock!('landscape'))
    .then(() => true)
    .catch(() => {
      if (!wasFullscreen && document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => undefined);
      return false;
    });
}

export function releaseLandscape() {
  if (typeof window === 'undefined') return;
  const orientation = window.screen.orientation as ScreenOrientationWithLock | undefined;
  try {
    orientation?.unlock?.();
  } catch {
    // Not locked or unsupported.
  }
  if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => undefined);
}
