'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { GroupVenueSettings, type GroupVenueRule } from '@/components/admin/GroupVenueSettings';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import dayjs, { Dayjs } from 'dayjs';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Dropdown,
  Empty,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  TimePicker,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, DownloadOutlined, DownOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { roundCn } from '@/lib/round';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

// 有淘汰 / 排位阶段的赛制都允许按阶段导出；ROUND_ROBIN 只有循环赛阶段。
const SECOND_STAGE_FORMATS = [
  'GROUP_PLUS_KNOCKOUT',
  'GROUP_PLUS_KNOCKOUT_STD',
  'GROUP_PLUS_PLAYOFF',
  'SINGLE_ELIMINATION_PLUS_GROUP_RANKING',
];

type ScheduleStage = 'all' | 'second';

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
  GROUP_VENUE: { label: '需调场', color: 'orange' },
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
  groupLabel?: string;
  group?: { name: string };
  id: string;
  tournamentId: string;
  type: string;
  format?: string;
}

interface Venue {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

interface ConflictItem {
  type: 'VENUE' | 'PLAYER' | 'DEPENDENCY' | 'UNSCHEDULED' | 'GROUP_VENUE';
  matchIds: string[];
  message: string;
}

interface ScheduleMatch {
  groupId: string | null;
  groupName: string | null;
  scheduleLocked: boolean;
  scheduleOverride: boolean;
  allowedVenueIds: string[] | null;
  id: string;
  teamMatchId?: string | null;
  team1Name?: string | null;
  team2Name?: string | null;
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
  scheduledAtLocal?: string | null;
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
  groups?: GroupVenueRule[];
  teamCourtLimits?: Array<{ competitionId: string; name: string; teamCount: number; maxCourts: number; canAdjust: boolean }>;
  venues: Venue[];
  matches: ScheduleMatch[];
  conflicts: ConflictItem[];
}

type AutoPreview = {
  fingerprint: string; scheduledCount: number; preservedCount: number;
  groups: Array<GroupVenueRule & { scheduled: number; unscheduled: number; estimatedEnd: string | null }>;
  unscheduled: Array<{ matchId: string; reason: string }>;
  matches: ScheduleMatch[];
};
type ManualPreview = {
  changes: Array<{ matchId: string; venueId: string | null; venueName: string | null; scheduledAt: string | null; scheduledAtLocal: string | null }>;
  conflicts: ConflictItem[]; outsideGroup: boolean;
  venues: Array<{ id: string; name: string; inGroup: boolean; available: boolean; reason: string | null }>;
};

function sideName(side?: { name: string } | null) {
  return side?.name ?? '待定';
}

function hasSecondStageFormat(format?: string | null) {
  return SECOND_STAGE_FORMATS.includes(format ?? '');
}

function formatTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';
}

function formatScheduleTime(row: ScheduleMatch) {
  return row.scheduledAtLocal ?? formatTime(row.scheduledAt);
}

function parseScheduleLocalTime(value: string) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})$/.exec(value);
  if (!match) return dayjs(value);
  return dayjs()
    .year(Number(match[1]))
    .month(Number(match[2]) - 1)
    .date(Number(match[3]))
    .hour(Number(match[4]))
    .minute(Number(match[5]))
    .second(0)
    .millisecond(0);
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

function dailyTimeValue(value?: string, fallback = '18:00') {
  const [hour, minute] = (value || fallback).split(':').map(Number);
  return dayjs().hour(hour || 0).minute(minute || 0).second(0).millisecond(0);
}

export default function AdminSchedulingPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [schedule, setSchedule] = useState<ScheduleData>({ venues: [], matches: [], conflicts: [] });
  const [loading, setLoading] = useState(false);
  const [autoModalOpen, setAutoModalOpen] = useState(false);
  const [autoPreview, setAutoPreview] = useState<AutoPreview | null>(null);
  const [autoPayload, setAutoPayload] = useState<Record<string, unknown> | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [manualPreview, setManualPreview] = useState<ManualPreview | null>(null);
  const manualVersion = useRef(0);
  const [includeLocked, setIncludeLocked] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: string; action: string; actorId: string | null; actorName: string; createdAt: string; before: unknown; after: unknown }> | null>(null);
  const [editingMatch, setEditingMatch] = useState<ScheduleMatch | null>(null);
  const [autoForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [exportingStage, setExportingStage] = useState(false);

  const selectedTournament = useMemo(
    () => tournaments.find((item) => item.id === selectedTournamentId),
    [selectedTournamentId, tournaments],
  );
  const selectedEvent = useMemo(
    () => events.find((item) => item.id === selectedEventId),
    [events, selectedEventId],
  );
  const canExportStageOrder = Boolean(
    selectedEventId && selectedEvent && hasSecondStageFormat(selectedEvent.format),
  );
  const canScheduleSecondStage = selectedEventId
    ? hasSecondStageFormat(selectedEvent?.format)
    : events.some((event) => hasSecondStageFormat(event.format));
  const configuredVenues = schedule.venues;
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
    let request = 0;
    const refresh = async () => {
      const version = ++request;
      try {
        const data = await apiFetch<ScheduleData>(`/scheduling?${query.toString()}`, { token });
        if (!cancelled && version === request) setSchedule(data);
      } catch (error) { if (!cancelled) message.error(error instanceof Error ? error.message : '加载排程失败'); }
      finally { if (!cancelled) setLoading(false); }
    };
    const socket = io(`${API_BASE.replace(/\/api\/?$/, '')}/scores`, { transports: ['polling', 'websocket'], withCredentials: true });
    let timer: ReturnType<typeof setTimeout>;
    const queueRefresh = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 150); };
    socket.on('connect', queueRefresh);
    socket.on('bracket:update', (payload: { tournamentId?: string }) => { if (payload.tournamentId === selectedTournamentId) queueRefresh(); });
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); socket.disconnect(); };
  }, [token, selectedTournamentId, selectedEventId]);

  async function autoSchedule(values: {
    startAt: Dayjs; dailyEndTime: Dayjs; hasBreakPeriods?: boolean;
    breakPeriods?: Array<{ startTime: Dayjs; durationMinutes: number }>;
    matchMinutes: number; breakMinutes: number; venueIds?: string[]; eventTypeOrder?: string[];
    scheduleStage?: ScheduleStage; overrideMatchMinutes?: boolean;
  }) {
    if (!token || !selectedTournamentId) return;
    setScheduleBusy(true);
    try {
      const payload = {
        tournamentId: selectedTournamentId, eventId: selectedEventId || undefined,
        startAt: values.startAt.toISOString(), startAtLocal: values.startAt.format('YYYY-MM-DD HH:mm'),
        dailyStartTime: values.startAt.format('HH:mm'), dailyEndTime: values.dailyEndTime.format('HH:mm'),
        breakPeriods: values.hasBreakPeriods ? (values.breakPeriods ?? []).map(p => ({ startTime: p.startTime.format('HH:mm'), durationMinutes: p.durationMinutes })) : [],
        matchMinutes: values.matchMinutes, breakMinutes: values.breakMinutes, venueIds: values.venueIds,
        eventTypeOrder: values.eventTypeOrder, prioritizeSecondStage: true, scheduleStage: values.scheduleStage ?? 'all',
        overrideMatchMinutes: values.overrideMatchMinutes ?? false,
      };
      const result = await apiFetch<{ preview: AutoPreview }>('/scheduling/auto', { method: 'POST', token, body: JSON.stringify({ ...payload, preview: true }) });
      setAutoPayload(payload); setAutoPreview(result.preview); setAutoModalOpen(false);
    } catch (e) { message.error(e instanceof Error ? e.message : '预览失败'); }
    finally { setScheduleBusy(false); }
  }

  async function applyAutoSchedule() {
    if (!token || !autoPayload || !autoPreview) return;
    setScheduleBusy(true);
    try {
      await apiFetch('/scheduling/auto', { method: 'POST', token, body: JSON.stringify({ ...autoPayload, fingerprint: autoPreview.fingerprint }) });
      setAutoPreview(null); await loadSchedule(); message.success('排程已应用，大屏及裁判端已同步更新');
    } catch (e) { message.error(e instanceof Error ? e.message : '应用失败，请重新预览'); }
    finally { setScheduleBusy(false); }
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
          includeLocked,
        }),
      });
      setSchedule(data);
      message.success(includeLocked ? '已清空未开始比赛的排程及人工固定' : '已清空排程，人工固定的比赛已保留');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '取消场地排程失败');
    } finally {
      setLoading(false);
    }
  }

  async function exportStageOrder(stage: 'first' | 'second') {
    if (!token || !selectedEventId) return;
    const stageLabel = stage === 'first' ? '第一阶段' : '第二阶段';
    setExportingStage(true);
    try {
      const res = await fetch(`${API_BASE}/exports/events/${selectedEventId}/stage-order?stage=${stage}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: '导出失败' }));
        throw new Error(error.message ?? '导出失败');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition');
      const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      const fallback = `${(selectedTournament?.name ?? '赛事').replace(/[\\/:*?"<>|]/g, '-')}-${stageLabel}秩序册.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = encoded ? decodeURIComponent(encoded) : fallback;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      message.success(`${stageLabel}秩序册已导出`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExportingStage(false);
    }
  }

  async function quickUpdateDuration(match: ScheduleMatch, durationMinutes: number) {
    if (!token || !durationMinutes || durationMinutes === match.durationMinutes) return;
    try {
      await apiFetch<ScheduleData>(`/matches/${match.id}/schedule`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ durationMinutes }),
      });
      await loadSchedule();
      message.success('时长已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新时长失败');
    }
  }

  function openAutoSchedule() {
    autoForm.setFieldsValue({
      startAt: defaultAutoStart(selectedTournament),
      dailyEndTime: dailyTimeValue(selectedTournament?.dailyEndTime),
      hasBreakPeriods: false,
      breakPeriods: [{ startTime: dailyTimeValue('12:00'), durationMinutes: 60 }],
      matchMinutes: selectedTournament?.defaultMatchMinutes ?? 45,
      breakMinutes: selectedTournament?.breakMinutes ?? 10,
      venueIds: undefined,
      eventTypeOrder: undefined,
      scheduleStage: 'all',
      overrideMatchMinutes: false,
    });
    setAutoModalOpen(true);
  }

  function openEdit(match: ScheduleMatch) {
    setEditingMatch(match);
    setManualPreview(null); manualVersion.current += 1;
    const first = match.teamMatchId
      ? [...schedule.matches].filter(row => row.teamMatchId === match.teamMatchId && row.status === 'PENDING').sort((a, b) => a.matchNo - b.matchNo)[0] ?? match
      : match;
    editForm.setFieldsValue({
      venueId: match.venueId,
      scheduledAt: first.scheduledAtLocal
        ? parseScheduleLocalTime(first.scheduledAtLocal)
        : first.scheduledAt
          ? dayjs(first.scheduledAt)
          : null,
      durationMinutes: match.durationMinutes,
      scheduleLocked: true,
      allowOutsideGroup: false,
    });
  }

  function editPayload(values: { venueId?: string; scheduledAt?: Dayjs | null; durationMinutes?: number; scheduleLocked?: boolean; allowOutsideGroup?: boolean }) {
    return { venueId: values.venueId || undefined,
      scheduledAt: values.scheduledAt?.toISOString(), scheduledAtLocal: values.scheduledAt?.format('YYYY-MM-DD HH:mm'),
      durationMinutes: values.durationMinutes, scheduleLocked: values.scheduleLocked, allowOutsideGroup: values.allowOutsideGroup };
  }

  async function previewManual(findNextAvailable = false) {
    if (!token || !editingMatch) return;
    const version = ++manualVersion.current;
    setScheduleBusy(true);
    try {
      const result = await apiFetch<ManualPreview>(`/matches/${editingMatch.id}/schedule-preview`, {
        method: 'POST', token, body: JSON.stringify({ ...editPayload(editForm.getFieldsValue()), findNextAvailable }),
      });
      if (version !== manualVersion.current) return;
      setManualPreview(result);
      if (findNextAvailable && result.changes[0]?.scheduledAtLocal) editForm.setFieldValue('scheduledAt', parseScheduleLocalTime(result.changes[0].scheduledAtLocal));
    } catch (e) { message.error(e instanceof Error ? e.message : '检查失败'); }
    finally { setScheduleBusy(false); }
  }

  async function updateMatchSchedule(values: Parameters<typeof editPayload>[0]) {
    if (!token || !editingMatch) return;
    const payload = editPayload(values);
    setScheduleBusy(true);
    try {
      const preview = await apiFetch<ManualPreview>(`/matches/${editingMatch.id}/schedule-preview`, { method: 'POST', token, body: JSON.stringify(payload) });
      setManualPreview(preview);
      if (preview.conflicts.length) { message.error(preview.conflicts[0].message); return; }
      if (preview.outsideGroup && !values.allowOutsideGroup) { message.warning('所选场地超出组别范围，请确认临时借场'); return; }
      await apiFetch(`/matches/${editingMatch.id}/schedule`, { method: 'PATCH', token, body: JSON.stringify(payload) });
      setEditingMatch(null); await loadSchedule(); message.success('排程已更新，大屏及裁判端已同步');
    } catch (e) { message.error(e instanceof Error ? e.message : '更新排程失败'); }
    finally { setScheduleBusy(false); }
  }

  async function unlock(match: ScheduleMatch) {
    if (!token) return;
    try {
      await apiFetch(`/matches/${match.id}/schedule`, { method: 'PATCH', token, body: JSON.stringify({ scheduleLocked: false }) });
      await loadSchedule(); message.success('已取消人工固定，下次自动排程可重新安排');
    } catch (e) { message.error(e instanceof Error ? e.message : '取消固定失败'); }
  }

  function logDescription(value: unknown): string {
    if (Array.isArray(value)) return value.map(item => logDescription(item)).join('\n');
    if (!value || typeof value !== 'object') return '—';
    const row = value as Record<string, unknown>;
    if (row.groupId) return `${String(row.name ?? '组别')}：${row.restrictVenues ? (row.venueIds as string[]).map(id => configuredVenues.find(v => v.id === id)?.name ?? '已删除场地').join('、') : '不限制'}`;
    if (row.matchId) {
      const match = schedule.matches.find(m => m.id === row.matchId);
      return `${match ? `${match.groupName ?? ''} ${match.eventTypeLabel} ${match.round} 第${match.matchNo}场` : '比赛'}：${configuredVenues.find(v => v.id === row.venueId)?.name ?? '未分配场地'} · ${formatTime(row.scheduledAt as string | null)} · ${row.durationMinutes}分钟${row.scheduleLocked ? ' · 人工固定' : ''}${row.scheduleOverride ? ' · 临时借场' : ''}`;
    }
    if (typeof row.count === 'number') return `已清空 ${row.count} 场未开始比赛，${row.includeLocked ? '包括人工固定安排' : '保留人工固定安排'}`;
    return '—';
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
        .schedule-duration-grid {
          display: grid;
          grid-template-columns: 80px minmax(0, 1fr);
          align-items: center;
          column-gap: 8px;
          min-width: 0;
        }
        .schedule-duration-grid .ant-input-number-group-wrapper {
          width: 80px !important;
        }
        .schedule-duration-actual {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .schedule-table-compact .ant-input-number-input {
          height: 22px;
          padding-inline: 5px;
        }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>场地自动排程</Typography.Title>
          <Typography.Text type="secondary">按依赖、场地和选手占用自动生成赛程；每场团体对阵的全部子项在同一场地按顺序进行。</Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => loadSchedule()} loading={loading}>刷新</Button>
          <Button
            disabled={!selectedTournamentId}
            onClick={() => {
              if (!selectedTournamentId) return;
              router.push(`/nicaiyixiahh/tournaments?edit=${encodeURIComponent(selectedTournamentId)}`);
            }}
          >
            编辑赛程设置
          </Button>
          <Dropdown
            disabled={!canExportStageOrder}
            menu={{
              items: [
                { key: 'first', label: '导出第一阶段秩序册' },
                { key: 'second', label: '导出第二阶段秩序册' },
              ],
              onClick: ({ key }) => exportStageOrder(key as 'first' | 'second'),
            }}
          >
            <Button
              icon={<DownloadOutlined />}
              loading={exportingStage}
              disabled={!canExportStageOrder}
              title={canExportStageOrder ? undefined : '请选择带淘汰/排位阶段的单项'}
            >
              导出秩序册 <DownOutlined />
            </Button>
          </Dropdown>
          <GroupVenueSettings key={selectedTournamentId} tournamentId={selectedTournamentId} token={token ?? ''} groups={schedule.groups ?? []} venues={configuredVenues} onSaved={() => loadSchedule()} />
          <Button disabled={!selectedTournamentId} onClick={async () => {
            try { setLogs(await apiFetch(`/tournaments/${selectedTournamentId}/schedule-logs`, { token })); }
            catch (e) { message.error(e instanceof Error ? e.message : '加载记录失败'); }
          }}>调整记录</Button>
          <Popconfirm
            title="清空当前范围内未开始比赛的排程？"
            description={<Checkbox checked={includeLocked} onChange={e => setIncludeLocked(e.target.checked)}>同时清除人工固定安排（默认保留）</Checkbox>}
            onConfirm={clearSchedule}
            disabled={!selectedTournamentId}
          >
            <Button danger icon={<DeleteOutlined />} disabled={!selectedTournamentId}>
              取消场地排程
            </Button>
          </Popconfirm>
          <Button type="primary" onClick={openAutoSchedule} disabled={!activeVenues.length}>
            自动排程
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
              ...events.map((item) => ({ value: item.id, label: `${item.group?.name ?? item.groupLabel ?? ''} ${EVENT_TYPE_LABELS[item.type] ?? item.type}`.trim() })),
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
          pagination={{ pageSize: 15, size: 'small', showSizeChanger: false }}
          scroll={{ x: 940 }}
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
            { title: '时间', key: 'scheduledAt', width: 118, render: (_: unknown, row: ScheduleMatch) => formatScheduleTime(row) },
            { title: '场地', dataIndex: 'venueName', width: 110, render: (value, row: ScheduleMatch) => <Space orientation="vertical" size={2}>{value || '—'}{row.scheduleLocked && <Tag color="blue">人工固定</Tag>}{row.scheduleOverride && <Tag color="orange">临时借场</Tag>}</Space> },
            { title: '项目', dataIndex: 'eventTypeLabel', width: 74, ellipsis: true },
            { title: '组别', key: 'groupLabel', width: 62, ellipsis: true, render: (_: unknown, row: ScheduleMatch) => row.groupName ?? scheduleGroupLabel(row) },
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
              render: (_, row: ScheduleMatch) => row.teamMatchId
                ? `${row.team1Name ?? '待定'} VS ${row.team2Name ?? '待定'}`
                : `${sideName(row.side1)} VS ${sideName(row.side2)}`,
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
              title: (
                <div className="schedule-duration-grid">
                  <span>预估</span>
                  <span>实际</span>
                </div>
              ),
              dataIndex: 'durationMinutes',
              width: 176,
              render: (value: number, row: ScheduleMatch) => {
                const actualDuration = formatActualDuration(row);
                return (
                  <div className="schedule-duration-grid">
                    <InputNumber
                      key={`${row.id}-${value}`}
                      size="small"
                      min={1}
                      disabled={row.status !== 'PENDING' || Boolean(row.startedAt)}
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
                      style={{ width: 80 }}
                    />
                    <span className="schedule-duration-actual" title={actualDuration}>
                      {actualDuration}
                    </span>
                  </div>
                );
              },
            },
            {
              title: '操作',
              width: 110,
              render: (_, row: ScheduleMatch) => (
                <Space><Button size="small" icon={<EditOutlined />} disabled={row.status !== 'PENDING' || Boolean(row.startedAt)} onClick={() => openEdit(row)} aria-label="调整场地">调整</Button>{row.scheduleLocked && row.status === 'PENDING' && <Popconfirm title="取消人工固定？团体赛将同时取消整场未开始子项的固定。" onConfirm={() => unlock(row)}><Button size="small">解锁</Button></Popconfirm>}</Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="自动排程"
        okText="预览排程"
        cancelText="取消"
        confirmLoading={scheduleBusy}
        open={autoModalOpen}
        onCancel={() => setAutoModalOpen(false)}
        onOk={() => autoForm.submit()}
        destroyOnHidden
        width={640}
      >
        <Form
          form={autoForm}
          layout="vertical"
          onFinish={autoSchedule}
          initialValues={{
            startAt: defaultAutoStart(selectedTournament),
            dailyEndTime: dailyTimeValue(selectedTournament?.dailyEndTime),
            hasBreakPeriods: false,
            breakPeriods: [{ startTime: dailyTimeValue('12:00'), durationMinutes: 60 }],
            matchMinutes: selectedTournament?.defaultMatchMinutes ?? 45,
            breakMinutes: selectedTournament?.breakMinutes ?? 10,
          }}
        >
          <Form.Item name="startAt" label="首日开始时间" rules={[{ required: true, message: '请选择首日开始时间' }]}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="dailyEndTime"
            label="每日结束时间"
            dependencies={['startAt']}
            rules={[
              { required: true, message: '请选择每日结束时间' },
              ({ getFieldValue }) => ({
                validator(_, value: Dayjs | undefined) {
                  const startAt: Dayjs | undefined = getFieldValue('startAt');
                  if (!value || !startAt) return Promise.resolve();
                  const startMinutes = startAt.hour() * 60 + startAt.minute();
                  const endMinutes = value.hour() * 60 + value.minute();
                  return endMinutes > startMinutes
                    ? Promise.resolve()
                    : Promise.reject(new Error('每日结束时间必须晚于开始时间'));
                },
              }),
            ]}
          >
            <TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} />
          </Form.Item>
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: -12, marginBottom: 16 }}>
            第一天排不完时，会按相同的每日起止时间自动续排到第二天及后续日期。
          </Typography.Text>
          <Form.Item name="hasBreakPeriods" label="是否安排中途休息" valuePropName="checked">
            <Switch checkedChildren="安排" unCheckedChildren="不安排" />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.hasBreakPeriods !== current.hasBreakPeriods}>
            {({ getFieldValue }) =>
              getFieldValue('hasBreakPeriods') ? (
                <Form.List
                  name="breakPeriods"
                  rules={[
                    {
                      validator(_, value) {
                        return value?.length
                          ? Promise.resolve()
                          : Promise.reject(new Error('请至少添加一个休息时段'));
                      },
                    },
                  ]}
                >
                  {(fields, { add, remove }, { errors }) => (
                    <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
                      {fields.map(({ key, ...field }, index) => (
                        <Space key={key} align="baseline" style={{ display: 'flex' }}>
                          <Form.Item
                            {...field}
                            name={[field.name, 'startTime']}
                            label={index === 0 ? '休息开始' : undefined}
                            rules={[{ required: true, message: '请选择休息开始时间' }]}
                            style={{ flex: 1, marginBottom: 0 }}
                          >
                            <TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} />
                          </Form.Item>
                          <Form.Item
                            {...field}
                            name={[field.name, 'durationMinutes']}
                            label={index === 0 ? '休息时长' : undefined}
                            rules={[{ required: true, message: '请输入休息时长' }]}
                            style={{ width: 170, marginBottom: 0 }}
                          >
                            <InputNumber min={1} max={1440} addonAfter="分钟" style={{ width: '100%' }} />
                          </Form.Item>
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => remove(field.name)}
                            aria-label={`删除第 ${index + 1} 个休息时段`}
                          />
                        </Space>
                      ))}
                      <Button
                        type="dashed"
                        icon={<PlusOutlined />}
                        onClick={() => add({ startTime: dailyTimeValue(fields.length ? '18:00' : '12:00'), durationMinutes: 60 })}
                        block
                      >
                        添加休息时段（如午休、晚餐）
                      </Button>
                      <Form.ErrorList errors={errors} />
                    </Space>
                  )}
                </Form.List>
              ) : null
            }
          </Form.Item>
          <Form.Item name="scheduleStage" label="排程范围" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'all', label: '全部场次' },
                { value: 'second', label: '仅第二阶段', disabled: !canScheduleSecondStage },
              ]}
            />
          </Form.Item>
          <Form.Item name="overrideMatchMinutes" valuePropName="checked"><Checkbox>统一覆盖未固定比赛的预估时长（否则保留各场时长）</Checkbox></Form.Item>
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
              options={[...new Set(events.map(item => item.type))].map(type => ({ value: type, label: EVENT_TYPE_LABELS[type] ?? type }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal confirmLoading={scheduleBusy} title="手动调整场地与时间" okText="保存排程" cancelText="取消" open={Boolean(editingMatch)} onCancel={() => { manualVersion.current += 1; setEditingMatch(null); }} onOk={() => editForm.submit()} destroyOnHidden>
        <Form form={editForm} layout="vertical" onFinish={updateMatchSchedule} onValuesChange={() => { setManualPreview(null); manualVersion.current += 1; }}>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            {editingMatch?.teamMatchId
              ? '场地统一应用于本场团体对阵全部未开始子项。时间为第一个未开始子项的开始时间，后续子项顺延；预估时长仅修改当前子项。已开赛后保持原场地。'
              : '场地与时间留空表示不变更；预估时长可独立修改而不影响其他字段。'}
          </Typography.Text>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => <Alert type="info" style={{ marginBottom: 12 }} title={`${editingMatch?.groupName ?? ''} · ${editingMatch?.venueName ?? '未分配场地'} → ${activeVenues.find(v => v.id === getFieldValue('venueId'))?.name ?? editingMatch?.venueName ?? '未分配场地'}`} description={`原时间：${formatTime(editingMatch?.scheduledAt)}；调整后：${getFieldValue('scheduledAt')?.format('YYYY-MM-DD HH:mm') ?? '保持原时间'}`} />}
          </Form.Item>
          <Form.Item name="venueId" label="场地">
            <Select allowClear options={activeVenues.map(venue => {
              const info = manualPreview?.venues.find(v => v.id === venue.id);
              const inGroup = !editingMatch?.allowedVenueIds || editingMatch.allowedVenueIds.includes(venue.id);
              return { value: venue.id, label: `${venue.name} · ${inGroup ? '组别可用' : '组别范围外'}${info ? ` · ${info.available ? '空闲' : '不可用'}` : ''}` };
            })} />
          </Form.Item>
          <Form.Item name="scheduledAt" label="比赛时间">
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Space wrap style={{ marginBottom: 12 }}><Button loading={scheduleBusy} onClick={() => previewManual()}>检查场地与时间</Button><Button loading={scheduleBusy} onClick={() => previewManual(true)}>查找最近可用时间</Button></Space>
          <Form.Item name="scheduleLocked" valuePropName="checked"><Checkbox>保留人工安排，重新自动排程时固定场地和时间</Checkbox></Form.Item>
          <Form.Item name="allowOutsideGroup" valuePropName="checked"><Checkbox>允许本场临时借用组别范围外的场地</Checkbox></Form.Item>
          <Typography.Paragraph type="secondary">临时借场仅影响本场比赛，不修改组别规则。保存成功后大屏和裁判端同步更新。</Typography.Paragraph>
          {manualPreview && <Alert style={{ marginBottom: 12 }} type={manualPreview.conflicts.length ? 'error' : manualPreview.outsideGroup ? 'warning' : 'success'} showIcon title={manualPreview.conflicts[0]?.message ?? (manualPreview.outsideGroup ? '本次涉及组别范围外场地，请确认临时借场' : '场地与时间检查通过')} description={manualPreview.changes.map(c => `${c.venueName ?? '待排场地'} · ${c.scheduledAtLocal ?? '时间未定'}`).join('；')} />}
          <Form.Item name="durationMinutes" label="预估时长（分钟）" rules={[{ required: true, message: '请输入预估时长' }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title="自动排程预览" open={Boolean(autoPreview)} onCancel={() => { setAutoPreview(null); setAutoModalOpen(true); }} onOk={applyAutoSchedule} okText="应用排程并同步大屏" cancelText="返回调整" confirmLoading={scheduleBusy} width={1050}>
        {autoPreview && <>
          <Alert showIcon type={autoPreview.unscheduled.length ? 'warning' : 'success'} title={`本次安排 ${autoPreview.scheduledCount} 场，保留人工固定 ${autoPreview.preservedCount} 场，未排入 ${autoPreview.unscheduled.length} 场`} description="预览尚未保存。应用后，后台、公开赛程、裁判端和赛事大屏同步更新；结束时间为估算值。" style={{ marginBottom: 12 }} />
          <Table rowKey="groupId" size="small" dataSource={autoPreview.groups} pagination={false} columns={[
            { title: '组别', dataIndex: 'name' }, { title: '允许场地', render: (_, r) => r.restrictVenues ? r.venueIds.map(id => configuredVenues.find(v => v.id === id)?.name ?? '已删除').join('、') : '全部启用场地' },
            { title: '已排', dataIndex: 'scheduled' }, { title: '未排', dataIndex: 'unscheduled' }, { title: '预计结束', render: (_, r) => formatTime(r.estimatedEnd) },
          ]} />
          {autoPreview.unscheduled.length > 0 && <Alert type="warning" title="未排入的比赛" description={<div style={{ maxHeight: 180, overflow: 'auto' }}>{autoPreview.unscheduled.map(r => {
            const match = autoPreview.matches.find(m => m.id === r.matchId);
            return <div key={r.matchId}>{match?.groupName} · {match?.eventTypeLabel} · {match?.round} 第{match?.matchNo}场：{r.reason}</div>;
          })}</div>} style={{ marginBlock: 12 }} />}
          <Table rowKey="id" size="small" dataSource={autoPreview.matches} pagination={{ pageSize: 8 }} columns={[
            { title: '组别', dataIndex: 'groupName' }, { title: '项目', dataIndex: 'eventTypeLabel' },
            { title: '对阵', render: (_, m) => m.teamMatchId ? `${m.team1Name ?? '待定'} VS ${m.team2Name ?? '待定'}` : `${sideName(m.side1)} VS ${sideName(m.side2)}` },
            { title: '场地', render: (_, m) => m.venueId ? configuredVenues.find(v => v.id === m.venueId)?.name : '待排程' },
            { title: '时间', render: (_, m) => formatTime(m.scheduledAt) }, { title: '固定', render: (_, m) => m.scheduleLocked ? '人工固定' : '—' },
          ]} />
        </>}
      </Modal>
      <Modal title="最近 50 条排程调整记录" open={logs !== null} onCancel={() => setLogs(null)} footer={null} width={850}>
        <Table rowKey="id" dataSource={logs ?? []} pagination={{ pageSize: 10 }} columns={[
          { title: '时间', render: (_, r) => formatTime(r.createdAt) },
          { title: '操作', render: (_, r) => ({ AUTO: '自动排程', MANUAL: '人工调整', CLEAR: '清空排程', GROUP_VENUES: '组别场地配置' }[r.action] ?? r.action) },
          { title: '操作人', dataIndex: 'actorName' },
        ]} expandable={{ expandedRowRender: r => <div style={{ maxHeight: 320, overflow: 'auto' }}><Typography.Text strong>调整前</Typography.Text><pre>{logDescription(r.before)}</pre><Typography.Text strong>调整后</Typography.Text><pre>{logDescription(r.after)}</pre></div> }} />
      </Modal>
    </Space>
  );
}
