'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Alert, Button, Card, Image, Result, Space, Spin, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { type PaymentGroupView, uploadUrl, yuan } from '@/lib/payments';
import { PaymentItemsTable, paymentGroupState } from './PaymentGroups';

// 接口返回 null 时响应体为空，按「没有缴费信息」处理。
const emptyAsNull = (error: unknown) => (error instanceof SyntaxError ? null : Promise.reject(error));

/** 报名缴费页：免审核且收费的报名提交后直接跳到这里；游客凭报名编号，登录用户凭账号。 */
export function PaymentCheckout({ competitionId, guestToken }: { competitionId: string; guestToken?: string }) {
  const { data: session, status } = useSession();
  const token = session?.user?.accessToken;
  const [group, setGroup] = useState<PaymentGroupView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const fetchGroup = useCallback(async () => {
    if (guestToken) {
      return apiFetch<PaymentGroupView | null>(
        `/payments/guest/${competitionId}/${encodeURIComponent(guestToken)}`,
        { redirectOnForbidden: false, cache: 'no-store' },
      ).catch(emptyAsNull);
    }
    if (!token) return null;
    const groups = await apiFetch<PaymentGroupView[]>('/payments/me', { token, redirectOnForbidden: false, cache: 'no-store' });
    return groups.find((item) => item.competitionId === competitionId) ?? null;
  }, [competitionId, guestToken, token]);

  useEffect(() => {
    if (status === 'loading') return;
    let alive = true;
    fetchGroup()
      .then((result) => { if (alive) setGroup(result); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : '缴费信息加载失败'); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [fetchGroup, status]);

  async function refresh() {
    setRefreshing(true);
    setError('');
    try {
      setGroup(await fetchGroup());
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新失败');
    } finally {
      setRefreshing(false);
    }
  }

  if (!loaded) return <div className="py-16 text-center"><Spin /></div>;

  if (!group) {
    return (
      <Card>
        <Result
          status="info"
          title={error || (guestToken || token ? '没有找到这次报名的缴费信息' : '请登录或使用报名查询')}
          subTitle="可在首页「报名查询」输入姓名和联系方式查看缴费状态。"
          extra={<Link href="/registration-query"><Button type="primary">去报名查询</Button></Link>}
        />
      </Card>
    );
  }

  const state = paymentGroupState(group);
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%', maxWidth: 820, margin: '0 auto', display: 'flex' }}>
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <Card
        title={`${group.competitionName} · ${group.groupLabel}`}
        extra={<Button icon={<ReloadOutlined />} loading={refreshing} onClick={refresh}>刷新状态</Button>}
      >
        {state === 'DUE' ? (
          <div className="grid items-start gap-6 md:grid-cols-[auto_1fr]">
            <div className="flex flex-col items-center gap-2">
              {group.qrImageUrl ? (
                <Image src={uploadUrl(group.qrImageUrl)} alt="收款码" width={240} style={{ background: '#fff' }} />
              ) : (
                <div className="grid h-60 w-60 place-items-center rounded-lg border border-dashed border-slate-300 text-sm font-semibold text-slate-400">
                  组委会未上传收款码
                </div>
              )}
              {group.qrImageUrl ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>长按或截图保存收款码</Typography.Text> : null}
            </div>
            <div>
              <Typography.Text type="secondary">应缴金额</Typography.Text>
              <div className="mt-1 text-4xl font-black text-amber-600">{yuan(group.totalDue)}</div>
              {group.instructions ? (
                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 16 }}>{group.instructions}</Typography.Paragraph>
              ) : null}
              <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm font-semibold text-slate-600">
                <li>按收款码或上面的说明转账 {yuan(group.totalDue)}</li>
                <li>转账备注写清报名人姓名和项目</li>
                <li>组委会确认收款后，这里和「报名查询」都会显示「缴费成功」</li>
              </ol>
            </div>
          </div>
        ) : null}
        {state === 'SETTLED' ? <Result status="success" title="缴费成功" subTitle={`已缴 ${yuan(group.totalPaid)}，组委会已确认收款。`} /> : null}
        {state === 'NOT_REQUIRED' ? <Result status="success" title="报名成功，本组别无需缴费" /> : null}
        {state === 'PENDING_REVIEW' ? (
          <Result status="info" title="报名待审核" subTitle="审核通过后再缴费，届时可在首页「报名查询」查看收款方式。" />
        ) : null}
        {state === 'REJECTED' ? <Result status="error" title="报名未通过审核" subTitle="可修改信息后重新报名，如有疑问请联系组委会。" /> : null}

        <div className="mt-4">
          <PaymentItemsTable items={group.items} />
        </div>
      </Card>

      {guestToken ? (
        <Card size="small">
          <Space orientation="vertical" size={4}>
            <Typography.Text type="secondary">报名编号（请保存，可用于查询报名状态）</Typography.Text>
            <Typography.Text strong copyable>{guestToken}</Typography.Text>
            <Link href={`/competitions/${competitionId}/registration-status?token=${encodeURIComponent(guestToken)}`}>查看报名状态</Link>
          </Space>
        </Card>
      ) : null}

      <div className="text-center">
        <Link href="/registration-query"><Tag color="blue" style={{ padding: '4px 12px', fontSize: 13 }}>也可以在首页「报名查询」随时查看缴费状态 →</Tag></Link>
      </div>
    </Space>
  );
}
