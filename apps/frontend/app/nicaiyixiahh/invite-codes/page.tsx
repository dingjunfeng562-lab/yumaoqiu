'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { useCurrentRole } from '@/lib/use-current-role';

type InviteRole = 'ROOT' | 'ADMIN' | 'REFEREE' | 'PLAYER' | 'PHOTOGRAPHER';

type InviteCodeItem = {
  id: string;
  code: string;
  role: InviteRole;
  maxUses: number;
  usedUses: number;
  expiresAt?: string | null;
  isEnabled: boolean;
  remark?: string | null;
  createdAt: string;
  createdById?: string | null;
  createdBy?: { id: string; username: string; role: string } | null;
};

type CreateInviteCodePayload = {
  role: InviteRole;
  maxUses: number;
  expiresAt?: string;
  remark?: string;
};

const roleLabels: Record<InviteRole, string> = {
  ROOT: '超级管理员（已停用的历史邀请码）',
  ADMIN: '管理员',
  REFEREE: '裁判',
  PLAYER: '选手',
  PHOTOGRAPHER: '图片上传员',
};

const roleColors: Record<InviteRole, string> = {
  ROOT: 'red',
  ADMIN: 'blue',
  REFEREE: 'green',
  PLAYER: 'gold',
  PHOTOGRAPHER: 'purple',
};

export default function InviteCodesPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const role = useCurrentRole();
  const [quota, setQuota] = useState<{ limit: number | null; used: number; remaining: number | null }>();
  const [inviteCodes, setInviteCodes] = useState<InviteCodeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const watchedMaxUses = Form.useWatch('maxUses', form) as number | null | undefined;
  const balance = role === 'ROOT' ? null : quota?.remaining ?? null;
  const validUses =
    balance !== null &&
    watchedMaxUses !== null &&
    watchedMaxUses !== undefined &&
    watchedMaxUses >= 1 &&
    watchedMaxUses <= balance;
  const nextBalance = validUses ? balance - (watchedMaxUses ?? 0) : null;
  const noBalance = balance === 0;
  const quotaReady = role === 'ROOT' || quota !== undefined;
  const createDisabled = !quotaReady || noBalance;

  const loadInviteCodes = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [data, currentQuota] = await Promise.all([
        apiFetch<InviteCodeItem[]>('/auth/invite-codes', { token }),
        apiFetch<{ limit: number | null; used: number; remaining: number | null }>('/auth/invite-quota', { token }),
      ]);
      setInviteCodes(data);
      setQuota(currentQuota);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载邀请码失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadInviteCodes();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadInviteCodes]);

  async function createInviteCode(values: CreateInviteCodePayload) {
    if (!token) return;
    try {
      await apiFetch('/auth/invite-codes', {
        method: 'POST',
        token,
        body: JSON.stringify(values),
      });
      message.success(`邀请码已生成，已占用 ${values.maxUses} 次余额`);
      setOpen(false);
      form.resetFields();
      await loadInviteCodes();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '生成邀请码失败');
    }
  }

  async function updateStatus(item: InviteCodeItem, isEnabled: boolean) {
    if (!token) return;
    try {
      await apiFetch(`/auth/invite-codes/${item.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ isEnabled }),
      });
      message.success(isEnabled ? '邀请码已启用' : '邀请码已禁用');
      await loadInviteCodes();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新状态失败');
    }
  }

  async function deleteInviteCode(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/auth/invite-codes/${id}`, { method: 'DELETE', token });
      message.success('邀请码已删除');
      await loadInviteCodes();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除邀请码失败');
    }
  }

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code);
    message.success('邀请码已复制');
  }

  function canManage(item: InviteCodeItem) {
    if (role === 'ROOT') return true;
    if (role !== 'ROOT') return item.createdById === session?.user?.id;
    return false;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>邀请码管理</Typography.Title>
          <Typography.Text type="secondary">生成、复制、启停用和删除邀请码，注册角色由邀请码决定。</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadInviteCodes} loading={loading}>刷新</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setOpen(true)}
            disabled={createDisabled}
            title={
              noBalance
                ? '邀请码余额不足，请联系超级管理员分配'
                : !quotaReady
                  ? '正在加载邀请码余额'
                  : undefined
            }
          >
            生成邀请码
          </Button>
        </Space>
      </div>

      {role !== 'ROOT' && quota && <Card size="small" title="邀请码余额">
        <Typography.Text strong>总额度 {quota.limit} · 已占用 {quota.used} · 余额 {quota.remaining}</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
          所有角色的邀请码都从这份余额扣除：创建时按填写的使用次数占用，注册时不再重复扣除。删除邀请码或账号不返还余额。直接创建裁判/图片员账号仍占用 1 次。余额不足时可联系超级管理员分配。
        </Typography.Paragraph>
      </Card>}
      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={inviteCodes}
          columns={[
            { title: '邀请码', dataIndex: 'code' },
            ...(role === 'ROOT' ? [{ title: '发放人', key: 'issuer', render: (_: unknown, row: InviteCodeItem) => row.createdBy?.username ?? '历史邀请码' }] : []),
            {
              title: '角色',
              dataIndex: 'role',
              render: (role: InviteRole) => <Tag color={roleColors[role]}>{roleLabels[role]}</Tag>,
            },
            {
              title: '已注册/次数',
              key: 'usage',
              render: (_, row: InviteCodeItem) => `${row.usedUses}/${row.maxUses}`,
            },
            {
              title: '状态',
              key: 'status',
              render: (_, row: InviteCodeItem) => <Tag color={row.isEnabled ? 'green' : 'red'}>{row.isEnabled ? '启用' : '禁用'}</Tag>,
            },
            {
              title: '有效期',
              dataIndex: 'expiresAt',
              render: (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '长期有效',
            },
            {
              title: '备注',
              dataIndex: 'remark',
              render: (value?: string | null) => value || '-',
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              render: (value: string) => new Date(value).toLocaleString('zh-CN'),
            },
            {
              title: '操作',
              render: (_, row: InviteCodeItem) => (
                <Space wrap>
                  <Button icon={<CopyOutlined />} onClick={() => copyCode(row.code)}>复制</Button>
                  <Switch disabled={!canManage(row)} checked={row.isEnabled} checkedChildren="启用" unCheckedChildren="禁用" onChange={(checked) => updateStatus(row, checked)} />
                  <Popconfirm title="确认删除该邀请码？创建时占用的余额不会返还。" disabled={!canManage(row)} onConfirm={() => deleteInviteCode(row.id)}>
                    <Button disabled={!canManage(row)} danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal title="生成邀请码" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={createInviteCode} initialValues={{ role: 'PLAYER', maxUses: 1 }}>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true }]}
            extra="注册角色由邀请码决定；所有角色的邀请码都会占用发放人的余额。"
          >
            <Select
              options={[
                { value: 'PLAYER', label: '选手' },
                { value: 'REFEREE', label: '裁判' },
                { value: 'ADMIN', label: '管理员' },
                { value: 'PHOTOGRAPHER', label: '图片上传员' },
              ].filter((item) => role === 'ROOT' || item.value !== 'ADMIN')}
            />
          </Form.Item>
          {balance !== null ? (
            <Alert
              type={balance > 0 ? 'info' : 'warning'}
              showIcon
              style={{ marginBottom: 16 }}
              message={`当前邀请码余额：${balance} 次`}
              description="创建后立即从余额扣除填写的次数，注册时不再重复扣除。"
            />
          ) : null}
          <Form.Item
            name="maxUses"
            label="使用次数"
            rules={[
              { required: true, message: '请输入使用次数' },
              {
                validator: (_, value) => {
                  if (value === undefined || value === null) return Promise.resolve();
                  if (value < 1) return Promise.reject(new Error('使用次数至少为 1'));
                  if (balance !== null && value > balance) {
                    return Promise.reject(new Error(`不能大于当前余额（${balance} 次）`));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            extra={
              balance !== null
                ? `最多可填写 ${balance} 次${nextBalance !== null ? `，创建后余额变为 ${nextBalance} 次` : ''}`
                : '该邀请码最多可注册的账号数'
            }
          >
            <InputNumber
              min={1}
              precision={0}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item name="expiresAt" label="有效期（可选）">
            <Input placeholder="例如 2026-12-31T23:59:59.000Z" />
          </Form.Item>
          <Form.Item name="remark" label="备注（可选）">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
