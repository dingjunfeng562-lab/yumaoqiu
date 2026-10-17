import { PhotoGalleryAccess } from '@/components/photos/PhotoGalleryAccess';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '赛事照片墙 | 羽动云赛',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

export default async function TournamentPhotosPage({
  params,
}: {
  params: Promise<{ accessToken: string }>;
}) {
  const { accessToken } = await params;
  return <PhotoGalleryAccess key={accessToken} accessToken={accessToken} />;
}
