import type { Metadata } from 'next';
import { MaintenanceScreen } from '@/components/maintenance/MaintenanceScreen';
import { fetchMaintenanceStatus, serverApiBase } from '@/lib/maintenance';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '系统维护中 | 羽动云赛',
  robots: { index: false, follow: false },
};

// 全服维护页。维护期间 proxy 把所有页面都换成这一页（地址栏不变），
// 维护开始前就打开的页面在操作时会跳到 /maintenance?from=原地址。
export default async function MaintenancePage() {
  const status = await fetchMaintenanceStatus(serverApiBase());
  return <MaintenanceScreen initialStatus={status} />;
}
