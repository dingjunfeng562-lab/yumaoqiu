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
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

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
  conflicts: ConflictItem[];
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

function rowConflictClass(row: ScheduleMatch) {
  if (row.conflicts.some((item) => item.type === 'DEPENDENCY' || item.type === 'VENUE')) {
    return 'schedule-error-row';
  }
  if (row.conflicts.length) return 'schedule-warning-row';
  return '';
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
  const [venueModalOpen, setVenueModalOpen] = useState(false);
  const [autoModalOpen, setAutoModalOpen] = useState(false);
  const [editingMatch, setEditingMatch] = useState<ScheduleMatch | null>(null);
  const [venueForm] = Form.useForm();
  const [autoForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const activeVenues = useMemo(() => schedule.venues.filter((venue) => venue.isActive), [schedule.venues]);

  async function loadBase() {
    if (!token) return;
    const data = await apiFetch<Tournament[]>('/tournaments', { token });
    setTournaments(data);
    if (!selectedTournamentId) setSelectedTournamentId(data[0]?.id ?? '');
  }

  async function loadEvents(tournamentId: string) {
    if (!token || !tournamentId) return;
    const data = await apiFetch<EventItem[]>(`/events?tournamentId=${tournamentId}`, { token });
    setEvents(data);
    setSelectedEventId('');
  }

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
    loadBase().catch((error) => message.error(error instanceof Error ? error.message : '加载赛事失败'));
  }, [token]);

  useEffect(() => {
    if (!selectedTournamentId) return;
    loadEvents(selectedTournamentId).catch((error) => message.error(error instanceof Error ? error.message : '加载单项失败'));
  }, [token, selectedTournamentId]);

  useEffect(() => {
    if (!selectedTournamentId) return;
    loadSchedule();
  }, [token, selectedTournamentId, selectedEventId]);

  async function createVenue(values: { name: string; sortOrder?: number }) {
    if (!token || !selectedTournamentId) return;
    try {
      await apiFetch(`/tournaments/${selectedTournamentId}/venues`, {
        method: 'POST',
        token,
        body: JSON.stringify(values),
      });
      message.success('场地已新增');
      setVenueModalOpen(false);
      venueForm.resetFields();
      await loadSchedule();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '新增场地失败');
    }
  }

  async function removeVenue(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/venues/${id}`, { method: 'DELETE', token });
      message.success('场地已删除或停用');
      await loadSchedule();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除场地失败');
    }
  }

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
    try {
      const data = await apiFetch<ScheduleData>(`/matches/${editingMatch.id}/schedule`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          venueId: values.venueId ?? null,
          scheduledAt: values.scheduledAt ? values.scheduledAt.toISOString() : null,
          durationMinutes: values.durationMinutes,
        }),
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
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>场地自动排程</Typography.Title>
          <Typography.Text type="secondary">按依赖、场地和选手占用自动生成赛程，并标记需要处理的冲突。</Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => loadSchedule()} loading={loading}>刷新</Button>
          <Button icon={<PlusOutlined />} onClick={() => setVenueModalOpen(true)}>新增场地</Button>
          <Button type="primary" onClick={() => setAutoModalOpen(true)} disabled={!activeVenues.length}>
            全部重新自动排程
          </Button>
        </Space>
      </div>

      <Card>
        <Space wrap>
          <Select
            style={{ width: 260 }}
            value={selectedTournamentId}
            options={tournaments.map((item) => ({ value: item.id, label: `第${item.edition}届 ${item.name}` }))}
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

      <Card title="场地列表">
        {schedule.venues.length ? (
          <Space wrap>
            {schedule.venues.map((venue) => (
              <Tag
                key={venue.id}
                color={venue.isActive ? 'blue' : 'default'}
                closable
                onClose={(event) => {
                  event.preventDefault();
                  removeVenue(venue.id);
                }}
              >
                {venue.name}{venue.isActive ? '' : '（停用）'}
              </Tag>
            ))}
          </Space>
        ) : (
          <Empty description="暂无场地，请先新增场地" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
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

      <Card title="赛程表">
        <Table
          rowKey="id"
          dataSource={schedule.matches}
          loading={loading}
          rowClassName={rowConflictClass}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1180 }}
          columns={[
            {
              title: '冲突',
              width: 120,
              render: (_, row: ScheduleMatch) => {
                if (!row.conflicts.length) return <Tag>正常</Tag>;
                const conflict = row.conflicts[0];
                const meta = CONFLICT_LABELS[conflict.type];
                return <Tag color={meta.color}>{meta.label}</Tag>;
              },
            },
            { title: '时间', dataIndex: 'scheduledAt', width: 160, render: formatTime },
            { title: '场地', dataIndex: 'venueName', width: 120, render: (value) => value || '—' },
            { title: '项目', dataIndex: 'eventTypeLabel', width: 120 },
            { title: '轮次', dataIndex: 'round', width: 90 },
            { title: '场次', dataIndex: 'matchNo', width: 90, render: (value) => `第${value}场` },
            {
              title: '对阵',
              render: (_, row: ScheduleMatch) => `${sideName(row.side1)} VS ${sideName(row.side2)}`,
            },
            {
              title: '状态',
              width: 100,
              render: (_, row: ScheduleMatch) => {
                const meta = STATUS_LABELS[row.scheduleStatus] ?? STATUS_LABELS[row.status] ?? STATUS_LABELS.PENDING;
                return <Tag color={meta.color}>{meta.label}</Tag>;
              },
            },
            { title: '时长', dataIndex: 'durationMinutes', width: 90, render: (value) => `${value}分钟` },
            {
              title: '操作',
              width: 100,
              fixed: 'right',
              render: (_, row: ScheduleMatch) => (
                <Button icon={<EditOutlined />} onClick={() => openEdit(row)}>
                  调整
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal title="新增场地" open={venueModalOpen} onCancel={() => setVenueModalOpen(false)} onOk={() => venueForm.submit()} destroyOnHidden>
        <Form form={venueForm} layout="vertical" onFinish={createVenue} initialValues={{ sortOrder: schedule.venues.length }}>
          <Form.Item name="name" label="场地名称" rules={[{ required: true, message: '请输入场地名称' }]}>
            <Input placeholder="例如：1号场" />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="自动排程" open={autoModalOpen} onCancel={() => setAutoModalOpen(false)} onOk={() => autoForm.submit()} destroyOnHidden>
        <Form
          form={autoForm}
          layout="vertical"
          onFinish={autoSchedule}
          initialValues={{ startAt: dayjs().add(1, 'hour'), matchMinutes: 45, breakMinutes: 10 }}
        >
          <Form.Item name="startAt" label="开始时间" rules={[{ required: true, message: '请选择开始时间' }]}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="matchMinutes" label="单场预估时长（分钟）" rules={[{ required: true }]}>
            <InputNumber min={5} style={{ width: '100%' }} />
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
          <Form.Item name="venueId" label="场地" rules={[{ required: true, message: '请选择场地' }]}>
            <Select options={activeVenues.map((venue) => ({ value: venue.id, label: venue.name }))} />
          </Form.Item>
          <Form.Item name="scheduledAt" label="比赛时间" rules={[{ required: true, message: '请选择比赛时间' }]}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="durationMinutes" label="预估时长（分钟）" rules={[{ required: true }]}>
            <InputNumber min={5} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
