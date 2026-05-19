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
  name: string;
  studentId: string;
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

  async function removePlayer(registrationId: string) {
    if (!token) return;
    try {
      await apiFetch(`/admin/registrations/${registrationId}/remove`, {
        method: 'PATCH',
        token,
      });
      message.success('已移除选手，该报名不再显示在参赛选手列表');
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '移除失败');
    }
  }

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '学号', dataIndex: 'studentId', key: 'studentId' },
    { title: '班级', dataIndex: 'className', key: 'className' },
    { title: '联系电话', dataIndex: 'phone', key: 'phone' },
    { title: '性别', dataIndex: 'genderLabel', key: 'genderLabel', width: 80 },
    {
      title: '参赛项目',
      dataIndex: 'eventName',
      key: 'eventName',
      render: (value: string) => <Tag color={value === '男子单打' ? 'blue' : 'magenta'}>{value}</Tag>,
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
        <Popconfirm title="确认移除该选手？" onConfirm={() => removePlayer(record.id)}>
          <Button size="small" danger icon={<StopOutlined />}>
            移除
          </Button>
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
            style={{ width: 150 }}
            options={[
              { value: 'all', label: '全部项目' },
              { value: '男子单打', label: '男子单打' },
              { value: '女子单打', label: '女子单打' },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="搜索姓名、学号、班级"
            onSearch={setSearch}
            style={{ width: 240 }}
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
