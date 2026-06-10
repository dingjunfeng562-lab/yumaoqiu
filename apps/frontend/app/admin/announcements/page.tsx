'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { apiFetch } from '@/lib/api';
import { announcementPlainText } from '@/lib/announcement-html';
import { RichTextEditor } from '@/components/RichTextEditor';

type AnnouncementType = 'normal' | 'event' | 'maintenance' | 'urgent';
type DisplayMode = 'popup' | 'banner';
type Scope = 'global' | 'home';
type Frequency = 'every_visit' | 'once_per_day' | 'once';
type AnnouncementStatus = 'draft' | 'published' | 'disabled';

type Announcement = {
  id: string;
  title: string;
  content: string;
  type: AnnouncementType;
  displayMode: DisplayMode;
  scope: Scope;
  frequency: Frequency;
  status: AnnouncementStatus;
  startAt: string;
  endAt?: string | null;
  closable: boolean;
  primaryButtonText?: string | null;
  primaryButtonLink?: string | null;
  secondaryButtonText?: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

type AnnouncementFormValues = {
  title: string;
  content: string;
  type: AnnouncementType;
  displayMode: DisplayMode;
  scope: Scope;
  frequency: Frequency;
  status: AnnouncementStatus;
  startAt?: Dayjs | null;
  endAt?: Dayjs | null;
  closable?: boolean;
  primaryButtonText?: string;
  primaryButtonLink?: string;
  secondaryButtonText?: string;
  priority?: number;
};

const typeOptions = [
  { label: '普通公告', value: 'normal' },
  { label: '赛事公告', value: 'event' },
  { label: '系统维护', value: 'maintenance' },
  { label: '紧急通知', value: 'urgent' },
];

const displayModeOptions = [
  { label: '弹窗公告', value: 'popup' },
  { label: '顶部横幅', value: 'banner' },
];

const scopeOptions = [
  { label: '全站显示', value: 'global' },
  { label: '仅首页显示', value: 'home' },
];

const frequencyOptions = [
  { label: '每次访问都弹', value: 'every_visit' },
  { label: '每天只弹一次', value: 'once_per_day' },
  { label: '只弹一次', value: 'once' },
];

const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '已发布', value: 'published' },
  { label: '已下线', value: 'disabled' },
];

const typeMeta: Record<string, { label: string; color: string }> = {
  normal: { label: '普通公告', color: 'blue' },
  event: { label: '赛事公告', color: 'geekblue' },
  maintenance: { label: '系统维护', color: 'orange' },
  urgent: { label: '紧急通知', color: 'red' },
};

const statusMeta: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  published: { label: '已发布', color: 'green' },
  disabled: { label: '已下线', color: 'red' },
};

function formatDate(value?: string | null) {
  if (!value) return '-';
  return dayjs(value).format('YYYY-MM-DD HH:mm');
}

function serializeDate(value?: Dayjs | null) {
  if (value === undefined) return undefined;
  return value ? value.toISOString() : null;
}

function trimOrNull(value?: string) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function normalizeAnnouncementType(value?: string): AnnouncementType {
  if (value === 'normal' || value === 'event' || value === 'maintenance' || value === 'urgent') return value;
  if (value === '赛事公告' || value === '赛事') return 'event';
  if (value === '系统维护' || value === '维护') return 'maintenance';
  if (value === '紧急通知' || value === '紧急') return 'urgent';
  return 'normal';
}

export default function AdminAnnouncementsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<AnnouncementFormValues>();

  const loadAnnouncements = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<Announcement[]>('/admin/announcements', { token });
      setAnnouncements(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载公告失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAnnouncements();
  }, [loadAnnouncements]);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      type: 'normal',
      displayMode: 'popup',
      scope: 'global',
      frequency: 'every_visit',
      status: 'draft',
      startAt: dayjs(),
      endAt: null,
      closable: true,
      primaryButtonText: '立即查看',
      primaryButtonLink: '',
      secondaryButtonText: '稍后再说',
      priority: 0,
    });
    setModalOpen(true);
  }

  function openEdit(record: Announcement) {
    setEditing(record);
    form.setFieldsValue({
      title: record.title,
      content: record.content,
      type: normalizeAnnouncementType(record.type),
      displayMode: record.displayMode,
      scope: record.scope,
      frequency: record.frequency,
      status: record.status,
      startAt: record.startAt ? dayjs(record.startAt) : dayjs(),
      endAt: record.endAt ? dayjs(record.endAt) : null,
      closable: record.closable,
      primaryButtonText: record.primaryButtonText ?? undefined,
      primaryButtonLink: record.primaryButtonLink ?? undefined,
      secondaryButtonText: record.secondaryButtonText ?? undefined,
      priority: record.priority,
    });
    setModalOpen(true);
  }

  async function saveAnnouncement(values: AnnouncementFormValues) {
    if (!token) return;
    const payload = {
      title: values.title.trim(),
      content: values.content.trim(),
      type: values.type,
      displayMode: values.displayMode,
      scope: values.scope,
      frequency: values.frequency,
      status: values.status,
      startAt: serializeDate(values.startAt) ?? new Date().toISOString(),
      endAt: serializeDate(values.endAt),
      closable: values.closable ?? true,
      primaryButtonText: trimOrNull(values.primaryButtonText),
      primaryButtonLink: trimOrNull(values.primaryButtonLink),
      secondaryButtonText: trimOrNull(values.secondaryButtonText),
      priority: Number(values.priority ?? 0),
    };

    setSubmitting(true);
    try {
      if (editing) {
        await apiFetch(`/admin/announcements/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
          token,
        });
        message.success('公告已更新');
      } else {
        await apiFetch('/admin/announcements', {
          method: 'POST',
          body: JSON.stringify(payload),
          token,
        });
        message.success('公告已创建');
      }
      setModalOpen(false);
      form.resetFields();
      await loadAnnouncements();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存公告失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(record: Announcement, status: 'published' | 'disabled') {
    if (!token) return;
    try {
      await apiFetch(`/admin/announcements/${record.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
        token,
      });
      message.success(status === 'published' ? '公告已发布' : '公告已下线');
      await loadAnnouncements();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '状态更新失败');
    }
  }

  async function deleteAnnouncement(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/admin/announcements/${id}`, { method: 'DELETE', token });
      message.success('公告已删除');
      await loadAnnouncements();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除公告失败');
    }
  }

  const columns: ColumnsType<Announcement> = [
    {
      title: '公告标题',
      dataIndex: 'title',
      width: 220,
      render: (value: string, record) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0, maxWidth: 360 }}>
            {announcementPlainText(record.content)}
          </Typography.Paragraph>
        </Space>
      ),
    },
    {
      title: '公告类型',
      dataIndex: 'type',
      width: 110,
      render: (value: string) => <Tag color={typeMeta[value]?.color ?? 'blue'}>{typeMeta[value]?.label ?? value}</Tag>,
    },
    {
      title: '显示位置',
      key: 'display',
      width: 150,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Tag color={record.displayMode === 'popup' ? 'magenta' : 'cyan'}>
            {record.displayMode === 'popup' ? '弹窗公告' : '顶部横幅'}
          </Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.scope === 'global' ? '全站显示' : '仅首页显示'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: string) => (
        <Tag color={statusMeta[value]?.color ?? 'default'}>{statusMeta[value]?.label ?? value}</Tag>
      ),
    },
    { title: '开始时间', dataIndex: 'startAt', width: 170, render: (value: string) => formatDate(value) },
    { title: '结束时间', dataIndex: 'endAt', width: 170, render: (value: string | null) => formatDate(value) },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (value: string) => formatDate(value) },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 260,
      render: (_, record) => (
        <Space wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          {record.status !== 'published' ? (
            <Button size="small" type="primary" onClick={() => updateStatus(record, 'published')}>
              发布
            </Button>
          ) : (
            <Button size="small" onClick={() => updateStatus(record, 'disabled')}>
              下线
            </Button>
          )}
          <Popconfirm title="确认删除该公告？" onConfirm={() => deleteAnnouncement(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            公告管理
          </Typography.Title>
          <Typography.Text type="secondary">由总管理员统一维护全站弹窗、横幅等公告。</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadAnnouncements} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增公告
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={announcements}
          scroll={{ x: 1350 }}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editing ? '编辑公告' : '新增公告'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        width={760}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={saveAnnouncement} style={{ marginTop: 16 }}>
          <Form.Item
            name="title"
            label="公告标题"
            rules={[{ required: true, whitespace: true, message: '请输入公告标题' }]}
          >
            <Input maxLength={120} showCount placeholder="首页公告、赛事报名提醒、系统维护通知" />
          </Form.Item>
          <Form.Item
            name="content"
            label="公告内容"
            rules={[
              {
                required: true,
                message: '请输入公告内容',
                // 富文本为空时 innerHTML 仍可能是 <p><br></p>，按纯文本判断
                validator: (_, value: string | undefined) =>
                  value && announcementPlainText(value).trim()
                    ? Promise.resolve()
                    : Promise.reject(new Error('请输入公告内容')),
              },
            ]}
          >
            <RichTextEditor placeholder="请输入要展示给前台用户的公告内容；选中文字后可设置颜色、加粗、字号" />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <Form.Item name="type" label="公告类型" rules={[{ required: true }]}>
              <Select options={typeOptions} />
            </Form.Item>
            <Form.Item name="displayMode" label="显示方式" rules={[{ required: true }]}>
              <Select options={displayModeOptions} />
            </Form.Item>
            <Form.Item name="scope" label="显示范围" rules={[{ required: true }]}>
              <Select options={scopeOptions} />
            </Form.Item>
            <Form.Item name="frequency" label="弹出频率" rules={[{ required: true }]}>
              <Select options={frequencyOptions} />
            </Form.Item>
            <Form.Item name="status" label="状态" rules={[{ required: true }]}>
              <Select options={statusOptions} />
            </Form.Item>
            <Form.Item name="priority" label="优先级">
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <Form.Item name="startAt" label="开始时间" rules={[{ required: true, message: '请选择开始时间' }]}>
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="endAt" label="结束时间">
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          </div>

          <Form.Item name="closable" label="是否允许关闭" valuePropName="checked">
            <Switch checkedChildren="允许" unCheckedChildren="不允许" />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <Form.Item name="primaryButtonText" label="主按钮文字">
              <Input maxLength={40} placeholder="立即查看" />
            </Form.Item>
            <Form.Item name="primaryButtonLink" label="主按钮跳转地址">
              <Input maxLength={255} placeholder="/events" />
            </Form.Item>
            <Form.Item name="secondaryButtonText" label="次按钮文字">
              <Input maxLength={40} placeholder="稍后再说" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </Space>
  );
}
