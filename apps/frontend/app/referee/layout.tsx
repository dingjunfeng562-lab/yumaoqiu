import type { Metadata, Viewport } from 'next';
import { RefereeLandscapeGate } from './RefereeLandscapeGate';

export const metadata: Metadata = {
  title: '裁判端 · 羽动云赛',
};

// Hint capable browsers (Android Chrome, in-app webviews) that the referee
// console should default to landscape. iOS Safari ignores this — the runtime
// gate in RefereeLandscapeGate covers that case.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RefereeLayout({ children }: { children: React.ReactNode }) {
  return <RefereeLandscapeGate>{children}</RefereeLandscapeGate>;
}
