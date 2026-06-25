'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button, Popconfirm, Select, Space, Table, Tag, Typography, message, Modal, Input } from 'antd';
import { CheckOutlined, CloseOutlined, TeamOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import CompetitionEmailSettingsCard from '@/components/admin/CompetitionEmailSettingsCard';

type Competition = {
  id: string;
  title: string;
};

type RegistrationItem = {
  id: string;
  eventId: string;
  eventName: string;
  partnerName?: string | null;
  partnerStudentId?: string | null;
  partnerClassName?: string | null;
  teamName?: string | null;
};

type Registration = {
  id: string;
  email: string;
  name: string;
  studentId: string;
  school?: string;
  phone: string;
  genderLabel: string;
  eventSummary: string;
  items: RegistrationItem[];
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'removed';
  statusLabel: string;
  reviewedAt?: string | null;
  rejectReason?: string | null;
};

const STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已驳回' },
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

function normalizeRouteParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default function AdminCompetitionRegistrationsPage() {
  const params = useParams<{ id: string }>();
  const id = normalizeRouteParam(params?.id);
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // 邮件通知设置模块仅总管理员可见；普通管理员既不渲染也无法调用相关接口（后端 403）
  const sessionRole = (session?.user as { role?: string } | undefined)?.role;
  const [liveRole, setLiveRole] = useState<string | undefined>(sessionRole);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<{ role?: string }>('/auth/me', { token })
      .then((me) => {
        if (!cancelled && me?.role) setLiveRole(me.role);
      })
      .catch(() => {
        /* 保持 session 中的角色 */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  const effectiveRole = liveRole ?? sessionRole;
  const isRoot = effectiveRole === 'ROOT';
  // 报名审核为写操作:降权后的总管理员(SUPER_ADMIN)只读,仅管理员/超级管理员可操作。
  const canManage = effectiveRole === 'ADMIN' || effectiveRole === 'ROOT';

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

  async function approve(registrationId: string) {
    if (!token) return;
    try {
      await apiFetch(`/admin/competition-registrations/${registrationId}/approve`, {
        method: 'PATCH',
        token,
      });
      message.success('已审核通过');
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '审核操作失败');
    }
  }

  async function reject() {
    if (!token || !rejectingId) return;
    try {
      await apiFetch(`/admin/competition-registrations/${rejectingId}/reject`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ rejectReason }),
      });
      message.success('已驳回报名');
      setRejectingId(null);
      setRejectReason('');
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '驳回操作失败');
    }
  }

  const columns = [
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '姓名', dataIndex: 'name', key: 'name', width: 110 },
    { title: '学号', dataIndex: 'studentId', key: 'studentId', width: 140 },
    {
      title: '学校',
      dataIndex: 'school',
      key: 'school',
      render: (value?: string) => value || <Typography.Text type="secondary">未填写</Typography.Text>,
    },
    { title: '联系方式', dataIndex: 'phone', key: 'phone', width: 140 },
    { title: '性别', dataIndex: 'genderLabel', key: 'genderLabel', width: 70 },
    {
      title: '报名项目',
      key: 'eventSummary',
      render: (_: unknown, record: Registration) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{record.eventSummary}</Typography.Text>
          {record.items.map((item) =>
            item.partnerName ? (
              <Typography.Text key={item.id} type="secondary">
                {item.eventName}
                {item.teamName ? ` · 队伍：${item.teamName}` : ''}
                ：搭档 {item.partnerName}（{item.partnerStudentId || '未填学号'}）
                {item.partnerClassName ? ` · 学院班级：${item.partnerClassName}` : ''}
              </Typography.Text>
            ) : null,
          )}
        </Space>
      ),
    },
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
        <Space direction="vertical" size={2}>
          <Tag color={STATUS_COLORS[record.status]}>{record.statusLabel}</Tag>
          {record.rejectReason ? <Typography.Text type="danger">{record.rejectReason}</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_: unknown, record: Registration) =>
        canManage ? (
          <Space>
            <Popconfirm
              title="确认通过该报名？"
              onConfirm={() => approve(record.id)}
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
            <Button
              size="small"
              danger
              icon={<CloseOutlined />}
              disabled={record.status === 'rejected'}
              onClick={() => {
                setRejectingId(record.id);
                setRejectReason(record.rejectReason || '');
              }}
            >
              驳回
            </Button>
          </Space>
        ) : (
          <Typography.Text type="secondary">只读</Typography.Text>
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
          <Button
            icon={<TeamOutlined />}
            onClick={() => id && router.push(`/admin/competitions/${encodeURIComponent(id)}/players`)}
          >
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
      {isRoot && token && id ? (
        <CompetitionEmailSettingsCard competitionId={id} token={token} />
      ) : null}
      <Modal
        title="填写驳回原因"
        open={Boolean(rejectingId)}
        onCancel={() => {
          setRejectingId(null);
          setRejectReason('');
        }}
        onOk={reject}
        okText="确认驳回"
      >
        <Input.TextArea
          rows={4}
          value={rejectReason}
          onChange={(event) => setRejectReason(event.target.value)}
          placeholder="请输入驳回原因"
        />
      </Modal>
    </div>
  );
}
