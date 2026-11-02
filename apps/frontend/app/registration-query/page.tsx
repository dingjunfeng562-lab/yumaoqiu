import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { RegistrationQuery } from '@/components/payments/RegistrationQuery';

export const metadata = { title: '报名查询' };

export default function RegistrationQueryPage() {
  return (
    <PortalFeaturePage
      activeHref="/registration-query"
      eyebrow="Registration"
      title="报名查询"
      description="输入报名时填写的姓名和联系方式，查看所在组别、报名项目和缴费状态。管理员确认收款后会显示「缴费成功」。"
    >
      <RegistrationQuery />
    </PortalFeaturePage>
  );
}
