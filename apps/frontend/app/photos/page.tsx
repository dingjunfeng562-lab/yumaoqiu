import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { PhotosGallery } from '@/components/photos/PhotosGallery';

export const dynamic = 'force-dynamic';

export default function PhotosPage() {
  return (
    <PortalFeaturePage
      activeHref="/photos"
      eyebrow="TOURNAMENT GALLERY"
      title="赛事图片"
      description="记录每一届赛事的精彩瞬间 —— 选手风采、比赛现场与颁奖时刻。"
    >
      <PhotosGallery />
    </PortalFeaturePage>
  );
}
