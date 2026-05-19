'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  DatePicker,
  Space,
  Popconfirm,
  Typography,
  Tag,
  Switch,
  Select,
  Upload,
  message,
} from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, InboxOutlined, UploadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import dayjs from 'dayjs';

const API_BASE = process.env.NEXT_PUBLIC_API_URL!;
const API_ORIGIN = API_BASE.replace(/\/api$/, '');

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  REGISTRATION_NOT_STARTED: { label: '报名未开始', color: 'default' },
  REGISTRATION_OPEN: { label: '报名中', color: 'orange' },
  REGISTRATION_CLOSED: { label: '报名已结束', color: 'red' },
  ONGOING: { label: '比赛进行中', color: 'green' },
  FINISHED: { label: '已结束', color: 'blue' },
};

interface Tournament {
  id: string;
  name: string;
  edition: number;
  subtitle?: string | null;
  coverImageUrl?: string | null;
  location?: string | null;
  projectText?: string | null;
  formatText?: string | null;
  registrationStartDate?: string | null;
  registrationEndDate?: string | null;
  status: string;
  rules?: string | null;
  showOnHome: boolean;
  startDate: string;
  endDate: string;
  isArchived: boolean;
  _count?: { events: number };
}

export default function TournamentsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tournament | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [coverFileList, setCoverFileList] = useState<UploadFile[]>([]);

  const fetchTournaments = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<Tournament[]>('/tournaments', { token });
      setTournaments(data);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    async function load() {
      const data = await apiFetch<Tournament[]>('/tournaments', { token });
      if (!alive) return;
      setTournaments(data);
    }
    load().catch((e) => message.error(e instanceof Error ? e.message : '加载赛事失败'));
    return () => {
      alive = false;
    };
  }, [token]);

  const openCreate = () => {
    setEditing(null);
    setCoverFileList([]);
    form.resetFields();
    form.setFieldsValue({
      status: 'REGISTRATION_NOT_STARTED',
      showOnHome: false,
    });
    setModalOpen(true);
  };

  const openEdit = (t: Tournament) => {
    setEditing(t);
    setCoverFileList(
      t.coverImageUrl
        ? [
            {
              uid: t.coverImageUrl,
              name: '当前封面',
              status: 'done',
              url: `${API_ORIGIN}${t.coverImageUrl}`,
            },
          ]
        : [],
    );
    form.setFieldsValue({
      name: t.name,
      edition: t.edition,
      subtitle: t.subtitle,
      coverImageUrl: t.coverImageUrl,
      location: t.location,
      projectText: t.projectText,
      formatText: t.formatText,
      registrationDates:
        t.registrationStartDate && t.registrationEndDate
          ? [dayjs(t.registrationStartDate), dayjs(t.registrationEndDate)]
          : undefined,
      status: t.status,
      rules: t.rules,
      showOnHome: t.showOnHome,
      dates: [dayjs(t.startDate), dayjs(t.endDate)],
    });
    setModalOpen(true);
  };

  const uploadProps: UploadProps = {
    action: `${API_BASE}/tournaments/upload-cover`,
    name: 'file',
    listType: 'picture-card',
    maxCount: 1,
    fileList: coverFileList,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    onChange(info) {
      setCoverFileList(info.fileList);
      if (info.file.status === 'done') {
        const url = info.file.response?.url;
        if (url) {
          form.setFieldValue('coverImageUrl', url);
          message.success('封面上传成功');
        }
      }
      if (info.file.status === 'error') {
        message.error('封面上传失败');
      }
    },
    onRemove() {
      form.setFieldValue('coverImageUrl', undefined);
      return true;
    },
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const [startDate, endDate] = values.dates;
    const registrationDates = values.registrationDates;
    const payload = {
      name: values.name,
      edition: Number(values.edition),
      subtitle: values.subtitle,
      coverImageUrl: values.coverImageUrl,
      location: values.location,
      projectText: values.projectText,
      formatText: values.formatText,
      registrationStartDate: registrationDates?.[0]?.toISOString(),
      registrationEndDate: registrationDates?.[1]?.toISOString(),
      status: values.status,
      rules: values.rules,
      showOnHome: Boolean(values.showOnHome),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };
    setSubmitting(true);
    try {
      if (editing) {
        await apiFetch(`/tournaments/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
          token,
        });
        message.success('已更新');
      } else {
        await apiFetch('/tournaments', { method: 'POST', body: JSON.stringify(payload), token });
        message.success('已创建');
      }
      setModalOpen(false);
      fetchTournaments();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/tournaments/${id}`, { method: 'DELETE', token });
      message.success('已删除');
      fetchTournaments();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await apiFetch(`/tournaments/${id}/archive`, { method: 'PATCH', token });
      message.success('已归档');
      fetchTournaments();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '归档失败');
    }
  };

  const columns = [
    { title: '届次', dataIndex: 'edition', key: 'edition', width: 80, render: (v: number) => `第${v}届` },
    {
      title: '比赛标题',
      key: 'name',
      render: (_: unknown, r: Tournament) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{r.name}</Typography.Text>
          <Typography.Text type="secondary">{r.subtitle || '-'}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '时间',
      key: 'dates',
      render: (_: unknown, r: Tournament) =>
        `${dayjs(r.startDate).format('YYYY/MM/DD')} — ${dayjs(r.endDate).format('YYYY/MM/DD')}`,
    },
    { title: '项目', dataIndex: 'projectText', key: 'projectText', render: (v: string) => v || '-' },
    {
      title: '状态',
      key: 'status',
      render: (_: unknown, r: Tournament) => (
        <Space>
          <Tag color={STATUS_LABELS[r.status]?.color}>{STATUS_LABELS[r.status]?.label || r.status}</Tag>
          {r.showOnHome && <Tag color="gold">首页展示</Tag>}
          {r.isArchived && <Tag>已归档</Tag>}
        </Space>
      ),
    },
    { title: '单项数', key: 'events', render: (_: unknown, r: Tournament) => r._count?.events ?? 0 },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: Tournament) => (
        <Space>
          <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(record)} disabled={record.isArchived}>
            编辑
          </Button>
          {!record.isArchived && (
            <Popconfirm title="归档后不可编辑，确认？" onConfirm={() => handleArchive(record.id)}>
              <Button icon={<InboxOutlined />} size="small">归档</Button>
            </Popconfirm>
          )}
          <Popconfirm title="确认删除？此操作不可恢复" onConfirm={() => handleDelete(record.id)}>
            <Button icon={<DeleteOutlined />} size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>赛事管理</Typography.Title>
          <Typography.Text type="secondary">配置首页展示比赛、封面图和报名状态</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建赛事</Button>
      </div>

      <Table rowKey="id" columns={columns} dataSource={tournaments} loading={loading} pagination={false} />

      <Modal
        title={editing ? '编辑赛事' : '新建赛事'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        width={760}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="coverImageUrl" hidden>
            <Input />
          </Form.Item>
          <Form.Item label="比赛封面图">
            <Upload {...uploadProps}>
              {coverFileList.length >= 1 ? null : (
                <button type="button" style={{ border: 0, background: 'none' }}>
                  <UploadOutlined />
                  <div style={{ marginTop: 8 }}>上传封面</div>
                </button>
              )}
            </Upload>
          </Form.Item>
          <Form.Item name="showOnHome" label="首页展示" valuePropName="checked">
            <Switch checkedChildren="展示" unCheckedChildren="不展示" />
          </Form.Item>
          <Form.Item name="name" label="比赛标题" rules={[{ required: true, message: '请输入比赛标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="subtitle" label="比赛副标题">
            <Input placeholder="如：2026年校园羽毛球单打赛正式开启" />
          </Form.Item>
          <Form.Item name="edition" label="届次" rules={[{ required: true, message: '请输入届次' }]}>
            <Input type="number" min={1} />
          </Form.Item>
          <Form.Item name="dates" label="比赛时间" rules={[{ required: true, message: '请选择比赛时间' }]}>
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="registrationDates" label="报名时间">
            <DatePicker.RangePicker style={{ width: '100%' }} showTime />
          </Form.Item>
          <Form.Item name="status" label="比赛状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select
              options={Object.entries(STATUS_LABELS).map(([value, item]) => ({
                value,
                label: item.label,
              }))}
            />
          </Form.Item>
          <Form.Item name="location" label="比赛地点">
            <Input />
          </Form.Item>
          <Form.Item name="projectText" label="比赛项目">
            <Input placeholder="如：男子单打 / 女子单打" />
          </Form.Item>
          <Form.Item name="formatText" label="比赛形式">
            <Input placeholder="如：单打淘汰赛" />
          </Form.Item>
          <Form.Item name="rules" label="比赛规则 / 公告内容">
            <Input.TextArea rows={4} placeholder="每行一条，首页公告区会读取这里的内容" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
