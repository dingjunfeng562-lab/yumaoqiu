'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { formatPhotoManagementDate, PHOTO_MANAGEMENT_ACCESS, PHOTO_MANAGEMENT_STATUS } from '@/lib/photo-management-access';
import type { PhotoManagementRequest, PhotoManagementStatus } from '@/lib/photo-management-access';

type ReviewRequest = PhotoManagementRequest & {
  applicant: { username: string; role: string; status: string } | null;
  applicantName: string;
  targetName: string;
  reviewedByName: string | null;
  revokedByName: string | null;
};
type Decision = 'approve' | 'reject' | 'revoke';
type ReviewAction = { kind: Decision; row: ReviewRequest };

const ACTION_LABELS = {
  approve: '通过申请',
  reject: '驳回申请',
  revoke: '撤销权限',
};
const STATUS_FILTERS = [
  { value: 'ALL', label: '全部状态' },
  ...Object.entries(PHOTO_MANAGEMENT_STATUS).map(([value, status]) => ({ value, label: status.label })),
];

const TARGET_LABEL = { TOURNAMENT: '赛事', ACTIVITY: '活动' };

export default function PhotoManagementRequestsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [status, setStatus] = useState<PhotoManagementStatus | 'ALL'>('PENDING');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [action, setAction] = useState<ReviewAction>();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ reason?: string }>();

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(undefined);
    try {
      setRequests(await apiFetch<ReviewRequest[]>(`${PHOTO_MANAGEMENT_ACCESS}/requests`, { token, cache: 'no-store' }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '申请列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(values: { reason?: string }) {
    if (!token || !action || saving) return;
    setSaving(true);
    try {
      await apiFetch(`${PHOTO_MANAGEMENT_ACCESS}/requests/${encodeURIComponent(action.row.id)}`, {
        token, method: 'PATCH', body: JSON.stringify({ decision: action.kind, reason: values.reason?.trim() }),
      });
      message.success('审核结果已保存');
      setAction(undefined);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '处理失败');
      await load();
    } finally {
      setSaving(false);
    }
  }

  const columns: TableColumnsType<ReviewRequest> = [
    {
      title: '赛事或活动',
      key: 'target',
      width: 190,
      render: (_, row) => <Space wrap><Tag>{TARGET_LABEL[row.targetType]}</Tag>{row.targetName}</Space>,
    },
    {
      title: '管理员',
      key: 'applicant',
      width: 150,
      render: (_, row) => row.applicant?.username ?? `${row.applicantName}（已删除）`,
    },
    {
      title: '用途',
      dataIndex: 'purpose',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 94,
      render: (value: PhotoManagementStatus) => (
        <Tag color={PHOTO_MANAGEMENT_STATUS[value].color}>{PHOTO_MANAGEMENT_STATUS[value].label}</Tag>
      ),
    },
    { title: '记录时间', dataIndex: 'createdAt', width: 175, render: formatPhotoManagementDate },
    {
      title: '处理记录',
      key: 'history',
      width: 260,
      render: (_, row) => row.reviewedAt ? (
        <Space orientation="vertical" size={2}>
          <Typography.Text>{row.reviewedByName} · {formatPhotoManagementDate(row.reviewedAt)}</Typography.Text>
          {row.reviewReason ? <Typography.Text type="secondary">{row.reviewReason}</Typography.Text> : null}
          {row.revokedAt ? (
            <>
              <Typography.Text>{row.revokedByName} · {formatPhotoManagementDate(row.revokedAt)} 撤销</Typography.Text>
              <Typography.Text type="secondary">{row.revokeReason}</Typography.Text>
            </>
          ) : null}
        </Space>
      ) : '—',
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_, row) => {
        if (row.status === 'PENDING') {
          const canApprove = row.applicant?.role === 'ADMIN' && row.applicant.status === 'ACTIVE';
          return <Space>
            <Button size="small" type="primary" disabled={!canApprove} onClick={() => setAction({ kind: 'approve', row })}>通过</Button>
            <Button size="small" danger onClick={() => setAction({ kind: 'reject', row })}>驳回</Button>
          </Space>;
        }
        return row.status === 'APPROVED' && row.applicant
          ? <Button size="small" danger onClick={() => setAction({ kind: 'revoke', row })}>撤销</Button>
          : '—';
      },
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Link href="/nicaiyixiahh/users"><ArrowLeftOutlined /> 返回用户管理</Link>
      <Typography.Title level={3} style={{ margin: 0 }}>图片管理申请</Typography.Title>
      {loadError ? <Alert type="error" showIcon title={loadError} /> : null}
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            aria-label="审核状态"
            value={status}
            options={STATUS_FILTERS}
            onChange={setStatus}
            style={{ width: 132 }}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
        </Space>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={requests.filter((row) => status === 'ALL' || row.status === status)}
          pagination={{ pageSize: 15 }}
          scroll={{ x: 1150 }}
          locale={{ emptyText: '没有符合条件的申请' }}
        />
      </Card>
      <Modal
        open={!!action}
        destroyOnHidden
        title={action ? ACTION_LABELS[action.kind] : undefined}
        confirmLoading={saving}
        cancelButtonProps={{ disabled: saving }}
        closable={!saving}
        mask={{ closable: !saving }}
        onCancel={() => setAction(undefined)}
        onOk={() => form.submit()}
        okText={action ? ACTION_LABELS[action.kind] : '确认'}
        okButtonProps={{ danger: action?.kind === 'revoke' || action?.kind === 'reject' }}
      >
        <Form form={form} layout="vertical" preserve={false} onFinish={save}>
          {action ? (
            <>
              <Typography.Paragraph strong>{action.row.targetName}</Typography.Paragraph>
              <Typography.Paragraph>管理员：{action.row.applicant?.username ?? action.row.applicantName}</Typography.Paragraph>
            </>
          ) : null}
          <Form.Item
            name="reason"
            label={action?.kind === 'approve' ? '审核备注' : '处理原因'}
            rules={action?.kind === 'approve' ? [] : [{ required: true, whitespace: true, message: '请填写处理原因' }]}
          >
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
