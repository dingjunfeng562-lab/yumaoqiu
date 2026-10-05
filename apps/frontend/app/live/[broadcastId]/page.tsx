import { BroadcastViewer } from '@/components/broadcast/BroadcastViewer';

export const metadata = { title: '赛事视频直播 | 羽动云赛' };

export default async function LiveBroadcastPage({
  params,
}: {
  params: Promise<{ broadcastId: string }>;
}) {
  const { broadcastId } = await params;
  return <BroadcastViewer key={broadcastId} broadcastId={broadcastId} />;
}
