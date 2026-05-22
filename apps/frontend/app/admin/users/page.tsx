'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, LockOutlined, StopOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type UserItem = {
  id: string;
  username: string | null;
  email: string | null;
  name: string;
  role: 'ADMIN' | 'REFEREE' | 'PLAYER';
  status: 'ACTIVE' | 'DISABLED';
  inviteCode: string | null;
  registrationStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REMOVED' | null;
  createdAt: string;
};

type CreatedUserPayload = {
  username: string;
  email: string;
  password: string;
  role: 'ADMIN' | 'REFEREE';
};

const roleLabels: Record<UserItem['role'], string> = {
  ADMIN: '管理员',
  REFEREE: '裁判',
  PLAYER: '普通用户',
};

const roleColors: Record<UserItem['role'], string> = {
  ADMIN: 'blue',
  REFEREE: 'green',
  PLAYER: 'gold',
};

const statusLabels: Record<UserItem['status'], string> = {
  ACTIVE: '启用',
  DISABLED: '禁用',
};

const registrationStatusLabels: Record<NonNullable<UserItem['registrationStatus']>, string> = {
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  REMOVED: '已移除',
};

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserItem | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [form] = Form.useForm();

  async function loadUsers() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<UserItem[]>('/auth/users', { token });
      setUsers(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载账号失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, [token]);

  async function createUser(values: CreatedUserPayload) {
    if (!token) return;
    try {
      await apiFetch(values.role === 'ADMIN' ? '/auth/users/admin' : '/auth/users/referee', {
        method: 'POST',
        token,
        body: JSON.stringify({ username: values.username, email: values.email, password: values.password }),
      });
      message.success('账号已创建');
      setOpen(false);
      form.resetFields();
      await loadUsers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建账号失败');
    }
  }

  async function deleteUser(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/auth/users/${id}`, { method: 'DELETE', token });
      message.success('账号已删除');
      await loadUsers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除账号失败');
    }
  }

  async function updateStatus(user: UserItem, status: UserItem['status']) {
    if (!token) return;
    try {
      await apiFetch(`/auth/users/${user.id}/status`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ status }),
      });
      message.success(status === 'ACTIVE' ? '账号已启用' : '账号已禁用');
      await loadUsers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新状态失败');
    }
  }

  async function resetPassword() {
    if (!token || !resetTarget) return;
    setResetSubmitting(true);
    try {
      const result = await apiFetch<{ temporaryPassword: string }>(`/auth/users/${resetTarget.id}/reset-password`, {
        method: 'POST',
        token,
      });
      setTemporaryPassword(result.temporaryPassword);
      message.success('临时密码已生成，请仅通过线下方式告知用户');
      await loadUsers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重置密码失败');
    } finally {
      setResetSubmitting(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>用户管理</Typography.Title>
          <Typography.Text type="secondary">管理管理员、裁判与普通用户，支持账号状态切换和临时密码重置。</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadUsers} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建后台账号</Button>
        </Space>
      </div>

      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={users}
          columns={[
            {
              title: '用户名',
              dataIndex: 'username',
              render: (value: string | null) => value || '-',
            },
            {
              title: '邮箱',
              dataIndex: 'email',
              render: (value: string | null) => value || '-',
            },
            {
              title: '角色',
              dataIndex: 'role',
              render: (role: UserItem['role']) => <Tag color={roleColors[role]}>{roleLabels[role]}</Tag>,
            },
            {
              title: '账号状态',
              dataIndex: 'status',
              render: (status: UserItem['status']) => (
                <Tag color={status === 'ACTIVE' ? 'green' : 'red'}>{statusLabels[status]}</Tag>
              ),
            },
            {
              title: '邀请码',
              dataIndex: 'inviteCode',
              render: (value: string | null) => value || '-',
            },
            {
              title: '报名状态',
              dataIndex: 'registrationStatus',
              render: (value: UserItem['registrationStatus']) => value ? registrationStatusLabels[value] : '-',
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              render: (value: string) => new Date(value).toLocaleString('zh-CN'),
            },
            {
              title: '操作',
              render: (_, row: UserItem) => (
                <Space wrap>
                  {row.status === 'ACTIVE' ? (
                    <Button icon={<StopOutlined />} onClick={() => updateStatus(row, 'DISABLED')}>
                      禁用
                    </Button>
                  ) : (
                    <Button icon={<CheckCircleOutlined />} onClick={() => updateStatus(row, 'ACTIVE')}>
                      启用
                    </Button>
                  )}
                  <Button
                    icon={<LockOutlined />}
                    onClick={() => {
                      setResetTarget(row);
                      setTemporaryPassword(null);
                      setResetOpen(true);
                    }}
                  >
                    重置密码
                  </Button>
                  <Popconfirm title="确认删除该账号？" onConfirm={() => deleteUser(row.id)}>
                    <Button danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal title="新建后台账号" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={createUser} initialValues={{ role: 'REFEREE' }}>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'REFEREE', label: '裁判' },
                { value: 'ADMIN', label: '管理员' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              {
                pattern: /^[A-Za-z][A-Za-z0-9_]{3,19}$/,
                message: '用户名需为 4-20 位字母、数字或下划线，且首字符为字母',
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              {
                pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[^\s\u4e00-\u9fa5]{8,32}$/,
                message: '密码需为 8-32 位，并同时包含大写字母、小写字母和数字，且不能包含空格或中文',
              },
            ]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={resetTarget ? `重置密码：${resetTarget.email || resetTarget.username}` : '重置密码'}
        open={resetOpen}
        onCancel={() => {
          setResetOpen(false);
          setResetTarget(null);
          setTemporaryPassword(null);
        }}
        onOk={resetPassword}
        confirmLoading={resetSubmitting}
        okText="生成临时密码"
        destroyOnHidden
      >
        <Typography.Paragraph>
          系统将生成一次性临时密码，并要求用户下次登录后立即修改。
        </Typography.Paragraph>
        {temporaryPassword ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
            临时密码：{temporaryPassword}
          </div>
        ) : null}
      </Modal>
    </Space>
  );
}
