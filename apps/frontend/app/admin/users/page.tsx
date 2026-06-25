'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, LockOutlined, StopOutlined, CheckCircleOutlined, EditOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type UserRole = 'ROOT' | 'SUPER_ADMIN' | 'ADMIN' | 'REFEREE' | 'PLAYER' | 'PHOTOGRAPHER';

type UserItem = {
  id: string;
  username: string | null;
  email: string | null;
  name: string;
  role: UserRole;
  status: 'ACTIVE' | 'DISABLED';
  inviteCode: string | null;
  refereedMatchesCount?: number;
  createdAt: string;
};

type CreatableRole = 'SUPER_ADMIN' | 'ADMIN' | 'REFEREE' | 'PLAYER' | 'PHOTOGRAPHER';

type CreatedUserPayload = {
  username: string;
  email: string;
  password: string;
  role: CreatableRole;
};

const roleLabels: Record<UserRole, string> = {
  ROOT: '超级管理员',
  SUPER_ADMIN: '总管理员',
  ADMIN: '管理员',
  REFEREE: '裁判',
  PLAYER: '选手',
  PHOTOGRAPHER: '图片上传员',
};

const roleColors: Record<UserRole, string> = {
  ROOT: 'red',
  SUPER_ADMIN: 'magenta',
  ADMIN: 'blue',
  REFEREE: 'green',
  PLAYER: 'gold',
  PHOTOGRAPHER: 'purple',
};

const ROLE_CREATE_ENDPOINT: Record<CreatableRole, string> = {
  SUPER_ADMIN: '/auth/users/super-admin',
  ADMIN: '/auth/users/admin',
  REFEREE: '/auth/users/referee',
  PLAYER: '/auth/users/player',
  PHOTOGRAPHER: '/auth/users/photographer',
};

const usernamePattern = /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_-]{1,19}$/;

const statusLabels: Record<UserItem['status'], string> = {
  ACTIVE: '启用',
  DISABLED: '禁用',
};

const ROLE_FILTER_OPTIONS: Array<{ value: UserRole | 'ALL'; label: string }> = [
  { value: 'ALL', label: '全部角色' },
  { value: 'ROOT', label: '超级管理员' },
  { value: 'SUPER_ADMIN', label: '总管理员' },
  { value: 'ADMIN', label: '管理员' },
  { value: 'REFEREE', label: '裁判' },
  { value: 'PLAYER', label: '选手' },
  { value: 'PHOTOGRAPHER', label: '图片上传员' },
];

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const currentUserId = (session?.user as { id?: string } | undefined)?.id;
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserItem | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<UserRole | 'ALL'>('ALL');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<UserItem | null>(null);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<UserItem | null>(null);
  const [roleSubmitting, setRoleSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [renameForm] = Form.useForm();
  const [roleForm] = Form.useForm();

  const filteredUsers = useMemo(
    () => (roleFilter === 'ALL' ? users : users.filter((user) => user.role === roleFilter)),
    [users, roleFilter],
  );
  const selectedCount = selectedUserIds.length;

  async function loadUsers() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<UserItem[]>('/auth/users', { token });
      setUsers(data);
      setSelectedUserIds((prev) => {
        const selectableIds = new Set(data.filter((user) => user.id !== currentUserId).map((user) => user.id));
        return prev.filter((id) => selectableIds.has(id));
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载账号失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, [token]);

  useEffect(() => {
    setSelectedUserIds([]);
  }, [roleFilter]);

  useEffect(() => {
    if (!currentUserId) return;
    setSelectedUserIds((prev) => prev.filter((id) => id !== currentUserId));
  }, [currentUserId]);

  async function createUser(values: CreatedUserPayload) {
    if (!token) return;
    const endpoint = ROLE_CREATE_ENDPOINT[values.role];
    if (!endpoint) {
      message.error('未知的角色类型');
      return;
    }
    try {
      await apiFetch(endpoint, {
        method: 'POST',
        token,
        body: JSON.stringify({ username: values.username, email: values.email, password: values.password }),
      });
      message.success(`已创建${roleLabels[values.role]}账号`);
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

  async function deleteSelectedUsers() {
    if (!token || selectedUserIds.length === 0) return;
    const ids = selectedUserIds.filter((id) => id !== currentUserId);
    if (!ids.length) {
      setSelectedUserIds([]);
      message.warning('请选择要删除的账号');
      return;
    }
    setBatchDeleting(true);
    try {
      const result = await apiFetch<{ deleted: number }>('/auth/users', {
        method: 'DELETE',
        token,
        body: JSON.stringify({ ids }),
      });
      message.success(`已删除 ${result.deleted} 个账号`);
      setSelectedUserIds([]);
      await loadUsers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '批量删除账号失败');
    } finally {
      setBatchDeleting(false);
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

  function openRename(user: UserItem) {
    setRenameTarget(user);
    renameForm.setFieldsValue({ name: user.username ?? '' });
    setRenameOpen(true);
  }

  async function submitRename() {
    if (!token || !renameTarget) return;
    let values: { name: string };
    try {
      values = await renameForm.validateFields();
    } catch {
      return;
    }
    const nextName = values.name.trim();
    setRenameSubmitting(true);
    try {
      await apiFetch(`/auth/users/${renameTarget.id}/name`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ name: nextName }),
      });
      message.success('昵称已修改');
      setRenameOpen(false);
      setRenameTarget(null);
      renameForm.resetFields();
      await loadUsers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '修改昵称失败');
    } finally {
      setRenameSubmitting(false);
    }
  }

  function openRole(user: UserItem) {
    setRoleTarget(user);
    roleForm.setFieldsValue({ role: user.role });
    setRoleOpen(true);
  }

  async function submitRole() {
    if (!token || !roleTarget) return;
    let values: { role: UserRole };
    try {
      values = await roleForm.validateFields();
    } catch {
      return;
    }
    setRoleSubmitting(true);
    try {
      await apiFetch(`/auth/users/${roleTarget.id}/role`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ role: values.role }),
      });
      message.success('已修改用户权限');
      setRoleOpen(false);
      setRoleTarget(null);
      roleForm.resetFields();
      await loadUsers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '修改权限失败');
    } finally {
      setRoleSubmitting(false);
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
          <Typography.Text type="secondary">
            管理 <strong>总管理员 / 管理员 / 裁判 / 选手</strong> 四类账号,支持状态切换和临时密码重置。
          </Typography.Text>
        </div>
        <Space>
          <Select
            value={roleFilter}
            onChange={(value) => setRoleFilter(value)}
            options={ROLE_FILTER_OPTIONS}
            style={{ width: 140 }}
          />
          <Popconfirm
            title={`确认删除选中的 ${selectedCount} 个账号？`}
            description="此操作不可恢复。"
            okText="确认删除"
            cancelText="取消"
            onConfirm={deleteSelectedUsers}
            disabled={selectedCount === 0}
          >
            <Button danger icon={<DeleteOutlined />} disabled={selectedCount === 0} loading={batchDeleting}>
              批量删除{selectedCount ? `(${selectedCount})` : ''}
            </Button>
          </Popconfirm>
          <Button icon={<ReloadOutlined />} onClick={loadUsers} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建账号</Button>
        </Space>
      </div>

      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={filteredUsers}
          rowSelection={{
            selectedRowKeys: selectedUserIds,
            onChange: (keys) => setSelectedUserIds(keys.map(String)),
            getCheckboxProps: (row) => ({
              disabled: row.id === currentUserId,
              name: row.username ?? row.email ?? row.id,
            }),
          }}
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
              title: '已裁场次',
              dataIndex: 'refereedMatchesCount',
              render: (value: number | undefined, row: UserItem) =>
                row.role === 'REFEREE' ? (
                  <Tag color={value ? 'blue' : 'default'}>{value ?? 0} 场</Tag>
                ) : (
                  '-'
                ),
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
                    <Button
                      icon={<StopOutlined />}
                      onClick={() => updateStatus(row, 'DISABLED')}
                      disabled={row.id === currentUserId}
                      title={row.id === currentUserId ? '不能禁用自己的账号' : undefined}
                    >
                      禁用
                    </Button>
                  ) : (
                    <Button icon={<CheckCircleOutlined />} onClick={() => updateStatus(row, 'ACTIVE')}>
                      启用
                    </Button>
                  )}
                  <Button icon={<EditOutlined />} onClick={() => openRename(row)}>
                    改名
                  </Button>
                  <Button
                    icon={<SafetyCertificateOutlined />}
                    onClick={() => openRole(row)}
                    disabled={row.id === currentUserId}
                    title={row.id === currentUserId ? '不能修改自己的角色' : undefined}
                  >
                    权限
                  </Button>
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
                  {row.id === currentUserId ? (
                    <Button danger icon={<DeleteOutlined />} disabled title="不能删除自己的账号">
                      删除
                    </Button>
                  ) : (
                    <Popconfirm title="确认删除该账号？" onConfirm={() => deleteUser(row.id)}>
                      <Button danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal title="新建账号" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={createUser} initialValues={{ role: 'REFEREE' }}>
          <Form.Item name="role" label="角色" rules={[{ required: true }]} extra="超级管理员(最高权限)账号无法在此创建,如有需要请直接修改数据库。">
            <Select
              options={[
                { value: 'SUPER_ADMIN', label: '总管理员 · 赛事运营管理(不含邮件/邀请码/用户管理,选手报名只读)' },
                { value: 'ADMIN', label: '管理员 · 可新建/编辑赛事,需总管理员审核' },
                { value: 'REFEREE', label: '裁判 · 仅可记分,无后台权限' },
                { value: 'PLAYER', label: '选手 · 仅可查看本人报名信息' },
                { value: 'PHOTOGRAPHER', label: '图片上传员 · 仅可进入赛事图片上传页' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              {
                pattern: usernamePattern,
                message: '用户名需为 2-20 位中文、字母、数字、下划线或连字符，首字符需为中文或字母',
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
        title={roleTarget ? `修改权限：${roleTarget.username || roleTarget.email}` : '修改权限'}
        open={roleOpen}
        onOk={submitRole}
        onCancel={() => {
          setRoleOpen(false);
          setRoleTarget(null);
          roleForm.resetFields();
        }}
        confirmLoading={roleSubmitting}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          超级管理员可将该用户调整为任意角色(包括超级管理员)。角色变更在后端即时生效;对方刷新页面或重新登录后,前端显示与菜单权限同步更新。
        </Typography.Paragraph>
        <Form form={roleForm} layout="vertical">
          <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select
              options={(Object.keys(roleLabels) as UserRole[]).map((r) => ({
                value: r,
                label: roleLabels[r],
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={renameTarget ? `修改昵称：${renameTarget.username || renameTarget.email}` : '修改昵称'}
        open={renameOpen}
        onOk={submitRename}
        onCancel={() => {
          setRenameOpen(false);
          setRenameTarget(null);
          renameForm.resetFields();
        }}
        confirmLoading={renameSubmitting}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          总管理员修改昵称不消耗用户本人的改名次数。昵称在所有用户中唯一，且会同步为登录用户名。
        </Typography.Paragraph>
        <Form form={renameForm} layout="vertical">
          <Form.Item
            name="name"
            label="新昵称"
            rules={[
              { required: true, message: '请输入新昵称' },
              {
                pattern: usernamePattern,
                message: '昵称需为 2-20 位中文、字母、数字、下划线或连字符，首字符需为中文或字母',
              },
            ]}
          >
            <Input maxLength={20} />
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
