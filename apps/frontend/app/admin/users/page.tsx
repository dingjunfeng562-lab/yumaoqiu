'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, LockOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type UserItem = {
  id: string;
  username: string;
  role: 'ADMIN' | 'REFEREE';
  createdAt: string;
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
  const [form] = Form.useForm();
  const [resetForm] = Form.useForm();

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

  async function createUser(values: { username: string; password: string; role: 'ADMIN' | 'REFEREE' }) {
    if (!token) return;
    try {
      await apiFetch(values.role === 'ADMIN' ? '/auth/users/admin' : '/auth/users/referee', {
        method: 'POST',
        token,
        body: JSON.stringify({ username: values.username, password: values.password }),
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

  async function resetPassword() {
    if (!token || !resetTarget) return;
    const values = await resetForm.validateFields();
    setResetSubmitting(true);
    try {
      await apiFetch(`/auth/users/${resetTarget.id}/password`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ newPassword: values.newPassword }),
      });
      message.success('裁判密码已重置');
      setResetOpen(false);
      setResetTarget(null);
      resetForm.resetFields();
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
          <Typography.Title level={3} style={{ margin: 0 }}>账号管理</Typography.Title>
          <Typography.Text type="secondary">创建管理员和裁判账号，裁判账号可在“裁判分配”中绑定场次。</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadUsers} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建账号</Button>
        </Space>
      </div>

      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={users}
          columns={[
            { title: '用户名', dataIndex: 'username' },
            {
              title: '角色',
              dataIndex: 'role',
              render: (role: UserItem['role']) => <Tag color={role === 'ADMIN' ? 'blue' : 'green'}>{role === 'ADMIN' ? '管理员' : '裁判'}</Tag>,
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              render: (value: string) => new Date(value).toLocaleString('zh-CN'),
            },
            {
              title: '操作',
              render: (_, row: UserItem) => (
                <Space>
                  {row.role === 'REFEREE' ? (
                    <Button
                      icon={<LockOutlined />}
                      onClick={() => {
                        setResetTarget(row);
                        setResetOpen(true);
                      }}
                    >
                      重置密码
                    </Button>
                  ) : null}
                  <Popconfirm title="确认删除该账号？" onConfirm={() => deleteUser(row.id)}>
                    <Button danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal title="新建账号" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={createUser} initialValues={{ role: 'REFEREE' }}>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'REFEREE', label: '裁判' },
                { value: 'ADMIN', label: '管理员' },
              ]}
            />
          </Form.Item>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={resetTarget ? `重置裁判密码：${resetTarget.username}` : '重置裁判密码'}
        open={resetOpen}
        onCancel={() => {
          setResetOpen(false);
          setResetTarget(null);
          resetForm.resetFields();
        }}
        onOk={resetPassword}
        confirmLoading={resetSubmitting}
        destroyOnHidden
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[{ required: true, min: 6, message: '新密码至少 6 位' }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的新密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
