'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { AuditOutlined, DownloadOutlined, RollbackOutlined, StopOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type Competition = {
  id: string;
  title: string;
};

type Player = {
  id: string;
  competitionRegistrationId?: string | null;
  email: string;
  name: string;
  studentId: string;
  school?: string;
  className: string;
  phone: string;
  genderLabel: string;
  eventName: string;
  createdAt: string;
  statusLabel: string;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export default function AdminCompetitionPlayersPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [eventName, setEventName] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (eventName !== 'all') params.set('eventName', eventName);
    if (search.trim()) params.set('search', search.trim());
    const value = params.toString();
    return value ? `?${value}` : '';
  }, [eventName, search]);

  const loadData = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const [competitionList, playerData] = await Promise.all([
        apiFetch<Competition[]>('/admin/competitions', { token }),
        apiFetch<Player[]>(`/admin/competitions/${id}/players${query}`, { token }),
      ]);
      setCompetition(competitionList.find((item) => item.id === id) ?? null);
      setPlayers(playerData);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '参赛选手列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, id, query]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function removePlayer(registrationId?: string | null) {
    if (!token || !registrationId) return;
    try {
      await apiFetch(`/admin/competition-registrations/${registrationId}/remove`, {
        method: 'PATCH',
        token,
      });
      message.success('已移除该报名');
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '移除失败');
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
      render: (value: string | undefined, record: Player) =>
        value || record.className || <Typography.Text type="secondary">未填写</Typography.Text>,
    },
    { title: '联系电话', dataIndex: 'phone', key: 'phone', width: 140 },
    { title: '性别', dataIndex: 'genderLabel', key: 'genderLabel', width: 70 },
    {
      title: '参赛项目',
      dataIndex: 'eventName',
      key: 'eventName',
      render: (value: string) => <Tag color="blue">{value}</Tag>,
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
      render: (_: unknown, record: Player) => <Tag color="green">{record.statusLabel}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: unknown, record: Player) => (
        <Popconfirm title="确认移除该报名？" onConfirm={() => removePlayer(record.competitionRegistrationId)}>
          <Button size="small" danger icon={<StopOutlined />}>移除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            参赛选手
          </Typography.Title>
          <Typography.Text type="secondary">
            {competition?.title ?? '当前赛事'}，这里只显示审核通过的报名记录。
          </Typography.Text>
        </div>
        <Space wrap>
          <Select
            value={eventName}
            onChange={setEventName}
            style={{ width: 180 }}
            options={[
              { value: 'all', label: '全部项目' },
              { value: '男子单打', label: '男子单打' },
              { value: '女子单打', label: '女子单打' },
              { value: '男子双打', label: '男子双打' },
              { value: '女子双打', label: '女子双打' },
              { value: '混合双打', label: '混合双打' },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="搜索邮箱、姓名、学号、学校"
            onSearch={setSearch}
            style={{ width: 260 }}
          />
          <Button icon={<DownloadOutlined />} onClick={() => message.info('导出按钮已预留，可在后续接入 Excel 导出。')}>
            导出
          </Button>
          <Button icon={<AuditOutlined />} onClick={() => router.push(`/admin/competitions/${id}/registrations`)}>
            报名审核
          </Button>
          <Button icon={<RollbackOutlined />} onClick={() => router.push('/admin/competitions')}>
            返回
          </Button>
        </Space>
      </div>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={players}
        loading={loading}
        pagination={{ pageSize: 20 }}
      />
    </div>
  );
}
