import { BroadcastOverlay } from '@/components/broadcast/BroadcastOverlay';
import './overlay.css';

export const metadata = {
  title: 'OBS 记分牌 | 羽动云赛',
  // The overlay is a private operator link, never an indexable page.
  robots: { index: false, follow: false },
};

export default async function BroadcastOverlayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <BroadcastOverlay key={token} token={token} />;
}
