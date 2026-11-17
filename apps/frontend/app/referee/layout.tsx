import type { Metadata, Viewport } from 'next';
import { RefereeLandscapeGate } from './RefereeLandscapeGate';
import { RefereeSessionKeeper } from './RefereeSessionKeeper';

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
  return (
    <>
      {/* 裁判员账号在裁判端时，保证离自动退出至少还有 48 小时 */}
      <RefereeSessionKeeper />
      <RefereeLandscapeGate>{children}</RefereeLandscapeGate>
    </>
  );
}
