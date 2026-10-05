import { MulticameraDirector } from '@/components/broadcast/MulticameraDirector';

export default async function DirectorPage({ params }: { params: Promise<{ broadcastId: string }> }) {
  const { broadcastId } = await params;
  return <MulticameraDirector broadcastId={broadcastId} />;
}
