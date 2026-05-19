'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { CheckOutlined, CloseOutlined, TeamOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type Competition = {
  id: string;
  title: string;
};

type Registration = {
  id: string;
  name: string;
  studentId: string;
  className: string;
  phone: string;
  genderLabel: string;
  eventName: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'removed';
  statusLabel: string;
  reviewedAt?: string | null;
};

const STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
];

const STATUS_COLORS: Record<Registration['status'], string> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
  removed: 'default',
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export default function AdminCompetitionRegistrationsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const [competitionList, registrationData] = await Promise.all([
        apiFetch<Competition[]>('/admin/competitions', { token }),
        apiFetch<Registration[]>(`/admin/competitions/${id}/registrations?status=${status}`, { token }),
      ]);
      setCompetition(competitionList.find((item) => item.id === id) ?? null);
      setRegistrations(registrationData);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '报名审核列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, id, status]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pendingCount = useMemo(
    () => registrations.filter((item) => item.status === 'pending').length,
    [registrations],
  );

  async function review(registrationId: string, action: 'approve' | 'reject') {
    if (!token) return;
    try {
      await apiFetch(`/admin/registrations/${registrationId}/${action}`, {
        method: 'PATCH',
        token,
      });
      message.success(action === 'approve' ? '已审核通过' : '已审核拒绝');
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '审核操作失败');
    }
  }

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '学号', dataIndex: 'studentId', key: 'studentId' },
    { title: '班级', dataIndex: 'className', key: 'className' },
    { title: '联系电话', dataIndex: 'phone', key: 'phone' },
    { title: '性别', dataIndex: 'genderLabel', key: 'genderLabel', width: 80 },
    { title: '参赛项目', dataIndex: 'eventName', key: 'eventName' },
    {
      title: '报名时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '审核状态',
      key: 'status',
      render: (_: unknown, record: Registration) => (
        <Tag color={STATUS_COLORS[record.status]}>{record.statusLabel}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_: unknown, record: Registration) => (
        <Space>
          <Popconfirm
            title="确认通过该报名？"
            onConfirm={() => review(record.id, 'approve')}
            disabled={record.status === 'approved'}
          >
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              disabled={record.status === 'approved'}
            >
              通过
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确认拒绝该报名？"
            onConfirm={() => review(record.id, 'reject')}
            disabled={record.status === 'rejected'}
          >
            <Button
              size="small"
              danger
              icon={<CloseOutlined />}
              disabled={record.status === 'rejected'}
            >
              拒绝
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            报名审核
          </Typography.Title>
          <Typography.Text type="secondary">
            {competition?.title ?? '当前赛事'}，待审核记录默认优先处理。
          </Typography.Text>
        </div>
        <Space>
          <Select
            value={status}
            onChange={setStatus}
            style={{ width: 140 }}
            options={STATUS_OPTIONS}
          />
          <Tag color="orange">当前列表待审核：{pendingCount}</Tag>
          <Button icon={<TeamOutlined />} onClick={() => router.push(`/admin/competitions/${id}/players`)}>
            参赛选手
          </Button>
          <Button onClick={() => router.push('/admin/competitions')}>返回赛事管理</Button>
        </Space>
      </div>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={registrations}
        loading={loading}
        pagination={{ pageSize: 20 }}
      />
    </div>
  );
}
