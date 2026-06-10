'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Result,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  EyeOutlined,
  EditOutlined,
  FileSearchOutlined,
  MailOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

// ---------------- 类型 ----------------

type SmtpInfo = {
  configured: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  from: string | null;
  fromName: string;
};

type GlobalSettings = { enabled: boolean; smtp: SmtpInfo };

type TemplateItem = {
  key: string;
  name: string;
  subject: string;
  body: string;
  enabled: boolean;
  reserved: boolean;
  updatedAt: string;
};

type EventSettingItem = {
  templateKey: string;
  templateName: string;
  reserved: boolean;
  enabled: boolean;
  remindBeforeMinutes: number | null;
  scheduledSendTime: string | null;
  autoSent: boolean;
  lastSentAt: string | null;
  manualSendCount: number;
};

type EventRow = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  location: string | null;
  isPublished: boolean;
  settings: Record<string, EventSettingItem>;
};

type RowEdit = {
  registration_submitted: boolean;
  registration_approved: boolean;
  registration_rejected: boolean;
  match_reminder: boolean;
  remindBeforeMinutes: number;
};

type LogItem = {
  id: string;
  tournamentId: string | null;
  tournamentName: string | null;
  templateKey: string;
  templateName: string;
  recipient: string | null;
  subject: string | null;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  reason: string | null;
  trigger: string;
  createdAt: string;
};

type ReminderStats = { total: number; success: number; failed: number; skipped: number };

const LOG_STATUS_META: Record<LogItem['status'], { color: string; label: string }> = {
  SENT: { color: 'green', label: '已发送' },
  FAILED: { color: 'red', label: '发送失败' },
  SKIPPED: { color: 'orange', label: '已跳过' },
};

const TEMPLATE_FILTER_OPTIONS = [
  { value: 'registration_submitted', label: '报名提交成功通知' },
  { value: 'registration_approved', label: '报名审核通过通知' },
  { value: 'registration_rejected', label: '报名审核未通过通知' },
  { value: 'match_reminder', label: '赛前提醒通知' },
  { value: 'match_result', label: '比赛结果通知（预留）' },
  { value: 'custom', label: '自定义通知（预留）' },
  { value: 'test', label: '测试邮件' },
];

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN');
}

// ---------------- 基础设置 ----------------

function GlobalSettingsTab({ token }: { token: string }) {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testForm] = Form.useForm();
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<GlobalSettings>('/admin/email/settings', { token });
      setSettings(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '邮件设置加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleEnabled(enabled: boolean) {
    setToggling(true);
    try {
      const data = await apiFetch<GlobalSettings>('/admin/email/settings', {
        method: 'PUT',
        token,
        body: JSON.stringify({ enabled }),
      });
      setSettings(data);
      message.success(enabled ? '已开启全站邮件功能' : '已关闭全站邮件功能');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '设置保存失败');
    } finally {
      setToggling(false);
    }
  }

  async function sendTest() {
    const values = await testForm.validateFields();
    setTesting(true);
    try {
      const result = await apiFetch<{ message: string }>('/admin/email/test', {
        method: 'POST',
        token,
        body: JSON.stringify({ to: values.to }),
      });
      message.success(result.message ?? '测试邮件已发送');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试邮件发送失败');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="全局开关" loading={loading && !settings}>
        <Space size={12}>
          <Switch
            checked={settings?.enabled ?? false}
            loading={toggling}
            onChange={toggleEnabled}
          />
          <Typography.Text>
            全站邮件功能{settings?.enabled ? '已开启' : '已关闭'}
          </Typography.Text>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          关闭后所有自动邮件（报名提交、审核通过、审核拒绝、赛前提醒）一律不发送，跳过记录会写入发送日志。
        </Typography.Paragraph>
      </Card>

      <Card size="small" title="SMTP 配置（阿里云邮件推送 · 465 SSL）" loading={loading && !settings}>
        {settings?.smtp.configured ? (
          <Descriptions
            size="small"
            column={1}
            items={[
              { key: 'host', label: 'SMTP 服务器', children: settings.smtp.host },
              {
                key: 'port',
                label: '端口',
                children: `${settings.smtp.port}（${settings.smtp.secure ? 'SSL 加密' : '未加密'}）`,
              },
              { key: 'from', label: '发信地址', children: settings.smtp.from },
              { key: 'fromName', label: '发件人名称', children: settings.smtp.fromName },
              { key: 'pass', label: 'SMTP 密码', children: '已配置（出于安全不展示）' },
            ]}
          />
        ) : (
          <Alert
            type="warning"
            showIcon
            message="SMTP 未配置"
            description="请在后端环境变量中设置 MAIL_HOST / MAIL_USER / MAIL_PASS 后重启服务。SMTP 配置保存在服务器端，不会暴露给浏览器。"
          />
        )}
      </Card>

      <Card size="small" title="发送测试邮件">
        <Form form={testForm} layout="inline">
          <Form.Item
            name="to"
            rules={[
              { required: true, message: '请输入收件邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input placeholder="收件邮箱" style={{ width: 260 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" icon={<SendOutlined />} loading={testing} onClick={sendTest}>
              发送测试邮件
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </Space>
  );
}

// ---------------- 模板管理 ----------------

function TemplatesTab({ token }: { token: string }) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<TemplateItem | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [preview, setPreview] = useState<{ name: string; subject: string; html: string } | null>(null);
  const [editForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<TemplateItem[]>('/admin/email/templates', { token });
      setTemplates(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(template: TemplateItem) {
    setEditing(template);
    editForm.setFieldsValue({
      name: template.name,
      subject: template.subject,
      body: template.body,
      enabled: template.enabled,
    });
  }

  async function saveTemplate() {
    if (!editing) return;
    const values = await editForm.validateFields();
    setSavingTemplate(true);
    try {
      await apiFetch(`/admin/email/templates/${editing.key}`, {
        method: 'PUT',
        token,
        body: JSON.stringify(values),
      });
      message.success('模板已保存');
      setEditing(null);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板保存失败');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function toggleTemplate(template: TemplateItem, enabled: boolean) {
    try {
      await apiFetch(`/admin/email/templates/${template.key}`, {
        method: 'PUT',
        token,
        body: JSON.stringify({ enabled }),
      });
      setTemplates((prev) =>
        prev.map((item) => (item.key === template.key ? { ...item, enabled } : item)),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板开关保存失败');
    }
  }

  async function showPreview(template: TemplateItem) {
    try {
      const data = await apiFetch<{ name: string; subject: string; html: string }>(
        `/admin/email/templates/${template.key}/preview`,
        { token },
      );
      setPreview(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板预览失败');
    }
  }

  async function resetTemplate(template: TemplateItem) {
    try {
      await apiFetch(`/admin/email/templates/${template.key}/reset`, { method: 'POST', token });
      message.success('模板已恢复默认');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '恢复默认失败');
    }
  }

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="模板支持的占位符"
        description="{{name}} 选手姓名 · {{eventTitle}} 赛事名称 · {{eventTime}} 比赛时间 · {{eventLocation}} 比赛地点 · {{eventGroup}} 参赛项目 · {{rejectReason}} 驳回原因 · {{sendTime}} 发送时间"
      />
      <Table
        rowKey="key"
        loading={loading}
        dataSource={templates}
        pagination={false}
        columns={[
          {
            title: '模板',
            key: 'name',
            render: (_: unknown, record: TemplateItem) => (
              <Space direction="vertical" size={0}>
                <Space size={8}>
                  <Typography.Text strong>{record.name}</Typography.Text>
                  {record.reserved ? <Tag>预留</Tag> : null}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {record.key}
                </Typography.Text>
              </Space>
            ),
          },
          { title: '邮件主题', dataIndex: 'subject', key: 'subject' },
          {
            title: '启用',
            key: 'enabled',
            width: 80,
            render: (_: unknown, record: TemplateItem) => (
              <Switch
                checked={record.enabled}
                onChange={(checked) => toggleTemplate(record, checked)}
              />
            ),
          },
          {
            title: '更新时间',
            dataIndex: 'updatedAt',
            key: 'updatedAt',
            width: 170,
            render: (value: string) => formatDateTime(value),
          },
          {
            title: '操作',
            key: 'actions',
            width: 260,
            render: (_: unknown, record: TemplateItem) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
                  编辑
                </Button>
                <Button size="small" icon={<EyeOutlined />} onClick={() => showPreview(record)}>
                  预览
                </Button>
                <Popconfirm title="恢复为系统默认模板？" onConfirm={() => resetTemplate(record)}>
                  <Button size="small" icon={<UndoOutlined />}>
                    恢复默认
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={`编辑模板：${editing?.name ?? ''}`}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={saveTemplate}
        confirmLoading={savingTemplate}
        okText="保存"
        cancelText="取消"
        width={760}
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="subject" label="邮件主题" rules={[{ required: true, message: '请输入邮件主题' }]}>
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="body" label="邮件正文（HTML，支持占位符）" rules={[{ required: true, message: '请输入正文' }]}>
            <Input.TextArea rows={14} />
          </Form.Item>
          <Form.Item name="enabled" label="启用该模板" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`模板预览：${preview?.name ?? ''}`}
        open={Boolean(preview)}
        onCancel={() => setPreview(null)}
        footer={null}
        width={760}
      >
        <Typography.Paragraph>
          <Typography.Text type="secondary">主题：</Typography.Text>
          {preview?.subject}
        </Typography.Paragraph>
        <iframe
          title="邮件模板预览"
          srcDoc={preview?.html ?? ''}
          style={{ width: '100%', height: 560, border: '1px solid #e8ecf3', borderRadius: 8 }}
        />
      </Modal>
    </>
  );
}

// ---------------- 赛事邮件开关 ----------------

function EventSwitchesTab({
  token,
  onViewLogs,
}: {
  token: string;
  onViewLogs: (eventId: string) => void;
}) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const buildEdit = (row: EventRow): RowEdit => ({
    registration_submitted: row.settings.registration_submitted?.enabled ?? false,
    registration_approved: row.settings.registration_approved?.enabled ?? false,
    registration_rejected: row.settings.registration_rejected?.enabled ?? false,
    match_reminder: row.settings.match_reminder?.enabled ?? false,
    remindBeforeMinutes: row.settings.match_reminder?.remindBeforeMinutes ?? 1440,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<EventRow[]>('/admin/email/events/settings', { token });
      setEvents(data);
      const nextEdits: Record<string, RowEdit> = {};
      for (const row of data) {
        nextEdits[row.id] = {
          registration_submitted: row.settings.registration_submitted?.enabled ?? false,
          registration_approved: row.settings.registration_approved?.enabled ?? false,
          registration_rejected: row.settings.registration_rejected?.enabled ?? false,
          match_reminder: row.settings.match_reminder?.enabled ?? false,
          remindBeforeMinutes: row.settings.match_reminder?.remindBeforeMinutes ?? 1440,
        };
      }
      setEdits(nextEdits);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '赛事邮件设置加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function patchEdit(eventId: string, patch: Partial<RowEdit>) {
    setEdits((prev) => ({
      ...prev,
      [eventId]: { ...(prev[eventId] ?? ({} as RowEdit)), ...patch },
    }));
  }

  function isDirty(row: EventRow) {
    const edit = edits[row.id];
    if (!edit) return false;
    const base = buildEdit(row);
    return (
      edit.registration_submitted !== base.registration_submitted ||
      edit.registration_approved !== base.registration_approved ||
      edit.registration_rejected !== base.registration_rejected ||
      edit.match_reminder !== base.match_reminder ||
      edit.remindBeforeMinutes !== base.remindBeforeMinutes
    );
  }

  async function saveRow(row: EventRow) {
    const edit = edits[row.id];
    if (!edit) return;
    setSavingId(row.id);
    try {
      await apiFetch(`/admin/email/events/${row.id}/settings`, {
        method: 'PUT',
        token,
        body: JSON.stringify({
          registration_submitted: { enabled: edit.registration_submitted },
          registration_approved: { enabled: edit.registration_approved },
          registration_rejected: { enabled: edit.registration_rejected },
          match_reminder: {
            enabled: edit.match_reminder,
            remindBeforeMinutes: edit.remindBeforeMinutes,
          },
        }),
      });
      message.success(`「${row.name}」邮件设置已保存`);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingId(null);
    }
  }

  async function sendReminderNow(row: EventRow) {
    setSendingId(row.id);
    try {
      const stats = await apiFetch<ReminderStats>(`/admin/email/events/${row.id}/reminder/send-now`, {
        method: 'POST',
        token,
      });
      message.success(
        `「${row.name}」赛前提醒已发送：共 ${stats.total} 人，成功 ${stats.success}，失败 ${stats.failed}，跳过 ${stats.skipped}`,
      );
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '赛前提醒发送失败');
    } finally {
      setSendingId(null);
    }
  }

  function renderSwitch(row: EventRow, key: keyof Pick<RowEdit, 'registration_submitted' | 'registration_approved' | 'registration_rejected'>) {
    return (
      <Switch
        checked={edits[row.id]?.[key] ?? false}
        onChange={(checked) => patchEdit(row.id, { [key]: checked } as Partial<RowEdit>)}
      />
    );
  }

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
          刷新
        </Button>
        <Typography.Text type="secondary">
          新赛事默认：审核通过 / 审核拒绝通知开启，报名提交、赛前提醒关闭。修改后请点击「保存」。
        </Typography.Text>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={events}
        pagination={{ pageSize: 10 }}
        scroll={{ x: 1100 }}
        columns={[
          {
            title: '赛事',
            key: 'name',
            width: 230,
            render: (_: unknown, record: EventRow) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{record.name}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {formatDate(record.startDate)} ~ {formatDate(record.endDate)}
                  {record.isPublished ? '' : ' · 未发布'}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: '提交成功',
            key: 'registration_submitted',
            width: 90,
            render: (_: unknown, record: EventRow) => renderSwitch(record, 'registration_submitted'),
          },
          {
            title: '审核通过',
            key: 'registration_approved',
            width: 90,
            render: (_: unknown, record: EventRow) => renderSwitch(record, 'registration_approved'),
          },
          {
            title: '审核拒绝',
            key: 'registration_rejected',
            width: 90,
            render: (_: unknown, record: EventRow) => renderSwitch(record, 'registration_rejected'),
          },
          {
            title: '赛前提醒',
            key: 'match_reminder',
            width: 330,
            render: (_: unknown, record: EventRow) => {
              const edit = edits[record.id];
              const reminder = record.settings.match_reminder;
              const minutes = edit?.remindBeforeMinutes ?? 1440;
              const start = new Date(record.startDate).getTime();
              const preview = Number.isNaN(start)
                ? '—'
                : formatDateTime(new Date(start - minutes * 60_000).toISOString());
              return (
                <Space direction="vertical" size={4}>
                  <Space size={8}>
                    <Switch
                      checked={edit?.match_reminder ?? false}
                      onChange={(checked) => patchEdit(record.id, { match_reminder: checked })}
                    />
                    <Typography.Text type="secondary">比赛前</Typography.Text>
                    <InputNumber
                      size="small"
                      min={5}
                      max={30 * 24 * 60}
                      value={minutes}
                      onChange={(value) => patchEdit(record.id, { remindBeforeMinutes: value ?? 1440 })}
                      addonAfter="分钟"
                      style={{ width: 140 }}
                    />
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    预计发送：{preview}
                    {reminder?.autoSent ? (
                      <Tag color="green" style={{ marginLeft: 8 }}>
                        已自动发送
                      </Tag>
                    ) : null}
                  </Typography.Text>
                  {reminder?.lastSentAt ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      最后发送：{formatDateTime(reminder.lastSentAt)}
                      {reminder.manualSendCount > 0 ? ` · 手动 ${reminder.manualSendCount} 次` : ''}
                    </Typography.Text>
                  ) : null}
                </Space>
              );
            },
          },
          {
            title: '操作',
            key: 'actions',
            width: 280,
            render: (_: unknown, record: EventRow) => (
              <Space wrap>
                <Button
                  size="small"
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={savingId === record.id}
                  disabled={!isDirty(record)}
                  onClick={() => saveRow(record)}
                >
                  保存
                </Button>
                <Popconfirm
                  title="立即给该赛事所有审核通过的选手发送赛前提醒？"
                  description="已成功收到过赛前提醒的邮箱会自动跳过。"
                  onConfirm={() => sendReminderNow(record)}
                >
                  <Button size="small" icon={<SendOutlined />} loading={sendingId === record.id}>
                    立即发送提醒
                  </Button>
                </Popconfirm>
                <Button size="small" icon={<FileSearchOutlined />} onClick={() => onViewLogs(record.id)}>
                  查看日志
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}

// ---------------- 发送日志 ----------------

function LogsTab({
  token,
  eventFilter,
  onEventFilterChange,
}: {
  token: string;
  eventFilter?: string;
  onEventFilterChange: (eventId?: string) => void;
}) {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [templateFilter, setTemplateFilter] = useState<string | undefined>();
  const [eventOptions, setEventOptions] = useState<Array<{ value: string; label: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (eventFilter) params.set('eventId', eventFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (templateFilter) params.set('templateKey', templateFilter);
      const query = params.toString();
      const data = await apiFetch<LogItem[]>(`/admin/email/logs${query ? `?${query}` : ''}`, { token });
      setLogs(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '日志加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, eventFilter, statusFilter, templateFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Array<{ id: string; name: string }>>('/admin/email/events/settings', { token })
      .then((rows) => {
        if (cancelled) return;
        setEventOptions(rows.map((row) => ({ value: row.id, label: row.name })));
      })
      .catch(() => {
        /* 筛选项加载失败不阻塞日志列表 */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="按赛事筛选"
          style={{ width: 240 }}
          value={eventFilter}
          onChange={(value) => onEventFilterChange(value)}
          options={eventOptions}
        />
        <Select
          allowClear
          placeholder="按状态筛选"
          style={{ width: 140 }}
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'SENT', label: '已发送' },
            { value: 'FAILED', label: '发送失败' },
            { value: 'SKIPPED', label: '已跳过' },
          ]}
        />
        <Select
          allowClear
          placeholder="按邮件类型筛选"
          style={{ width: 220 }}
          value={templateFilter}
          onChange={setTemplateFilter}
          options={TEMPLATE_FILTER_OPTIONS}
        />
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
          刷新
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={logs}
        pagination={{ pageSize: 20 }}
        scroll={{ x: 1000 }}
        columns={[
          {
            title: '时间',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 170,
            render: (value: string) => formatDateTime(value),
          },
          {
            title: '赛事',
            key: 'tournament',
            width: 200,
            render: (_: unknown, record: LogItem) =>
              record.tournamentName ?? <Typography.Text type="secondary">—</Typography.Text>,
          },
          { title: '邮件类型', dataIndex: 'templateName', key: 'templateName', width: 160 },
          {
            title: '收件人',
            dataIndex: 'recipient',
            key: 'recipient',
            width: 200,
            render: (value: string | null) =>
              value ?? <Typography.Text type="secondary">—</Typography.Text>,
          },
          {
            title: '状态',
            key: 'status',
            width: 100,
            render: (_: unknown, record: LogItem) => (
              <Tag color={LOG_STATUS_META[record.status].color}>
                {LOG_STATUS_META[record.status].label}
              </Tag>
            ),
          },
          {
            title: '原因 / 备注',
            key: 'reason',
            render: (_: unknown, record: LogItem) =>
              record.reason ?? <Typography.Text type="secondary">—</Typography.Text>,
          },
          {
            title: '触发方式',
            dataIndex: 'trigger',
            key: 'trigger',
            width: 100,
            render: (value: string) => (value === 'manual' ? '手动' : '自动'),
          },
        ]}
      />
    </>
  );
}

// ---------------- 页面入口 ----------------

export default function AdminEmailPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const sessionRole = (session?.user as { role?: string } | undefined)?.role;

  const [liveRole, setLiveRole] = useState<string | undefined>(sessionRole);
  const [roleChecked, setRoleChecked] = useState(false);
  const [activeTab, setActiveTab] = useState('settings');
  const [logEventFilter, setLogEventFilter] = useState<string | undefined>();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<{ role?: string }>('/auth/me', { token })
      .then((me) => {
        if (cancelled) return;
        if (me?.role) setLiveRole(me.role);
        setRoleChecked(true);
      })
      .catch(() => {
        if (!cancelled) setRoleChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // 支持 /admin/email?tab=logs&eventId=xxx 直达指定 Tab
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const eventId = params.get('eventId');
    if (eventId) setLogEventFilter(eventId);
    if (tab) setActiveTab(tab);
  }, []);

  const role = liveRole ?? sessionRole;
  const isSuperAdmin = role === 'SUPER_ADMIN';

  const tabs = useMemo(() => {
    if (!token) return [];
    return [
      { key: 'settings', label: '基础设置', children: <GlobalSettingsTab token={token} /> },
      { key: 'templates', label: '模板管理', children: <TemplatesTab token={token} /> },
      {
        key: 'events',
        label: '赛事邮件开关',
        children: (
          <EventSwitchesTab
            token={token}
            onViewLogs={(eventId) => {
              setLogEventFilter(eventId);
              setActiveTab('logs');
            }}
          />
        ),
      },
      {
        key: 'logs',
        label: '发送日志',
        children: (
          <LogsTab token={token} eventFilter={logEventFilter} onEventFilterChange={setLogEventFilter} />
        ),
      },
    ];
  }, [token, logEventFilter]);

  if (!token || (!roleChecked && !isSuperAdmin)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <Result
        status="403"
        title="无权访问"
        subTitle="邮件通知设置仅总管理员可见。"
        extra={
          <Button type="primary" onClick={() => router.push('/admin')}>
            返回仪表板
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <MailOutlined style={{ marginRight: 8 }} />
          邮件通知设置
        </Typography.Title>
        <Typography.Text type="secondary">
          全局开关、模板与每场赛事的邮件通知策略（仅总管理员可操作）。
        </Typography.Text>
      </div>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabs} destroyOnHidden />
    </div>
  );
}
