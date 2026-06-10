'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  InputNumber,
  Popconfirm,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { MailOutlined, SendOutlined, FileSearchOutlined, SaveOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

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

type EventSettingsResponse = {
  tournament: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    location: string | null;
  };
  settings: Record<string, EventSettingItem>;
};

type ReminderStats = { total: number; success: number; failed: number; skipped: number };

const SWITCH_KEYS = [
  { key: 'registration_submitted', label: '报名提交成功通知' },
  { key: 'registration_approved', label: '审核通过通知' },
  { key: 'registration_rejected', label: '审核拒绝通知' },
] as const;

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 赛事详情中的邮件通知设置模块。
 * 仅总管理员可见——父组件必须先确认 SUPER_ADMIN 身份再渲染本组件，
 * 后端接口本身也只允许总管理员访问。
 */
export default function CompetitionEmailSettingsCard({
  competitionId,
  token,
}: {
  competitionId: string;
  token: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<EventSettingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);
  const [switches, setSwitches] = useState<Record<string, boolean>>({});
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [remindMinutes, setRemindMinutes] = useState<number>(1440);

  const applyResponse = useCallback((response: EventSettingsResponse) => {
    setData(response);
    const next: Record<string, boolean> = {};
    for (const item of SWITCH_KEYS) {
      next[item.key] = response.settings[item.key]?.enabled ?? false;
    }
    setSwitches(next);
    setReminderEnabled(response.settings.match_reminder?.enabled ?? false);
    setRemindMinutes(response.settings.match_reminder?.remindBeforeMinutes ?? 1440);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch<EventSettingsResponse>(
        `/admin/email/events/${competitionId}/settings`,
        { token },
      );
      applyResponse(response);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '邮件设置加载失败');
    } finally {
      setLoading(false);
    }
  }, [competitionId, token, applyResponse]);

  useEffect(() => {
    void load();
  }, [load]);

  const scheduledPreview = useMemo(() => {
    if (!data) return '—';
    const start = new Date(data.tournament.startDate).getTime();
    if (Number.isNaN(start)) return '—';
    return formatDateTime(new Date(start - remindMinutes * 60_000).toISOString());
  }, [data, remindMinutes]);

  async function save() {
    setSaving(true);
    try {
      const response = await apiFetch<EventSettingsResponse>(
        `/admin/email/events/${competitionId}/settings`,
        {
          method: 'PUT',
          token,
          body: JSON.stringify({
            registration_submitted: { enabled: switches.registration_submitted ?? false },
            registration_approved: { enabled: switches.registration_approved ?? false },
            registration_rejected: { enabled: switches.registration_rejected ?? false },
            match_reminder: { enabled: reminderEnabled, remindBeforeMinutes: remindMinutes },
          }),
        },
      );
      applyResponse(response);
      message.success('邮件设置已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '邮件设置保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function sendReminderNow() {
    setSendingNow(true);
    try {
      const stats = await apiFetch<ReminderStats>(
        `/admin/email/events/${competitionId}/reminder/send-now`,
        { method: 'POST', token },
      );
      message.success(
        `赛前提醒已发送：共 ${stats.total} 人，成功 ${stats.success}，失败 ${stats.failed}，跳过 ${stats.skipped}`,
      );
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '赛前提醒发送失败');
    } finally {
      setSendingNow(false);
    }
  }

  const reminder = data?.settings.match_reminder;

  return (
    <Card
      size="small"
      style={{ marginTop: 16 }}
      loading={loading && !data}
      title={
        <Space>
          <MailOutlined />
          <span>邮件通知设置</span>
          <Tag color="magenta">仅总管理员可见</Tag>
        </Space>
      }
      extra={
        <Space>
          <Button
            size="small"
            icon={<FileSearchOutlined />}
            onClick={() => router.push(`/admin/email?tab=logs&eventId=${competitionId}`)}
          >
            查看该赛事邮件日志
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={save}
          >
            保存
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space size={24} wrap>
          {SWITCH_KEYS.map((item) => (
            <Space key={item.key} size={8}>
              <Switch
                checked={switches[item.key] ?? false}
                onChange={(checked) => setSwitches((prev) => ({ ...prev, [item.key]: checked }))}
              />
              <Typography.Text>{item.label}</Typography.Text>
            </Space>
          ))}
        </Space>

        <Space size={12} wrap>
          <Space size={8}>
            <Switch checked={reminderEnabled} onChange={setReminderEnabled} />
            <Typography.Text>赛前提醒通知</Typography.Text>
          </Space>
          <Space size={8}>
            <Typography.Text type="secondary">比赛前</Typography.Text>
            <InputNumber
              min={5}
              max={30 * 24 * 60}
              value={remindMinutes}
              onChange={(value) => setRemindMinutes(value ?? 1440)}
              addonAfter="分钟"
              style={{ width: 150 }}
            />
            <Typography.Text type="secondary">发送（预计发送时间：{scheduledPreview}）</Typography.Text>
          </Space>
          <Popconfirm
            title="立即给该赛事所有审核通过的选手发送赛前提醒？"
            description="已成功收到过赛前提醒的邮箱会自动跳过。"
            onConfirm={sendReminderNow}
          >
            <Button size="small" icon={<SendOutlined />} loading={sendingNow}>
              立即发送赛前提醒
            </Button>
          </Popconfirm>
        </Space>

        {reminder?.autoSent ? (
          <Alert
            type="info"
            showIcon
            message="该赛事已自动发送过赛前提醒，如需再次发送请使用「立即发送赛前提醒」。"
          />
        ) : null}
        {reminder?.lastSentAt ? (
          <Typography.Text type="secondary">
            最后发送时间:{formatDateTime(reminder.lastSentAt)}
            {reminder.manualSendCount > 0 ? ` · 手动发送 ${reminder.manualSendCount} 次` : ''}
          </Typography.Text>
        ) : null}
      </Space>
    </Card>
  );
}
