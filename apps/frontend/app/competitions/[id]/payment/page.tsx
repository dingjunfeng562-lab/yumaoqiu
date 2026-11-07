import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { PaymentCheckout } from '@/components/payments/PaymentCheckout';

export const metadata = { title: '报名缴费' };

export default async function CompetitionPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;
  return (
    <PortalFeaturePage
      activeHref="/registration-query"
      eyebrow="Payment"
      title="报名缴费"
      description="按收款方式转账后，等待组委会确认收款，确认后显示「缴费成功」。"
      back={{ href: `/competitions/${id}`, label: '赛事主页' }}
    >
      <PaymentCheckout competitionId={id} guestToken={typeof token === 'string' ? token : undefined} />
    </PortalFeaturePage>
  );
}
