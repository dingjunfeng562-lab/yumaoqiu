'use client';
import { useCurrentAccess } from '@/lib/use-current-role';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Space,
  Popconfirm,
  Typography,
  Tag,
  message,
  Pagination,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type Gender = 'MALE' | 'FEMALE';
const PAGE_SIZE = 20;

interface Player {
  id: string;
  name: string;
  gender: Gender;
  affiliation: string;
  contact?: string;
  notes?: string;
  isTemporary?: boolean;
  createdAt: string;
}

export default function PlayersPage() {
  const { data: session } = useSession();
  const access = useCurrentAccess();
  const token = session?.user?.accessToken as string | undefined;
  const role = (session?.user as { role?: string } | undefined)?.role;
  // 选手库写操作由实时的选手管理权限控制。
  const canManage = access.can('PLAYERS');

  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Player | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchPlayers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ includeTemporary: 'true' });
      if (search) params.set('search', search);
      const q = `?${params.toString()}`;
      const data = await apiFetch<Player[]>(`/players${q}`, { token });
      setPlayers(data);
    } finally {
      setLoading(false);
    }
  }, [token, search]);

  useEffect(() => {
    fetchPlayers();
  }, [fetchPlayers]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (p: Player) => {
    setEditing(p);
    form.setFieldsValue(p);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editing) {
        await apiFetch(`/players/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(values),
          token,
        });
        message.success('已更新');
      } else {
        await apiFetch('/players', { method: 'POST', body: JSON.stringify(values), token });
        message.success('已添加');
      }
      setModalOpen(false);
      fetchPlayers();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/players/${id}`, { method: 'DELETE', token });
      message.success('已删除');
      fetchPlayers();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const columns = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Player) => (
        <Space size={6}>
          <Typography.Text>{name}</Typography.Text>
          {record.isTemporary ? <Tag color="orange">临时参赛</Tag> : null}
        </Space>
      ),
    },
    {
      title: '性别',
      dataIndex: 'gender',
      key: 'gender',
      render: (g: Gender) => <Tag color={g === 'MALE' ? 'blue' : 'pink'}>{g === 'MALE' ? '男' : '女'}</Tag>,
    },
    { title: '学院/班级', dataIndex: 'affiliation', key: 'affiliation' },
    { title: '联系方式', dataIndex: 'contact', key: 'contact', render: (v: string) => v || '-' },
    { title: '备注', dataIndex: 'notes', key: 'notes', render: (v: string) => v || '-' },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: Player) =>
        canManage ? (
          <Space>
            <Button
              icon={<EditOutlined />}
              size="small"
              disabled={record.isTemporary}
              onClick={() => openEdit(record)}
            >
              编辑
            </Button>
            <Popconfirm
              title="确认删除？"
              onConfirm={() => handleDelete(record.id)}
              disabled={record.isTemporary}
            >
              <Button icon={<DeleteOutlined />} size="small" danger disabled={record.isTemporary}>删除</Button>
            </Popconfirm>
          </Space>
        ) : (
          <Typography.Text type="secondary">只读</Typography.Text>
        ),
    },
  ];

  const lastPage = Math.max(1, Math.ceil(players.length / PAGE_SIZE));
  const visiblePage = Math.min(currentPage, lastPage);
  const visiblePlayers = players.slice(
    (visiblePage - 1) * PAGE_SIZE,
    visiblePage * PAGE_SIZE,
  );

  return (
    <div
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          flex: '0 0 auto',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>选手管理</Typography.Title>
        <Space wrap>
          <Input.Search
            placeholder="搜索姓名/学院"
            allowClear
            onSearch={(v) => {
              setCurrentPage(1);
              setSearch(v);
            }}
            style={{ width: 240 }}
          />
          {canManage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加选手</Button>
          ) : null}
        </Space>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={visiblePlayers}
          loading={loading}
          pagination={false}
        />
      </div>

      <div
        style={{
          flex: '0 0 auto',
          display: 'flex',
          justifyContent: 'flex-end',
          paddingTop: 12,
        }}
      >
        <Pagination
          current={visiblePage}
          pageSize={PAGE_SIZE}
          total={players.length}
          showSizeChanger={false}
          onChange={setCurrentPage}
        />
      </div>

      <Modal
        title={editing ? '编辑选手' : '添加选手'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="gender" label="性别" rules={[{ required: true, message: '请选择性别' }]}>
            <Select options={[{ value: 'MALE', label: '男' }, { value: 'FEMALE', label: '女' }]} />
          </Form.Item>
          <Form.Item name="affiliation" label="学院/班级" rules={[{ required: true, message: '请输入学院/班级' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contact" label="联系方式">
            <Input />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
