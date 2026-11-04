'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  EyeOutlined,
  PoweroffOutlined,
  SaveOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import locale from 'antd/locale/zh_CN';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/zh-cn';
import { apiFetch } from '@/lib/api';
import { RichTextEditor } from '@/components/RichTextEditor';
import { MaintenanceView } from '@/components/maintenance/MaintenanceView';
import { DEFAULT_MAINTENANCE_TITLE } from '@/lib/maintenance';

const API_BASE = process.env.NEXT_PUBLIC_API_URL!;

type MaintenanceConfig = {
  enabled: boolean;
  title: string;
  content: string;
  startedAt: string | null;
  expectedEndAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  serverTime: string;
};

type FormValues = {
  title?: string;
  content?: string;
  expectedEndAt?: Dayjs | null;
};

const QUICK_DURATIONS = [
  { label: '30 分钟', minutes: 30 },
  { label: '1 小时', minutes: 60 },
  { label: '2 小时', minutes: 120 },
  { label: '4 小时', minutes: 240 },
  { label: '12 小时', minutes: 720 },
];

function formatTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';
}

function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return [days ? `${days} 天` : '', hours ? `${hours} 小时` : '', `${rest} 分钟`].filter(Boolean).join(' ');
}

export default function MaintenanceAdminPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [form] = Form.useForm<FormValues>();
  const [config, setConfig] = useState<MaintenanceConfig | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'open' | 'close' | null>(null);
  const [preview, setPreview] = useState<FormValues | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // 表单在设置读到之后才渲染，所以等渲染完再回填（读取、保存后各回填一次）。
  useEffect(() => {
    if (!config) return;
    form.setFieldsValue({
      title: config.title,
      content: config.content,
      expectedEndAt: config.expectedEndAt ? dayjs(config.expectedEndAt) : null,
    });
  }, [config, form]);

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<MaintenanceConfig>('/admin/maintenance', { token, cache: 'no-store' })
      .then((next) => {
        setConfig(next);
        setLoadError('');
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : '读取维护设置失败');
      });
  }, [token]);

  useEffect(load, [load]);

  async function save(enabled?: boolean) {
    if (!token) return;
    // 关闭维护只改开关，不校验表单（预计恢复时间过了也要能关）。
    const values = enabled === false ? {} : await form.validateFields();
    const payload: Record<string, unknown> = enabled === undefined ? {} : { enabled };
    if (enabled !== false) {
      const formValues = values as FormValues;
      payload.title = formValues.title?.trim() || DEFAULT_MAINTENANCE_TITLE;
      payload.content = formValues.content ?? '';
      payload.expectedEndAt = formValues.expectedEndAt ? formValues.expectedEndAt.second(0).millisecond(0).toISOString() : null;
    }
    setSaving(true);
    try {
      const next = await apiFetch<MaintenanceConfig>('/admin/maintenance', {
        method: 'PUT',
        token,
        body: JSON.stringify(payload),
      });
      setConfig(next);
      setConfirmAction(null);
      window.dispatchEvent(new Event('maintenance-changed'));
      if (enabled === true) message.success('全服维护已开启，几秒内全站生效');
      else if (enabled === false) message.success('全服维护已关闭，网站已恢复正常');
      else message.success(next.enabled ? '维护页内容已更新，正在维护的页面会自动刷新' : '维护页内容已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function openPreview() {
    setPreview(form.getFieldsValue());
  }

  const previewStartedAt = useMemo(
    () => (config?.enabled && config.startedAt ? config.startedAt : new Date(now).toISOString()),
    [config, now],
  );

  if (!config) {
    return loadError ? (
      <Alert type="error" showIcon title="读取维护设置失败" description={loadError} action={<Button onClick={load}>重试</Button>} />
    ) : (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin />
      </div>
    );
  }

  const enabled = config.enabled;
  const startedMs = config.startedAt ? new Date(config.startedAt).getTime() : NaN;
  const endMs = config.expectedEndAt ? new Date(config.expectedEndAt).getTime() : NaN;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <ToolOutlined style={{ marginRight: 8 }} />
          全服维护
        </Typography.Title>
        <Typography.Text type="secondary">
          开启后，除管理员和超级管理员外，所有人打开任何页面都只能看到维护页。
        </Typography.Text>
      </div>

      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Card
          style={{ borderColor: enabled ? '#ffa39e' : '#b7eb8f', background: enabled ? '#fff1f0' : '#f6ffed' }}
          styles={{ body: { padding: 20 } }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ minWidth: 240 }}>
              <Space size={8} align="center">
                {enabled ? <Tag color="red" style={{ fontSize: 14, padding: '2px 10px' }}>维护中</Tag> : <Tag color="green" style={{ fontSize: 14, padding: '2px 10px' }}>正常运行</Tag>}
                <Typography.Text strong style={{ fontSize: 16 }}>
                  {enabled ? `已维护 ${Number.isFinite(startedMs) ? formatDuration(now - startedMs) : '—'}` : '网站正常对外服务'}
                </Typography.Text>
              </Space>
              <Descriptions
                size="small"
                column={1}
                style={{ marginTop: 12 }}
                items={[
                  { key: 'start', label: enabled ? '维护开始' : '上次维护开始', children: formatTime(config.startedAt) },
                  ...(enabled ? [{
                    key: 'end',
                    label: '预计恢复',
                    children: config.expectedEndAt
                      ? `${formatTime(config.expectedEndAt)}${Number.isFinite(endMs) ? (endMs > now ? `（还剩 ${formatDuration(endMs - now)}）` : '（已超过预计时间）') : ''}`
                      : '待定',
                  }] : []),
                  { key: 'by', label: '最后操作', children: config.updatedBy ? `${config.updatedBy} · ${formatTime(config.updatedAt)}` : '—' },
                ]}
              />
            </div>
            {enabled ? (
              <Button type="primary" size="large" icon={<CheckCircleOutlined />} loading={saving} onClick={() => setConfirmAction('close')}>
                结束维护，恢复服务
              </Button>
            ) : (
              <Button danger type="primary" size="large" icon={<PoweroffOutlined />} loading={saving} onClick={() => setConfirmAction('open')}>
                开启全服维护
              </Button>
            )}
          </div>
        </Card>

        <Alert
          type="info"
          showIcon
          title="维护期间"
          description={(
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>游客、选手、裁判、图片员：任何链接都只显示维护页，暂停登录；</li>
              <li>管理员：可以登录后台查看，但不能进行任何操作，后台顶部会显示提示；</li>
              <li>超级管理员：一切照常，可随时在这里结束维护；</li>
              <li>邮件提醒照常发送。维护只能手动结束，到了预计恢复时间不会自动关闭。</li>
            </ul>
          )}
        />

        <Card title="维护页内容" extra={<Button icon={<EyeOutlined />} onClick={openPreview}>预览维护页</Button>}>
          <Form<FormValues> form={form} layout="vertical" disabled={saving}>
            <Form.Item name="title" label="标题" rules={[{ max: 40, message: '标题不超过 40 个字' }]}>
              <Input placeholder={DEFAULT_MAINTENANCE_TITLE} maxLength={40} showCount />
            </Form.Item>

            <Form.Item label="预计恢复时间" extra="只用于在维护页显示时间和倒计时；留空则显示“恢复时间待定”。">
              <Space wrap>
                <Form.Item
                  name="expectedEndAt"
                  noStyle
                  rules={[{
                    validator: (_, value?: Dayjs | null) => (!value || value.isAfter(dayjs())
                      ? Promise.resolve()
                      : Promise.reject(new Error('预计恢复时间需晚于当前时间'))),
                  }]}
                >
                  <DatePicker
                    showTime={{ format: 'HH:mm' }}
                    format="YYYY-MM-DD HH:mm"
                    locale={locale.DatePicker}
                    disabledDate={(current) => current && current < dayjs().startOf('day')}
                    placeholder="选择日期和时间"
                    style={{ width: 220 }}
                  />
                </Form.Item>
                {QUICK_DURATIONS.map((item) => (
                  <Button
                    key={item.minutes}
                    size="small"
                    onClick={() => {
                      form.setFieldsValue({ expectedEndAt: dayjs().add(item.minutes, 'minute').second(0) });
                      void form.validateFields(['expectedEndAt']).catch(() => {});
                    }}
                  >
                    {item.label}后
                  </Button>
                ))}
              </Space>
            </Form.Item>

            <Form.Item name="content" label="维护说明（可插入图片）">
              <RichTextEditor
                placeholder="例如：为提升服务质量，平台将于今晚进行系统升级，期间暂停报名、编排等全部功能。"
                imageUploadUrl={`${API_BASE}/admin/maintenance/upload-image`}
                imageUploadHeaders={token ? { Authorization: `Bearer ${token}` } : undefined}
                imageUploadMaxSizeMb={5}
              />
            </Form.Item>

            <Space wrap>
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
                保存内容
              </Button>
              <Typography.Text type="secondary">
                {enabled ? '维护中保存会立即更新维护页。' : '可以提前写好，开启维护时一并生效。'}
              </Typography.Text>
            </Space>
          </Form>
        </Card>
      </Space>

      <Modal
        title={confirmAction === 'open' ? '确认开启全服维护？' : '确认结束维护？'}
        open={confirmAction !== null}
        onCancel={() => setConfirmAction(null)}
        onOk={() => void save(confirmAction === 'open')}
        okText={confirmAction === 'open' ? '确认开启' : '确认恢复'}
        cancelText="取消"
        okButtonProps={{ danger: confirmAction === 'open', loading: saving }}
      >
        {confirmAction === 'open' ? (
          <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
            开启后几秒内全站生效：除管理员和超级管理员外，所有人只能看到维护页，报名、编排、记分等全部功能暂停；
            管理员只能查看。当前填写的标题、说明和预计恢复时间会一并保存。
          </Typography.Paragraph>
        ) : (
          <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
            结束后网站立即恢复正常，正在看维护页的用户会自动回到原来的页面。
          </Typography.Paragraph>
        )}
      </Modal>

      <Modal
        title="维护页预览"
        open={preview !== null}
        onCancel={() => setPreview(null)}
        footer={null}
        width={920}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        {preview ? (
          <MaintenanceView
            embedded
            title={preview.title}
            content={preview.content}
            startedAt={previewStartedAt}
            expectedEndAt={preview.expectedEndAt ? preview.expectedEndAt.toISOString() : null}
          />
        ) : null}
      </Modal>
    </div>
  );
}
