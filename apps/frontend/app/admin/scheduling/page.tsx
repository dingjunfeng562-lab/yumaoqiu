'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import dayjs, { Dayjs } from 'dayjs';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { roundCn } from '@/lib/round';

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  WAITING_SCHEDULE: { label: '待排程', color: 'warning' },
  PENDING: { label: '未开始', color: 'default' },
  LIVE: { label: '进行中', color: 'green' },
  COMPLETED: { label: '已结束', color: 'blue' },
  CANCELLED: { label: '已取消', color: 'default' },
};

const CONFLICT_LABELS: Record<ConflictItem['type'], { label: string; color: string }> = {
  UNSCHEDULED: { label: '待排程', color: 'default' },
  PLAYER: { label: '时间冲突', color: 'orange' },
  VENUE: { label: '场地冲突', color: 'red' },
  DEPENDENCY: { label: '依赖错误', color: 'red' },
};

interface Tournament {
  id: string;
  name: string;
  edition: number;
  startDate: string;
  endDate: string;
  defaultMatchMinutes: number;
  breakMinutes: number;
  dailyStartTime: string;
  dailyEndTime: string;
  venues: Venue[];
}

interface EventItem {
  id: string;
  tournamentId: string;
  type: string;
}

interface Venue {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

interface ConflictItem {
  type: 'VENUE' | 'PLAYER' | 'DEPENDENCY' | 'UNSCHEDULED';
  matchIds: string[];
  message: string;
}

interface ScheduleMatch {
  id: string;
  eventId: string | null;
  eventType: string;
  eventTypeLabel: string;
  round: string;
  roundNo: number;
  matchNo: number;
  venueSequence?: number | null;
  side1Id?: string | null;
  side2Id?: string | null;
  side1?: { name: string; affiliation: string } | null;
  side2?: { name: string; affiliation: string } | null;
  status: string;
  scheduleStatus: string;
  dependenciesReady: boolean;
  venueId?: string | null;
  venueName?: string | null;
  scheduledAt?: string | null;
  durationMinutes: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  conflicts: ConflictItem[];
}

function formatActualDuration(row: ScheduleMatch) {
  if (!row.startedAt) return '—';
  const end = row.finishedAt ? new Date(row.finishedAt).getTime() : Date.now();
  const start = new Date(row.startedAt).getTime();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return row.finishedAt ? `${m}分${s.toString().padStart(2, '0')}秒` : `${m}分${s.toString().padStart(2, '0')}秒（进行中）`;
}

interface ScheduleData {
  venues: Venue[];
  matches: ScheduleMatch[];
  conflicts: ConflictItem[];
}

function sideName(side?: { name: string } | null) {
  return side?.name ?? '待定';
}

function formatTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';
}

function scheduleGroupLabel(row: ScheduleMatch) {
  const round = row.round?.trim();
  if (!round) return '—';
  if (row.roundNo === 0) return round.endsWith('组') ? round : `${round}组`;
  return roundCn(round);
}

function rowConflictClass(row: ScheduleMatch) {
  if (row.conflicts.some((item) => item.type === 'DEPENDENCY' || item.type === 'VENUE')) {
    return 'schedule-error-row';
  }
  if (row.conflicts.length) return 'schedule-warning-row';
  return '';
}

function defaultAutoStart(tournament?: Tournament) {
  if (!tournament) return dayjs().add(1, 'hour');
  const date = dayjs(tournament.startDate);
  const [hour, minute] = tournament.dailyStartTime.split(':').map(Number);
  return date.hour(hour || 0).minute(minute || 0).second(0).millisecond(0);
}

export default function AdminSchedulingPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [schedule, setSchedule] = useState<ScheduleData>({ venues: [], matches: [], conflicts: [] });
  const [loading, setLoading] = useState(false);
  const [autoModalOpen, setAutoModalOpen] = useState(false);
  const [editingMatch, setEditingMatch] = useState<ScheduleMatch | null>(null);
  const [autoForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const selectedTournament = useMemo(
    () => tournaments.find((item) => item.id === selectedTournamentId),
    [selectedTournamentId, tournaments],
  );
  const configuredVenues = selectedTournament?.venues ?? schedule.venues;
  const activeVenues = useMemo(() => configuredVenues.filter((venue) => venue.isActive), [configuredVenues]);

  async function loadSchedule(tournamentId = selectedTournamentId, eventId = selectedEventId) {
    if (!token || !tournamentId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ tournamentId });
      if (eventId) query.set('eventId', eventId);
      const data = await apiFetch<ScheduleData>(`/scheduling?${query.toString()}`, { token });
      setSchedule(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载排程失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<Tournament[]>('/tournaments', { token })
      .then((data) => {
        if (cancelled) return;
        setTournaments(data);
        setSelectedTournamentId((current) => current || data[0]?.id || '');
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '加载赛事失败'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !selectedTournamentId) return;
    let cancelled = false;
    apiFetch<EventItem[]>(`/events?tournamentId=${selectedTournamentId}`, { token })
      .then((data) => {
        if (cancelled) return;
        setEvents(data);
        setSelectedEventId('');
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '加载单项失败'));
    return () => {
      cancelled = true;
    };
  }, [token, selectedTournamentId]);

  useEffect(() => {
    if (!token || !selectedTournamentId) return;
    let cancelled = false;
    const query = new URLSearchParams({ tournamentId: selectedTournamentId });
    if (selectedEventId) query.set('eventId', selectedEventId);
    Promise.resolve()
      .then(() => {
        if (!cancelled) setLoading(true);
        return apiFetch<ScheduleData>(`/scheduling?${query.toString()}`, { token });
      })
      .then((data) => {
        if (!cancelled) setSchedule(data);
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '加载排程失败'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, selectedTournamentId, selectedEventId]);

  async function autoSchedule(values: {
    startAt: Dayjs;
    matchMinutes: number;
    breakMinutes: number;
    venueIds?: string[];
    eventTypeOrder?: string[];
  }) {
    if (!token || !selectedTournamentId) return;
    try {
      const data = await apiFetch<ScheduleData>('/scheduling/auto', {
        method: 'POST',
        token,
        body: JSON.stringify({
          tournamentId: selectedTournamentId,
          eventId: selectedEventId || undefined,
          startAt: values.startAt.toISOString(),
          matchMinutes: values.matchMinutes,
          breakMinutes: values.breakMinutes,
          venueIds: values.venueIds,
          eventTypeOrder: values.eventTypeOrder,
        }),
      });
      setSchedule(data);
      setAutoModalOpen(false);
      message.success('自动排程完成');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '自动排程失败');
    }
  }

  async function clearSchedule() {
    if (!token || !selectedTournamentId) return;
    setLoading(true);
    try {
      const data = await apiFetch<ScheduleData>('/scheduling/clear', {
        method: 'POST',
        token,
        body: JSON.stringify({
          tournamentId: selectedTournamentId,
          eventId: selectedEventId || undefined,
        }),
      });
      setSchedule(data);
      message.success('已取消场地排程，相关场次回到待排程');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '取消场地排程失败');
    } finally {
      setLoading(false);
    }
  }

  async function quickUpdateDuration(match: ScheduleMatch, durationMinutes: number) {
    if (!token || !durationMinutes || durationMinutes === match.durationMinutes) return;
    try {
      const data = await apiFetch<ScheduleData>(`/matches/${match.id}/schedule`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ durationMinutes }),
      });
      setSchedule(data);
      message.success('时长已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新时长失败');
    }
  }

  function openAutoSchedule() {
    autoForm.setFieldsValue({
      startAt: defaultAutoStart(selectedTournament),
      matchMinutes: selectedTournament?.defaultMatchMinutes ?? 45,
      breakMinutes: selectedTournament?.breakMinutes ?? 10,
      venueIds: undefined,
      eventTypeOrder: undefined,
    });
    setAutoModalOpen(true);
  }

  function openEdit(match: ScheduleMatch) {
    setEditingMatch(match);
    editForm.setFieldsValue({
      venueId: match.venueId,
      scheduledAt: match.scheduledAt ? dayjs(match.scheduledAt) : null,
      durationMinutes: match.durationMinutes,
    });
  }

  async function updateMatchSchedule(values: {
    venueId?: string;
    scheduledAt?: Dayjs | null;
    durationMinutes?: number;
  }) {
    if (!token || !editingMatch) return;
    const payload: Record<string, unknown> = {};
    if (values.venueId !== undefined) payload.venueId = values.venueId || null;
    if (values.scheduledAt !== undefined) {
      payload.scheduledAt = values.scheduledAt ? values.scheduledAt.toISOString() : null;
    }
    if (values.durationMinutes !== undefined) payload.durationMinutes = values.durationMinutes;
    try {
      const data = await apiFetch<ScheduleData>(`/matches/${editingMatch.id}/schedule`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
      });
      setSchedule(data);
      setEditingMatch(null);
      message.success('排程已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新排程失败');
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <style>{`
        .schedule-warning-row > td {
          background: #fff7ed !important;
        }
        .schedule-error-row > td {
          background: #fef2f2 !important;
        }
        .schedule-table-compact .ant-card-body {
          padding: 8px;
        }
        .schedule-table-compact .ant-table {
          font-size: 12px;
        }
        .schedule-table-compact .ant-table-thead > tr > th,
        .schedule-table-compact .ant-table-tbody > tr > td {
          padding: 5px 6px !important;
          line-height: 1.35;
        }
        .schedule-table-compact .ant-tag {
          margin-inline-end: 0;
          padding-inline: 5px;
          font-size: 11px;
          line-height: 18px;
        }
        .schedule-table-compact .ant-input-number-group-wrapper {
          width: 72px !important;
        }
        .schedule-table-compact .ant-input-number-input {
          height: 22px;
          padding-inline: 5px;
        }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>场地自动排程</Typography.Title>
          <Typography.Text type="secondary">按依赖、场地和选手占用自动生成赛程，并标记需要处理的冲突。</Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => loadSchedule()} loading={loading}>刷新</Button>
          <Button href="/admin/tournaments">编辑赛程设置</Button>
          <Popconfirm
            title="取消后将清空当前所选范围内所有未开始场次的场地与时间（已完赛/进行中的不受影响），确认继续？"
            onConfirm={clearSchedule}
            disabled={!selectedTournamentId}
          >
            <Button danger icon={<DeleteOutlined />} disabled={!selectedTournamentId}>
              取消场地排程
            </Button>
          </Popconfirm>
          <Button type="primary" onClick={openAutoSchedule} disabled={!activeVenues.length}>
            全部重新自动排程
          </Button>
        </Space>
      </div>

      <Card>
        <Space wrap>
          <Select
            style={{ width: 260 }}
            value={selectedTournamentId}
            options={tournaments.map((item) => ({ value: item.id, label: item.name }))}
            onChange={setSelectedTournamentId}
            placeholder="选择赛事"
          />
          <Select
            style={{ width: 220 }}
            value={selectedEventId}
            options={[
              { value: '', label: '全部单项' },
              ...events.map((item) => ({ value: item.id, label: EVENT_TYPE_LABELS[item.type] ?? item.type })),
            ]}
            onChange={setSelectedEventId}
            placeholder="选择单项"
          />
        </Space>
      </Card>

      <Card title="场地列表（来自赛事设置）">
        {configuredVenues.length ? (
          <Space wrap>
            {configuredVenues.map((venue) => (
              <Tag
                key={venue.id}
                color={venue.isActive ? 'blue' : 'default'}
              >
                {venue.name}{venue.isActive ? '' : '（停用）'}
              </Tag>
            ))}
          </Space>
        ) : (
          <Empty description="暂无场地，请先到赛事配置中设置比赛场地" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          自动排程只使用赛事配置中启用的场地；如需调整，请到赛事配置的“场地与时间”中修改。
        </Typography.Text>
      </Card>

      {schedule.conflicts.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`检测到 ${schedule.conflicts.length} 个排程项需要处理`}
          description={
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {schedule.conflicts.slice(0, 6).map((conflict, index) => (
                <li key={`${conflict.type}-${index}`}>{conflict.message}</li>
              ))}
            </ul>
          }
        />
      )}

      <Card title="赛程表" size="small" className="schedule-table-compact">
        <Table
          rowKey="id"
          size="small"
          tableLayout="fixed"
          dataSource={schedule.matches}
          loading={loading}
          rowClassName={rowConflictClass}
          pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
          scroll={{ x: 820 }}
          columns={[
            {
              title: '冲突',
              width: 64,
              render: (_, row: ScheduleMatch) => {
                if (!row.conflicts.length) return <Tag>正常</Tag>;
                const conflict = row.conflicts[0];
                const meta = CONFLICT_LABELS[conflict.type];
                return <Tag color={meta.color}>{meta.label}</Tag>;
              },
            },
            { title: '时间', dataIndex: 'scheduledAt', width: 118, render: formatTime },
            { title: '场地', dataIndex: 'venueName', width: 68, ellipsis: true, render: (value) => value || '—' },
            { title: '项目', dataIndex: 'eventTypeLabel', width: 74, ellipsis: true },
            { title: '组别', key: 'groupLabel', width: 62, ellipsis: true, render: (_: unknown, row: ScheduleMatch) => scheduleGroupLabel(row) },
            {
              title: '场次',
              dataIndex: 'venueSequence',
              width: 58,
              render: (value: number | null | undefined) => (value ? `第${value}场` : '—'),
            },
            {
              title: '对阵',
              width: 190,
              ellipsis: true,
              render: (_, row: ScheduleMatch) => `${sideName(row.side1)} VS ${sideName(row.side2)}`,
            },
            {
              title: '状态',
              width: 66,
              render: (_, row: ScheduleMatch) => {
                const meta = STATUS_LABELS[row.scheduleStatus] ?? STATUS_LABELS[row.status] ?? STATUS_LABELS.PENDING;
                return <Tag color={meta.color}>{meta.label}</Tag>;
              },
            },
            {
              title: '预估',
              dataIndex: 'durationMinutes',
              width: 78,
              render: (value: number, row: ScheduleMatch) => (
                <InputNumber
                  key={`${row.id}-${value}`}
                  size="small"
                  min={1}
                  defaultValue={value}
                  onBlur={(e) => {
                    const next = Number((e.target as HTMLInputElement).value);
                    if (Number.isFinite(next)) quickUpdateDuration(row, next);
                  }}
                  onPressEnter={(e) => {
                    const next = Number((e.target as HTMLInputElement).value);
                    if (Number.isFinite(next)) quickUpdateDuration(row, next);
                  }}
                  addonAfter="分"
                  style={{ width: 72 }}
                />
              ),
            },
            {
              title: '实际',
              width: 82,
              ellipsis: true,
              render: (_: unknown, row: ScheduleMatch) => formatActualDuration(row),
            },
            {
              title: '操作',
              width: 58,
              render: (_, row: ScheduleMatch) => (
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} aria-label="调整" />
              ),
            },
          ]}
        />
      </Card>

      <Modal title="自动排程" open={autoModalOpen} onCancel={() => setAutoModalOpen(false)} onOk={() => autoForm.submit()} destroyOnHidden>
        <Form
          form={autoForm}
          layout="vertical"
          onFinish={autoSchedule}
          initialValues={{
            startAt: defaultAutoStart(selectedTournament),
            matchMinutes: selectedTournament?.defaultMatchMinutes ?? 45,
            breakMinutes: selectedTournament?.breakMinutes ?? 10,
          }}
        >
          <Form.Item name="startAt" label="开始时间" rules={[{ required: true, message: '请选择开始时间' }]}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="matchMinutes" label="单场预估时长（分钟）" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="breakMinutes" label="场间间隔（分钟）" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="venueIds" label="使用场地（不选则使用全部启用场地）">
            <Select
              mode="multiple"
              allowClear
              options={activeVenues.map((venue) => ({ value: venue.id, label: venue.name }))}
            />
          </Form.Item>
          <Form.Item name="eventTypeOrder" label="项目优先级（从左到右）">
            <Select
              mode="multiple"
              allowClear
              options={events.map((item) => ({ value: item.type, label: EVENT_TYPE_LABELS[item.type] ?? item.type }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="手动调整排程" open={Boolean(editingMatch)} onCancel={() => setEditingMatch(null)} onOk={() => editForm.submit()} destroyOnHidden>
        <Form form={editForm} layout="vertical" onFinish={updateMatchSchedule}>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            场地与时间留空表示不变更；预估时长可独立修改而不影响其他字段。
          </Typography.Text>
          <Form.Item name="venueId" label="场地">
            <Select allowClear options={activeVenues.map((venue) => ({ value: venue.id, label: venue.name }))} />
          </Form.Item>
          <Form.Item name="scheduledAt" label="比赛时间">
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="durationMinutes" label="预估时长（分钟）" rules={[{ required: true, message: '请输入预估时长' }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
