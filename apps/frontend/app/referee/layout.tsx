import type { Metadata, Viewport } from 'next';
import { RefereeLandscapeGate } from './RefereeLandscapeGate';

export const metadata: Metadata = {
  title: '裁判端 · 羽动云赛',
};

// Landscape is locked when a match is opened (TournamentCourts) and released by
// RefereeLandscapeGate once the referee leaves the match page.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RefereeLayout({ children }: { children: React.ReactNode }) {
  return <RefereeLandscapeGate>{children}</RefereeLandscapeGate>;
}
