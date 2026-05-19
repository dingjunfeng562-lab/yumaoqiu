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

type Announcement = {
  id: string;
  title: string;
  content: string;
  type: string;
  isPublished: boolean;
  isPinned: boolean;
  sortOrder: number;
  publishedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type AnnouncementFormValues = {
  title: string;
  content: string;
  type?: string;
  isPublished?: boolean;
  isPinned?: boolean;
  sortOrder?: number;
  publishedAt?: Dayjs | null;
  expiresAt?: Dayjs | null;
};

function formatDate(value?: string | null) {
  if (!value) return '-';
  return dayjs(value).format('YYYY-MM-DD HH:mm');
}

function isExpired(value?: string | null) {
  return Boolean(value && dayjs(value).isBefore(dayjs()));
}

function serializeDate(value?: Dayjs | null) {
  if (value === undefined) return undefined;
  return value ? value.toISOString() : null;
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
      const data = await apiFetch<Announcement[]>('/announcements', { token });
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
      type: '公告',
      isPublished: true,
      isPinned: false,
      sortOrder: 0,
      publishedAt: dayjs(),
    });
    setModalOpen(true);
  }

  function openEdit(record: Announcement) {
    setEditing(record);
    form.setFieldsValue({
      title: record.title,
      content: record.content,
      type: record.type,
      isPublished: record.isPublished,
      isPinned: record.isPinned,
      sortOrder: record.sortOrder,
      publishedAt: record.publishedAt ? dayjs(record.publishedAt) : undefined,
      expiresAt: record.expiresAt ? dayjs(record.expiresAt) : undefined,
    });
    setModalOpen(true);
  }

  async function saveAnnouncement(values: AnnouncementFormValues) {
    if (!token) return;
    const payload = {
      title: values.title.trim(),
      content: values.content.trim(),
      type: values.type?.trim() || '公告',
      isPublished: Boolean(values.isPublished),
      isPinned: Boolean(values.isPinned),
      sortOrder: Number(values.sortOrder ?? 0),
      publishedAt: serializeDate(values.publishedAt),
      expiresAt: serializeDate(values.expiresAt),
    };

    setSubmitting(true);
    try {
      if (editing) {
        await apiFetch(`/announcements/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
          token,
        });
        message.success('公告已更新');
      } else {
        await apiFetch('/announcements', {
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

  async function togglePublished(record: Announcement) {
    if (!token) return;
    try {
      await apiFetch(`/announcements/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPublished: !record.isPublished }),
        token,
      });
      message.success(record.isPublished ? '公告已下架' : '公告已发布');
      await loadAnnouncements();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '状态更新失败');
    }
  }

  async function deleteAnnouncement(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/announcements/${id}`, { method: 'DELETE', token });
      message.success('公告已删除');
      await loadAnnouncements();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除公告失败');
    }
  }

  const columns: ColumnsType<Announcement> = [
    {
      title: '公告内容',
      key: 'content',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{record.title}</Typography.Text>
          <Typography.Paragraph
            ellipsis={{ rows: 2 }}
            style={{ margin: 0, maxWidth: 520, color: 'rgba(0, 0, 0, 0.45)' }}
          >
            {record.content}
          </Typography.Paragraph>
        </Space>
      ),
    },
    {
      title: '分类',
      dataIndex: 'type',
      width: 100,
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: '状态',
      key: 'status',
      width: 160,
      render: (_, record) => (
        <Space wrap>
          <Tag color={record.isPublished ? 'green' : 'default'}>
            {record.isPublished ? '已发布' : '草稿'}
          </Tag>
          {record.isPinned ? <Tag color="gold">置顶</Tag> : null}
          {isExpired(record.expiresAt) ? <Tag color="red">已过期</Tag> : null}
        </Space>
      ),
    },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    {
      title: '发布时间',
      dataIndex: 'publishedAt',
      width: 170,
      render: (value: string | null) => formatDate(value),
    },
    {
      title: '过期时间',
      dataIndex: 'expiresAt',
      width: 170,
      render: (value: string | null) => formatDate(value),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 230,
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button size="small" onClick={() => togglePublished(record)}>
            {record.isPublished ? '下架' : '发布'}
          </Button>
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
          <Typography.Text type="secondary">维护前台通知公告页和首页公告列表。</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadAnnouncements} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建公告
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={announcements}
          scroll={{ x: 1180 }}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editing ? '编辑公告' : '新建公告'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={saveAnnouncement} style={{ marginTop: 16 }}>
          <Form.Item
            name="title"
            label="公告标题"
            rules={[{ required: true, whitespace: true, message: '请输入公告标题' }]}
          >
            <Input maxLength={120} showCount />
          </Form.Item>
          <Form.Item
            name="content"
            label="公告正文"
            rules={[{ required: true, whitespace: true, message: '请输入公告正文' }]}
          >
            <Input.TextArea rows={6} showCount />
          </Form.Item>
          <Space size={16} align="start" wrap>
            <Form.Item name="type" label="分类">
              <Input style={{ width: 160 }} maxLength={24} placeholder="公告" />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序值">
              <InputNumber min={0} precision={0} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="isPublished" label="发布状态" valuePropName="checked">
              <Switch checkedChildren="发布" unCheckedChildren="草稿" />
            </Form.Item>
            <Form.Item name="isPinned" label="置顶" valuePropName="checked">
              <Switch checkedChildren="置顶" unCheckedChildren="普通" />
            </Form.Item>
          </Space>
          <Form.Item name="publishedAt" label="发布时间">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="expiresAt" label="过期时间">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
