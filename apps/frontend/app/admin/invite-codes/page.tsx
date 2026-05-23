'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type InviteRole = 'SUPER_ADMIN' | 'ADMIN' | 'REFEREE' | 'PLAYER';

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
};

type CreateInviteCodePayload = {
  role: InviteRole;
  maxUses: number;
  expiresAt?: string;
  remark?: string;
};

const roleLabels: Record<InviteRole, string> = {
  SUPER_ADMIN: '总管理员',
  ADMIN: '管理员',
  REFEREE: '裁判',
  PLAYER: '选手',
};

const roleColors: Record<InviteRole, string> = {
  SUPER_ADMIN: 'magenta',
  ADMIN: 'blue',
  REFEREE: 'green',
  PLAYER: 'gold',
};

export default function InviteCodesPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [inviteCodes, setInviteCodes] = useState<InviteCodeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  async function loadInviteCodes() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<InviteCodeItem[]>('/auth/invite-codes', { token });
      setInviteCodes(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载邀请码失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInviteCodes();
  }, [token]);

  async function createInviteCode(values: CreateInviteCodePayload) {
    if (!token) return;
    try {
      await apiFetch('/auth/invite-codes', {
        method: 'POST',
        token,
        body: JSON.stringify(values),
      });
      message.success('邀请码已生成');
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

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>邀请码管理</Typography.Title>
          <Typography.Text type="secondary">生成、复制、启停用和删除邀请码，注册角色由邀请码决定。</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadInviteCodes} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>生成邀请码</Button>
        </Space>
      </div>

      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={inviteCodes}
          columns={[
            { title: '邀请码', dataIndex: 'code' },
            {
              title: '角色',
              dataIndex: 'role',
              render: (role: InviteRole) => <Tag color={roleColors[role]}>{roleLabels[role]}</Tag>,
            },
            {
              title: '已用/总数',
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
                  <Switch checked={row.isEnabled} checkedChildren="启用" unCheckedChildren="禁用" onChange={(checked) => updateStatus(row, checked)} />
                  <Popconfirm title="确认删除该邀请码？" onConfirm={() => deleteInviteCode(row.id)}>
                    <Button danger icon={<DeleteOutlined />}>删除</Button>
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
            extra="总管理员账号不通过邀请码发放,请直接在数据库标记。"
          >
            <Select
              options={[
                { value: 'PLAYER', label: '选手' },
                { value: 'REFEREE', label: '裁判' },
                { value: 'ADMIN', label: '管理员' },
              ]}
            />
          </Form.Item>
          <Form.Item name="maxUses" label="最大使用次数" rules={[{ required: true, message: '请输入最大使用次数' }]}>
            <Input type="number" min={1} />
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
