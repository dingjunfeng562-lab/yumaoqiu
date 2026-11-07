'use client';

import { Alert, Card, Empty, Image, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { PAYMENT_STATUS_META, type PaymentGroupView, type PaymentItemView, uploadUrl, yuan } from '@/lib/payments';

export type PaymentGroupState = 'REJECTED' | 'NOT_REQUIRED' | 'SETTLED' | 'PENDING_REVIEW' | 'DUE';

/** 一个「赛事 + 组别」整体所处的阶段，卡片和缴费页共用。 */
export function paymentGroupState(group: PaymentGroupView): PaymentGroupState {
  if (group.items.every((item) => item.status === 'REJECTED')) return 'REJECTED';
  if (!group.required) return 'NOT_REQUIRED';
  if (group.items.every((item) => ['PAID', 'WAIVED', 'NOT_REQUIRED', 'REJECTED'].includes(item.status))) return 'SETTLED';
  if (group.items.every((item) => item.status === 'PENDING_REVIEW')) return 'PENDING_REVIEW';
  return 'DUE';
}

export function PaymentItemsTable({ items }: { items: PaymentItemView[] }) {
  return (
    <Table<PaymentItemView>
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={items}
      scroll={{ x: 480 }}
      columns={[
        { title: '项目', dataIndex: 'itemName' },
        { title: '参赛方', dataIndex: 'name' },
        { title: '金额', dataIndex: 'amount', width: 90, render: (value: number, row) => (['NOT_REQUIRED', 'REJECTED'].includes(row.status) ? '-' : yuan(value)) },
        {
          title: '状态',
          dataIndex: 'status',
          width: 150,
          render: (value: PaymentItemView['status'], row) => (
            <Space orientation="vertical" size={0}>
              <Tag color={PAYMENT_STATUS_META[value].color}>{PAYMENT_STATUS_META[value].label}</Tag>
              {row.note ? <Typography.Text type="danger" style={{ fontSize: 12 }}>原因：{row.note}</Typography.Text> : null}
              {row.paidAt && value === 'PAID' ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{dayjs(row.paidAt).format('YYYY/MM/DD HH:mm')}</Typography.Text>
              ) : null}
            </Space>
          ),
        },
      ]}
    />
  );
}

const STATE_TAGS: Record<PaymentGroupState, { color?: string; label: string }> = {
  REJECTED: { color: 'red', label: '报名已驳回' },
  NOT_REQUIRED: { label: '无需缴费' },
  SETTLED: { color: 'green', label: '缴费成功' },
  PENDING_REVIEW: { label: '待审核' },
  DUE: { color: 'orange', label: '待缴费' },
};

export function PaymentGroupCard({ group, showCompetition = true }: { group: PaymentGroupView; showCompetition?: boolean }) {
  const state = paymentGroupState(group);
  return (
    <Card
      size="small"
      title={showCompetition ? `${group.competitionName} · ${group.groupLabel}` : `${group.groupLabel}缴费`}
      extra={<Tag color={STATE_TAGS[state].color}>{state === 'DUE' ? `待缴 ${yuan(group.totalDue)}` : STATE_TAGS[state].label}</Tag>}
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <PaymentItemsTable items={group.items} />
        {state === 'REJECTED' ? (
          <Alert type="error" showIcon title="报名未通过审核，可修改信息后重新报名；如有疑问请联系组委会。" />
        ) : null}
        {state === 'PENDING_REVIEW' ? (
          <Alert type="info" showIcon title="报名审核通过后再缴费，届时这里会显示收款方式。" />
        ) : null}
        {group.totalDue > 0 && (group.instructions || group.qrImageUrl) ? (
          <Alert
            type="warning"
            showIcon
            title={`请缴费 ${yuan(group.totalDue)}，管理员确认后显示「缴费成功」`}
            description={(
              <Space align="start" wrap size={16}>
                {group.qrImageUrl ? (
                  <Image src={uploadUrl(group.qrImageUrl)} alt="收款码" width={160} style={{ background: '#fff' }} />
                ) : null}
                {group.instructions ? (
                  <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0, maxWidth: 420 }}>{group.instructions}</Typography.Paragraph>
                ) : null}
              </Space>
            )}
          />
        ) : null}
      </Space>
    </Card>
  );
}

export function PaymentGroupList({ groups, emptyText = '暂无报名记录' }: { groups: PaymentGroupView[]; emptyText?: string }) {
  if (!groups.length) return <Empty description={emptyText} />;
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      {groups.map((group) => <PaymentGroupCard key={`${group.competitionId}:${group.groupId ?? group.entrantType}`} group={group} />)}
    </Space>
  );
}
