'use client';

import { TEAM_SCORING_OPTIONS, TEAM_APPEARANCE_OPTIONS } from '@/components/TeamCompetitionFields';
import { useCurrentAccess } from '@/lib/use-current-role';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  TimePicker,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import type { FormInstance, MenuProps, UploadFile, UploadProps } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  MoreOutlined,
  PlusOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  UndoOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { RichTextEditor } from '@/components/RichTextEditor';
import { RegistrationQrModal, qrUsability, type RegistrationQrTarget } from '@/components/admin/RegistrationQrModal';
import {
  GroupConfigFields,
  groupPayload,
  groupToFormValues,
  isStudentGroup,
  newGroupValues,
  type GroupFormValues,
  type GroupSource,
} from '@/components/admin/GroupConfigFields';
import dayjs, { Dayjs } from 'dayjs';
import locale from 'antd/locale/zh_CN';
import 'dayjs/locale/zh-cn';

const API_BASE = process.env.NEXT_PUBLIC_API_URL!;
const API_ORIGIN = API_BASE.replace(/\/api$/, '');

const EVENT_OPTIONS = [
  { label: '男单', value: 'MENS_SINGLES' },
  { label: '女单', value: 'WOMENS_SINGLES' },
  { label: '男双', value: 'MENS_DOUBLES' },
  { label: '女双', value: 'WOMENS_DOUBLES' },
  { label: '混双', value: 'MIXED_DOUBLES' },
] as const;

const EVENT_LABELS = Object.fromEntries(EVENT_OPTIONS.map((item) => [item.value, item.label]));
const DEFAULT_EVENT_ORDER = EVENT_OPTIONS.map((item) => item.value);

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  REGISTRATION_NOT_STARTED: { label: '筹备中', color: 'default' },
  REGISTRATION_OPEN: { label: '报名中', color: 'orange' },
  REGISTRATION_CLOSED: { label: '抽签中', color: 'purple' },
  ONGOING: { label: '比赛中', color: 'green' },
  FINISHED: { label: '已结束', color: 'blue' },
};
const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

type EventType = (typeof EVENT_OPTIONS)[number]['value'];
type EntrantType = 'SCHOOL' | 'SOCIAL';
type FieldState = 'required' | 'optional' | 'hidden';

// 赛事表单只配置默认学生组的字段；其它组别在「组别设置」里各自配置。
type RegistrationFieldRules = {
  SCHOOL: {
    studentId: FieldState;
    college: FieldState;
    majorGrade: FieldState;
  };
};

const DEFAULT_FIELD_RULES: RegistrationFieldRules = {
  SCHOOL: { studentId: 'required', college: 'required', majorGrade: 'optional' },
};

interface Tournament {
  id: string;
  name: string;
  edition: number;
  organizer?: string | null;
  subtitle?: string | null;
  coverImageUrl?: string | null;
  location?: string | null;
  projectText?: string | null;
  registrationStartDate?: string | null;
  registrationEndDate?: string | null;
  description?: string | null;
  registrationNotice?: string | null;
  maxRegistrationEvents: number;
  allowCrossEventRegistration: boolean;
  needsRegistrationReview: boolean;
  defaultMatchMinutes: number;
  breakMinutes: number;
  dailyStartTime: string;
  dailyEndTime: string;
  status: string;
  startDate: string;
  endDate: string;
  isArchived: boolean;
  isPublished: boolean;
  showOnHome: boolean;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedById?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  rejectReason?: string | null;
  events: Array<{ id: string; type: EventType; groupId?: string | null; entrantType?: EntrantType; groupLabel?: string | null }>;
  registrationFieldRules?: RegistrationFieldRules | null;
  allowSchoolRegistration?: boolean;
  schoolRegistrationCode?: string | null;
  schoolRegistrationCodeEnabled?: boolean;
  // 赛事报名码：一个赛事一个码，扫码后报名人自己选组别。
  registrationCode?: string | null;
  registrationCodeEnabled?: boolean;
  registrationGroups?: Array<{
    id: string;
    name: string;
    legacyType?: EntrantType | null;
    enabled: boolean;
    registrationCode?: string | null;
    registrationCodeEnabled: boolean;
    _count?: { events: number };
  }>;
  venues: Array<{ id: string; name: string; isActive: boolean; sortOrder: number }>;
  teamCompetitions: Array<{
    id: string;
    entrantType?: EntrantType;
    groupId?: string | null;
    winThreshold: number;
    maxPlayerAppearances: number;
    playAllMatches: boolean;
    scoringRule: string;
    scoringMode: string;
    items: Array<{ eventType: EventType; sortOrder: number }>;
  }>;
  _count?: { events: number };
}

type TournamentFormValues = {
  name: string;
  organizer: string;
  subtitle?: string;
  coverImageUrl?: string;
  location?: string;
  showOnHome?: boolean;
  status?: string;
  startDate: Dayjs;
  endDate: Dayjs;
  description?: string;
  eventTypes: EventType[];
  registrationFieldRules: RegistrationFieldRules;
  includeTeamCompetition: boolean;
  teamWinThreshold: 2 | 3;
  teamEventTypes: EventType[];
  teamMaxPlayerAppearances: number;
  teamPlayAllMatches: boolean;
  teamScoringRule: string;
  teamScoringMode: string;
  maxRegistrationEvents: number;
  allowCrossEventRegistration: boolean;
  registrationStartDate: Dayjs;
  registrationEndDate: Dayjs;
  needsRegistrationReview: boolean;
  registrationNotice?: string;
  venueNames: Array<{ name: string }>;
  // 参赛组别：每个组别依次是 组别和年龄 → 比赛项目 → 报名字段 → 报名设置，学生组也是其中一个组别。
  groups?: GroupFormValues[];
  defaultMatchMinutes: number;
  breakMinutes: number;
  dailyTimes: [Dayjs, Dayjs];
};

function eventLabel(type: EventType) {
  return EVENT_LABELS[type] ?? type;
}

function sortEventTypes(types: EventType[]) {
  return [...types].sort((a, b) => DEFAULT_EVENT_ORDER.indexOf(a) - DEFAULT_EVENT_ORDER.indexOf(b));
}

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? { label: status, color: 'default' };
}

function disabledPastDate(current: Dayjs) {
  return current && current < dayjs().startOf('day');
}

function moveItem<T>(items: T[], from: number, to: number) {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// 列表里用紧凑写法（2026.11.06 – 11.08），完整日期放在 tooltip 里。
function dateRangeText(start: string, end: string) {
  const startAt = dayjs(start);
  const endAt = dayjs(end);
  if (!startAt.isValid() || !endAt.isValid()) return '-';
  if (startAt.isSame(endAt, 'day')) return startAt.format('YYYY.MM.DD');
  return `${startAt.format('YYYY.MM.DD')} – ${endAt.format(
    startAt.year() === endAt.year() ? 'MM.DD' : 'YYYY.MM.DD',
  )}`;
}

/** 列表「项目」列：按组别分行，组名取组别设置里的名称。 */
function eventGroups(record: Tournament): Array<{ key: string; label: string; types: EventType[] }> {
  const groups = record.registrationGroups ?? [];
  const schoolId = groups.find((group) => group.legacyType === 'SCHOOL')?.id ?? `${record.id}_SCHOOL`;
  const rows = new Map<string, { key: string; label: string; types: EventType[] }>();
  for (const group of groups) rows.set(group.id, { key: group.id, label: group.name, types: [] });
  for (const event of record.events) {
    // 没有组别 ID 的旧单项都属于默认学生组。
    const key = event.groupId ?? schoolId;
    if (!rows.has(key)) rows.set(key, { key, label: event.groupLabel || '学生组', types: [] });
    rows.get(key)!.types.push(event.type);
  }
  return [...rows.values()]
    .filter((row) => row.types.length)
    .map((row) => ({ ...row, types: sortEventTypes(row.types) }));
}

/** 有没有开放报名、且配了项目的组别。 */
function hasOpenGroup(record: Tournament) {
  const groups = record.registrationGroups ?? [];
  return groups.length
    ? groups.some((group) => group.enabled && (group._count?.events ?? 0) > 0)
    : record.allowSchoolRegistration !== false && record.events.length > 0;
}

function qrTargetFor(record: Tournament): RegistrationQrTarget {
  return {
    tournamentId: record.id,
    tournamentName: record.name,
    code: record.registrationCode ?? '',
    ...qrUsability({
      archived: record.isArchived,
      published: record.isPublished && record.approvalStatus === 'APPROVED',
      groupOpen: hasOpenGroup(record),
      codeEnabled: record.registrationCodeEnabled !== false,
    }),
  };
}

const CELL_TEXT: React.CSSProperties = { fontSize: 12, lineHeight: '20px' };

// 团体赛选项暂时从「比赛项目」里移除，代码保留；改为 true 即恢复学生组团体赛设置。
const SHOW_TEAM_COMPETITION_OPTION = false;

/** 组别卡片标题：组别序号、名称，以及按是否收集学号自动判断的「学生 / 第三方」。 */
function GroupCardTitle({ form, index }: { form: FormInstance<TournamentFormValues>; index: number }) {
  const name = Form.useWatch(['groups', index, 'name'], form) as string | undefined;
  const fieldRules = Form.useWatch(['groups', index, 'fieldRules'], form) as GroupFormValues['fieldRules'] | undefined;
  const legacy = Form.useWatch(['groups', index, 'legacy'], form) as boolean | undefined;
  const student = isStudentGroup({ legacy, fieldRules });
  return (
    <Space size={6}>
      <span>{`组别 ${index + 1}`}{name?.trim() ? ` · ${name.trim()}` : ''}</span>
      <Tag color={student ? 'geekblue' : 'orange'} style={{ marginInlineEnd: 0 }}>{student ? '学生' : '第三方'}</Tag>
    </Space>
  );
}

const ROOT_ROLE = 'ROOT';

const APPROVAL_META: Record<
  'PENDING' | 'APPROVED' | 'REJECTED',
  { label: string; color: string }
> = {
  PENDING: { label: '待审核', color: 'gold' },
  APPROVED: { label: '已通过审核', color: 'green' },
  REJECTED: { label: '已驳回', color: 'red' },
};

export default function TournamentsPage() {
  const { data: session } = useSession();
  const access = useCurrentAccess();
  const token = session?.user?.accessToken as string | undefined;
  const sessionRole = (session?.user as { role?: string } | undefined)?.role;

  // 从 /auth/me 拉取最新的角色与权限，这样即使缓存的会话 JWT 还写着 ADMIN，
  // 角色和权限变更也能立刻生效。
  const [liveRole, setLiveRole] = useState<string | undefined>(sessionRole);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<{ role?: string }>('/auth/me', { token })
      .then((me) => {
        if (!cancelled && me?.role) setLiveRole(me.role);
      })
      .catch(() => {
        /* 拉取失败时退回会话里的角色 */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const role = liveRole ?? sessionRole;
  const isRoot = access.can('TOURNAMENT_ADMIN');
  const isSuperAdmin = access.can('TOURNAMENT_ADMIN');
  const currentUserId = session?.user?.id;

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tournament | null>(null);
  const [form] = Form.useForm<TournamentFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [coverFileList, setCoverFileList] = useState<UploadFile[]>([]);
  const [reviewTarget, setReviewTarget] = useState<Tournament | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState('');
  const [codeUpdatingKey, setCodeUpdatingKey] = useState('');
  const [qrTarget, setQrTarget] = useState<RegistrationQrTarget | null>(null);
  // 编辑赛事时已保存的组别 ID（用来判断哪些被移除）、加载状态，以及没开设的默认学生组（「添加学生组」时复用）。
  const [editingGroupIds, setEditingGroupIds] = useState<string[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [uPickerKey, setUPickerKey] = useState(0);
  const [hiddenLegacyGroup, setHiddenLegacyGroup] = useState<GroupSource | null>(null);

  const eventTypes = Form.useWatch('eventTypes', form) ?? [];
  const includeTeamCompetition = Form.useWatch('includeTeamCompetition', form);
  const teamWinThreshold = Form.useWatch('teamWinThreshold', form) ?? 2;
  const teamEventTypes = Form.useWatch('teamEventTypes', form) ?? [];
  const allowCrossEventRegistration = Form.useWatch('allowCrossEventRegistration', form);
  const startDate = Form.useWatch('startDate', form);
  // 组别年龄的参照日期默认取赛事开始日。
  const groupRefDate = startDate ? startDate.format('YYYY-MM-DD') : undefined;

  const availableTeamOptions = useMemo(
    () => EVENT_OPTIONS.filter((item) => eventTypes.includes(item.value)),
    [eventTypes],
  );

  const fetchTournaments = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<Tournament[]>('/tournaments', { token });
      setTournaments(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载赛事失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setLoading(true);
        return apiFetch<Tournament[]>('/tournaments', { token });
      })
      .then((data) => {
        if (!cancelled) setTournaments(data);
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '加载赛事失败'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (allowCrossEventRegistration === false) {
      form.setFieldValue('maxRegistrationEvents', 1);
    }
  }, [allowCrossEventRegistration, form]);

  useEffect(() => {
    const selected = teamEventTypes.filter((type) => eventTypes.includes(type));
    if (selected.length !== teamEventTypes.length) {
      form.setFieldValue('teamEventTypes', selected);
    }
  }, [eventTypes, form, teamEventTypes]);

  useEffect(() => {
    const requiredCount = teamWinThreshold === 3 ? 5 : 3;
    if (includeTeamCompetition && teamWinThreshold === 3 && eventTypes.length === 5 && teamEventTypes.length !== 5) {
      form.setFieldValue('teamEventTypes', sortEventTypes(eventTypes));
    }
    if (includeTeamCompetition && teamEventTypes.length > requiredCount) {
      form.setFieldValue('teamEventTypes', teamEventTypes.slice(0, requiredCount));
    }
  }, [eventTypes, form, includeTeamCompetition, teamEventTypes, teamWinThreshold]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setCoverFileList([]);
    form.resetFields();
    form.setFieldsValue({
      showOnHome: true,
      status: 'REGISTRATION_NOT_STARTED',
      // 学生组默认不开；需要时点「添加学生组」，和其它组别一样设置。
      groups: [],
      eventTypes: [],
      registrationFieldRules: DEFAULT_FIELD_RULES,
      includeTeamCompetition: false,
      teamWinThreshold: 2,
      teamEventTypes: [],
      teamMaxPlayerAppearances: 2,
      teamPlayAllMatches: false,
      teamScoringRule: 'TWENTYONE_BO3',
      teamScoringMode: 'CAPPED_30',
      maxRegistrationEvents: 2,
      allowCrossEventRegistration: true,
      needsRegistrationReview: true,
      venueNames: [{ name: '1 号场' }],
      defaultMatchMinutes: 45,
      breakMinutes: 10,
      dailyTimes: [dayjs('09:00', 'HH:mm'), dayjs('18:00', 'HH:mm')],
    });
    setEditingGroupIds([]);
    setHiddenLegacyGroup(null);
    setModalOpen(true);
  }, [form]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') !== '1') return;
    const timer = window.setTimeout(openCreate, 0);
    return () => window.clearTimeout(timer);
  }, [openCreate]);

  const openEdit = useCallback((tournament: Tournament) => {
    setEditing(tournament);
    setCoverFileList(
      tournament.coverImageUrl
        ? [
            {
              uid: tournament.coverImageUrl,
              name: '当前封面',
              status: 'done',
              url: `${API_ORIGIN}${tournament.coverImageUrl}`,
            },
          ]
        : [],
    );

    const teamCompetition = tournament.teamCompetitions.find(
      (item) => (!item.entrantType || item.entrantType === 'SCHOOL') && (!item.groupId || item.groupId === `${tournament.id}_SCHOOL`),
    );
    form.setFieldsValue({
      name: tournament.name,
      organizer: tournament.organizer ?? '',
      subtitle: tournament.subtitle ?? undefined,
      coverImageUrl: tournament.coverImageUrl ?? undefined,
      location: tournament.location ?? undefined,
      showOnHome: tournament.showOnHome,
      status: tournament.status,
      startDate: dayjs(tournament.startDate),
      endDate: dayjs(tournament.endDate),
      description: tournament.description ?? undefined,
      eventTypes: sortEventTypes(
        tournament.events
          .filter((event) => (!event.entrantType || event.entrantType === 'SCHOOL') && (!event.groupId || event.groupId === `${tournament.id}_SCHOOL`))
          .map((event) => event.type),
      ),
      registrationFieldRules: tournament.registrationFieldRules ?? DEFAULT_FIELD_RULES,
      includeTeamCompetition: Boolean(teamCompetition),
      teamWinThreshold: (teamCompetition?.winThreshold as 2 | 3 | undefined) ?? 2,
      teamEventTypes: [...(teamCompetition?.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map(item => item.eventType),
      teamMaxPlayerAppearances: teamCompetition?.maxPlayerAppearances ?? 2,
      teamPlayAllMatches: teamCompetition?.playAllMatches ?? false,
      teamScoringRule: teamCompetition?.scoringRule ?? 'TWENTYONE_BO3',
      teamScoringMode: teamCompetition?.scoringMode ?? 'CAPPED_30',
      maxRegistrationEvents: tournament.allowCrossEventRegistration ? tournament.maxRegistrationEvents : 1,
      allowCrossEventRegistration: tournament.allowCrossEventRegistration,
      registrationStartDate: tournament.registrationStartDate ? dayjs(tournament.registrationStartDate) : undefined,
      registrationEndDate: tournament.registrationEndDate ? dayjs(tournament.registrationEndDate) : undefined,
      needsRegistrationReview: tournament.needsRegistrationReview,
      registrationNotice: tournament.registrationNotice ?? undefined,
      venueNames: tournament.venues.length
        ? tournament.venues.filter((venue) => venue.isActive).map((venue) => ({ name: venue.name }))
        : [{ name: '1 号场' }],
      defaultMatchMinutes: tournament.defaultMatchMinutes,
      breakMinutes: tournament.breakMinutes,
      dailyTimes: [
        dayjs(tournament.dailyStartTime || '09:00', 'HH:mm'),
        dayjs(tournament.dailyEndTime || '18:00', 'HH:mm'),
      ],
      groups: [],
    });
    setEditingGroupIds([]);
    setHiddenLegacyGroup(null);
    setModalOpen(true);
    // 组别从组别接口读取，和赛事一起编辑、一起保存。没开设（没有项目）的默认学生组不显示。
    setGroupsLoading(true);
    const refDate = dayjs(tournament.startDate).format('YYYY-MM-DD');
    apiFetch<GroupSource[]>(`/admin/competitions/${tournament.id}/groups`, { token })
      .then((list) => {
        const shown = list.filter((group) => !group.legacyType || group.events.length > 0);
        form.setFieldValue('groups', shown.map((group) => groupToFormValues(group, refDate)));
        setEditingGroupIds(shown.map((group) => group.id));
        setHiddenLegacyGroup(list.find((group) => group.legacyType && group.events.length === 0) ?? null);
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '组别读取失败'))
      .finally(() => setGroupsLoading(false));
  }, [form, token]);

  /** 「添加学生组」：编辑时如果有没开设的默认学生组，就把它重新加回来（不能再建一个同名组）。 */
  function studentPresetValues(): GroupFormValues {
    const current: GroupFormValues[] = form.getFieldValue('groups') ?? [];
    if (hiddenLegacyGroup && !current.some((group) => group.id === hiddenLegacyGroup.id)) {
      return { ...groupToFormValues(hiddenLegacyGroup, groupRefDate), enabled: true, eventTypes: [] };
    }
    return newGroupValues(groupRefDate, { kind: 'STUDENT' });
  }

  // 从「场地排程 → 编辑赛程设置」跳转过来时，直接打开对应赛事的编辑弹窗，
  // 而不是停在赛事列表让用户自己再找一次。
  useEffect(() => {
    if (!tournaments.length) return;
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('edit');
    if (!editId) return;
    const target = tournaments.find((item) => item.id === editId);
    if (!target) return;
    if (target.isArchived) {
      message.warning('该赛事已归档，无法编辑');
      const url = new URL(window.location.href);
      url.searchParams.delete('edit');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      return;
    }
    // 与「新建赛事」入口保持一致，把打开弹窗放到下一个宏任务里，避免在 effect 中同步更新表单状态。
    const timer = window.setTimeout(() => {
      openEdit(target);
      // 打开后移除查询参数，关闭弹窗再刷新不会重复打开。
      const url = new URL(window.location.href);
      url.searchParams.delete('edit');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openEdit, tournaments]);

  const uploadProps: UploadProps = {
    action: `${API_BASE}/tournaments/upload-cover`,
    name: 'file',
    accept: 'image/jpeg,image/png',
    listType: 'picture-card',
    maxCount: 1,
    fileList: coverFileList,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    beforeUpload(file) {
      const isValidType = file.type === 'image/jpeg' || file.type === 'image/png';
      if (!isValidType) {
        message.error('仅支持 jpg / png 图片');
        return false;
      }
      const isSmallEnough = file.size / 1024 / 1024 < 2;
      if (!isSmallEnough) {
        message.error('图片需小于 2MB');
        return false;
      }
      return true;
    },
    onChange(info) {
      setCoverFileList(info.fileList);
      if (info.file.status === 'done') {
        const url = info.file.response?.url;
        if (url) {
          form.setFieldValue('coverImageUrl', url);
          message.success('封面上传成功');
        } else {
          message.error('上传成功但未返回图片地址');
        }
      }
      if (info.file.status === 'error') {
        const errorMsg = info.file.response?.message || info.file.error?.message || '封面上传失败';
        message.error(errorMsg);
        console.error('Upload error:', info.file.response, info.file.error);
      }
    },
    onRemove() {
      form.setFieldValue('coverImageUrl', undefined);
      return true;
    },
  };

  async function submitValues(values: TournamentFormValues) {
    const venueNames = values.venueNames.map((item) => item.name?.trim()).filter(Boolean);
    const groups: GroupFormValues[] = values.groups ?? [];
    const groupPayloads = groups.map((group) => groupPayload(group));
    const common = {
      name: values.name.trim(),
      organizer: values.organizer.trim(),
      subtitle: values.subtitle?.trim() || undefined,
      coverImageUrl: values.coverImageUrl,
      location: values.location?.trim() || undefined,
      showOnHome: isSuperAdmin ? Boolean(values.showOnHome) : undefined,
      status: isSuperAdmin ? values.status : undefined,
      startDate: values.startDate.startOf('day').toISOString(),
      endDate: values.endDate.endOf('day').toISOString(),
      description: values.description?.trim() || undefined,
      rules: values.description?.trim() || undefined,
      maxRegistrationEvents: values.allowCrossEventRegistration ? Number(values.maxRegistrationEvents) : 1,
      allowCrossEventRegistration: Boolean(values.allowCrossEventRegistration),
      registrationStartDate: values.registrationStartDate.toISOString(),
      registrationEndDate: values.registrationEndDate.toISOString(),
      needsRegistrationReview: Boolean(values.needsRegistrationReview),
      registrationNotice: values.registrationNotice?.trim() || undefined,
      venueNames,
      defaultMatchMinutes: Number(values.defaultMatchMinutes),
      breakMinutes: Number(values.breakMinutes),
      dailyStartTime: values.dailyTimes[0].format('HH:mm'),
      dailyEndTime: values.dailyTimes[1].format('HH:mm'),
      projectText: groupPayloads
        .flatMap((group) => group.eventTypes.map((type) => `${group.name}·${eventLabel(type as EventType)}`))
        .join(' / '),
      // 团体赛选项暂时隐藏，新建赛事只有单项赛。
      formatText: '单项赛',
    };

    setSubmitting(true);
    try {
      if (!editing) {
        // 所有组别（包括学生组）都作为组别随赛事一起创建；不再有单独的「学生组单项」。
        await apiFetch('/tournaments', {
          method: 'POST',
          token,
          body: JSON.stringify({ ...common, eventTypes: [], schoolEventTypes: [], includeTeamCompetition: false, customGroups: groupPayloads }),
        });
        message.success('赛事已创建');
        setModalOpen(false);
        await fetchTournaments();
        return;
      }

      // 编辑：赛事和组别一起保存。不传单项和团体赛参数，已有的学生组单项、团体赛不受影响。
      await apiFetch(`/tournaments/${editing.id}`, { method: 'PATCH', token, body: JSON.stringify(common) });
      const base = `/admin/competitions/${editing.id}/groups`;
      const savedIds = new Set(editingGroupIds);
      const keptIds = new Set(groups.map((group) => group.id).filter(Boolean));
      const failures: string[] = [];
      const reason = (error: unknown) => (error instanceof Error ? error.message : '保存失败');
      // 先删、再改、再加，避免改名或新增时和要删的组别撞名。
      for (const id of editingGroupIds.filter((groupId) => !keptIds.has(groupId))) {
        try {
          await apiFetch(`${base}/${id}`, { method: 'DELETE', token });
          savedIds.delete(id);
        } catch (error) {
          failures.push(reason(error));
        }
      }
      for (const [index, group] of groups.entries()) {
        if (!group.id) continue;
        try {
          await apiFetch(`${base}/${group.id}`, { method: 'PATCH', token, body: JSON.stringify(groupPayloads[index]) });
        } catch (error) {
          failures.push(`「${group.name}」：${reason(error)}`);
        }
      }
      for (const [index, group] of groups.entries()) {
        if (group.id) continue;
        try {
          const created = await apiFetch<{ id: string }>(base, { method: 'POST', token, body: JSON.stringify(groupPayloads[index]) });
          // 记下新建组别的 ID：保存失败重试时不会重复创建。
          form.setFieldValue(['groups', index, 'id'], created.id);
          savedIds.add(created.id);
        } catch (error) {
          failures.push(`「${group.name}」：${reason(error)}`);
        }
      }
      setEditingGroupIds([...savedIds]);
      await fetchTournaments();
      if (failures.length) {
        // 保留弹窗和已填写的内容，改好后可以再次保存。
        Modal.error({ title: '赛事已保存，但部分组别没有保存', content: failures.join('；'), okText: '知道了' });
        return;
      }
      message.success('赛事已更新');
      setModalOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        Modal.confirm({
          title: '确认修改赛事配置？',
          content: '组别会和赛事一起保存。如果赛事已经开始报名或已抽签，修改组别、项目、报名上限或场地可能影响已有数据；已有报名或比赛数据的组别不能删除。',
          okText: '确认修改',
          cancelText: '取消',
          onOk: () => submitValues(values).catch((error) => {
            message.error(error instanceof Error ? error.message : '操作失败');
          }),
        });
        return;
      }
      await submitValues(values);
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/tournaments/${id}`, { method: 'DELETE', token });
      message.success('赛事已删除');
      fetchTournaments();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await apiFetch(`/tournaments/${id}/archive`, { method: 'PATCH', token });
      message.success('赛事已归档');
      fetchTournaments();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '归档失败');
    }
  };

  const handleRestore = async (id: string) => {
    if (!isRoot) return;
    try {
      await apiFetch(`/tournaments/${id}/restore`, { method: 'PATCH', token });
      message.success('赛事已恢复');
      await fetchTournaments();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '恢复失败');
    }
  };

  const handleStatusChange = async (record: Tournament, status: string) => {
    if (!isSuperAdmin || status === record.status) return;
    setStatusUpdatingId(record.id);
    try {
      await apiFetch(`/tournaments/${record.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ status }),
      });
      message.success(`赛事状态已更新为${statusLabel(status).label}`);
      await fetchTournaments();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新赛事状态失败');
    } finally {
      setStatusUpdatingId('');
    }
  };

  const handleApprove = async (record: Tournament) => {
    if (!isSuperAdmin) {
      message.error('仅超级管理员可审核赛事');
      return;
    }
    try {
      await apiFetch(`/tournaments/${record.id}/approve`, { method: 'POST', token });
      message.success(`已通过审核:${record.name}`);
      fetchTournaments();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '审核失败');
    }
  };

  const openReject = (record: Tournament) => {
    if (!isSuperAdmin) {
      message.error('仅超级管理员可审核赛事');
      return;
    }
    setReviewTarget(record);
    setReviewReason('');
  };

  const handleReject = async () => {
    if (!reviewTarget) return;
    setReviewBusy(true);
    try {
      await apiFetch(`/tournaments/${reviewTarget.id}/reject`, {
        method: 'POST',
        token,
        body: JSON.stringify({ reason: reviewReason.trim() || '未通过审核' }),
      });
      message.success(`已驳回:${reviewTarget.name}`);
      setReviewTarget(null);
      setReviewReason('');
      fetchTournaments();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '驳回失败');
    } finally {
      setReviewBusy(false);
    }
  };

  function regenerateRegistrationCode(record: Tournament) {
    const action = record.registrationCode ? '重新生成' : '生成';
    Modal.confirm({
      title: `${action}「${record.name}」的报名码？`,
      content: record.registrationCode ? '旧报名码和旧二维码会立即失效，已提交的报名不受影响。' : '一个赛事一个报名码，报名人扫码后自己选组别。',
      okText: action,
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await apiFetch<{ code: string }>(`/admin/competitions/${record.id}/registration-code/regenerate`, { method: 'POST', token });
          message.success(`新报名码：${result.code}`);
          await fetchTournaments();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '报名码生成失败');
        }
      },
    });
  }

  async function toggleRegistrationCode(record: Tournament) {
    const enabled = record.registrationCodeEnabled === false;
    setCodeUpdatingKey(record.id);
    try {
      await apiFetch(`/admin/competitions/${record.id}/registration-code`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ enabled }),
      });
      message.success(`报名码已${enabled ? '启用' : '停用'}`);
      await fetchTournaments();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '报名码状态修改失败');
    } finally {
      setCodeUpdatingKey('');
    }
  }


  // 「归档 / 恢复 / 删除」放在每行的「更多」里，避免操作列被四五个按钮挤满。
  function rowMenuItems(record: Tournament): NonNullable<MenuProps['items']> {
    const items: NonNullable<MenuProps['items']> = [];
    if (record.isArchived) {
      if (isRoot) items.push({ key: 'restore', icon: <UndoOutlined />, label: '恢复赛事' });
    } else if (isSuperAdmin) {
      items.push({ key: 'archive', icon: <InboxOutlined />, label: '归档赛事' });
    }
    if (isSuperAdmin || (currentUserId && record.submittedById === currentUserId)) {
      if (items.length) items.push({ type: 'divider' });
      items.push({ key: 'delete', icon: <DeleteOutlined />, label: '删除赛事', danger: true });
    }
    return items;
  }

  function handleRowMenu(record: Tournament, key: string) {
    if (key === 'archive') {
      Modal.confirm({
        title: '归档后不建议继续编辑，确认归档？',
        okText: '归档',
        cancelText: '取消',
        onOk: () => handleArchive(record.id),
      });
      return;
    }
    if (key === 'restore') {
      Modal.confirm({
        title: '确认恢复该归档赛事？',
        content: '恢复后该赛事会重新出现在赛事配置和赛事管理中。',
        okText: '恢复',
        cancelText: '取消',
        onOk: () => handleRestore(record.id),
      });
      return;
    }
    if (key === 'delete') {
      Modal.confirm({
        title: isSuperAdmin ? '确认删除？此操作不可恢复' : '确认删除你创建的赛事？删除后不可恢复',
        content: '赛事的单项、报名、抽签、比赛和图片数据会一并删除。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => handleDelete(record.id),
      });
    }
  }

  const columns = [
    {
      title: '赛事',
      key: 'name',
      width: 275,
      render: (_: unknown, record: Tournament) => {
        const venueCount = record.venues.filter((venue) => venue.isActive).length;
        const meta = [
          dateRangeText(record.startDate, record.endDate),
          venueCount ? `${venueCount} 片场地` : '未配置场地',
          record.organizer || null,
        ]
          .filter(Boolean)
          .join(' · ');
        const metaTooltip = [
          `时间：${dayjs(record.startDate).format('YYYY年MM月DD日')} - ${dayjs(record.endDate).format('YYYY年MM月DD日')}`,
          `场地：${venueCount ? `${venueCount} 片（已启用）` : '未配置'}`,
          `主办：${record.organizer || '-'}`,
        ].join('\n');
        const showTags =
          record.approvalStatus !== 'APPROVED' || record.isArchived || record.showOnHome;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <Typography.Text strong ellipsis={{ tooltip: record.name }} style={{ fontSize: 13 }}>
              {record.name}
            </Typography.Text>
            <Typography.Text
              type="secondary"
              ellipsis={{ tooltip: metaTooltip }}
              style={{ fontSize: 12 }}
            >
              {meta}
            </Typography.Text>
            {showTags ? (
              <Space size={4} wrap style={{ marginTop: 2 }}>
                {record.approvalStatus !== 'APPROVED' ? (
                  <Tooltip
                    title={
                      record.approvalStatus === 'REJECTED' && record.rejectReason
                        ? `驳回原因：${record.rejectReason}`
                        : undefined
                    }
                  >
                    <Tag
                      color={(APPROVAL_META[record.approvalStatus] ?? APPROVAL_META.PENDING).color}
                      style={{ marginInlineEnd: 0 }}
                    >
                      {(APPROVAL_META[record.approvalStatus] ?? APPROVAL_META.PENDING).label}
                    </Tag>
                  </Tooltip>
                ) : null}
                {record.isArchived ? <Tag style={{ marginInlineEnd: 0 }}>已归档</Tag> : null}
                {record.showOnHome ? (
                  <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                    首页展示
                  </Tag>
                ) : null}
              </Space>
            ) : null}
          </div>
        );
      },
    },
    {
      title: '项目',
      key: 'events',
      width: 205,
      render: (_: unknown, record: Tournament) => {
        const rows = eventGroups(record);
        if (!rows.length) {
          return (
            <Typography.Text type="secondary" style={CELL_TEXT}>
              -
            </Typography.Text>
          );
        }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {rows.map((row) => (
              <div key={row.key} style={{ display: 'flex', gap: 6 }}>
                <span style={{ ...CELL_TEXT, flex: 'none', maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#94a3b8' }} title={row.label}>{row.label}</span>
                <span style={{ ...CELL_TEXT, color: '#334155' }}>
                  {row.types.map((type) => eventLabel(type)).join('·')}
                </span>
              </div>
            ))}
          </div>
        );
      },
    },
    {
      title: '报名码',
      key: 'registrationCode',
      width: 230,
      render: (_: unknown, record: Tournament) => {
        const code = record.registrationCode;
        const enabled = record.registrationCodeEnabled !== false;
        const busy = codeUpdatingKey === record.id;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
              {code ? (
                <Typography.Text code copyable={{ text: code }} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {code}
                </Typography.Text>
              ) : (
                <Tooltip title="尚未生成报名码，点击右侧按钮生成">
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>未生成</Typography.Text>
                </Tooltip>
              )}
            </span>
            {code ? (
              <>
                <Tooltip title={enabled ? '报名码启用中，点击停用' : '报名码已停用，点击启用'}>
                  <Switch
                    size="small"
                    checked={enabled}
                    loading={busy}
                    checkedChildren="启用"
                    unCheckedChildren="停用"
                    onChange={() => void toggleRegistrationCode(record)}
                  />
                </Tooltip>
                <Tooltip title="查看、下载报名二维码（扫码后选择组别报名）">
                  <Button type="text" size="small" icon={<QrcodeOutlined />} onClick={() => setQrTarget(qrTargetFor(record))} />
                </Tooltip>
              </>
            ) : null}
            <Tooltip title={code ? '重新生成报名码' : '生成报名码'}>
              <Button type="text" size="small" icon={<ReloadOutlined />} loading={busy} onClick={() => regenerateRegistrationCode(record)} />
            </Tooltip>
          </div>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      width: 135,
      render: (_: unknown, record: Tournament) => {
        if (isSuperAdmin && !record.isArchived) {
          return (
            <Select
              size="small"
              value={record.status}
              options={STATUS_OPTIONS}
              style={{ width: 110 }}
              loading={statusUpdatingId === record.id}
              onChange={(status) => handleStatusChange(record, status)}
            />
          );
        }
        const meta = statusLabel(record.status);
        return (
          <Tag color={record.isArchived ? 'default' : meta.color}>
            {record.isArchived ? '已归档' : meta.label}
          </Tag>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 250,
      render: (_: unknown, record: Tournament) => {
        const canApprove =
          isSuperAdmin && record.approvalStatus !== 'APPROVED' && !record.isArchived;
        const menuItems = rowMenuItems(record);
        return (
          <Space size={6} wrap>
            {canApprove ? (
              <>
                <Popconfirm
                  title="确认通过审核?通过后将自动公开赛事"
                  onConfirm={() => handleApprove(record)}
                >
                  <Button type="primary" size="small">
                    通过审核
                  </Button>
                </Popconfirm>
                <Button size="small" onClick={() => openReject(record)}>
                  驳回
                </Button>
              </>
            ) : null}
            <Button
              icon={<EditOutlined />}
              size="small"
              onClick={() => openEdit(record)}
              disabled={record.isArchived}
            >
              编辑
            </Button>
            <Button size="small" href={`/nicaiyixiahh/tournaments/${record.id}/groups`}>组别设置</Button>
            {menuItems.length ? (
              <Dropdown
                trigger={['click']}
                placement="bottomRight"
                menu={{ items: menuItems, onClick: ({ key }) => handleRowMenu(record, key) }}
              >
                <Tooltip title="更多操作">
                  <Button icon={<MoreOutlined />} size="small" />
                </Tooltip>
              </Dropdown>
            ) : null}
          </Space>
        );
      },
    },
  ];

  const pendingCount = tournaments.filter((t) => t.approvalStatus === 'PENDING' && !t.isArchived).length;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            赛事配置
          </Typography.Title>
          <Typography.Text type="secondary">
            创建赛事,新建后须由<strong>超级管理员</strong>审核通过,赛事才会向公众发布。管理员可删除自己创建的赛事。
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建赛事
        </Button>
      </div>

      {pendingCount > 0 ? (
        <Alert
          type={isSuperAdmin ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            isSuperAdmin
              ? `有 ${pendingCount} 个赛事等待你审核`
              : `已提交 ${pendingCount} 个赛事,等待超级管理员审核`
          }
          description={
            isSuperAdmin
              ? '点击表格中"通过审核"或"驳回"即可处理。通过后赛事会自动对公众发布。'
              : '审核通过前,该赛事不会在前台赛事列表中显示。'
          }
        />
      ) : null}

      <Card
        style={{ marginTop: 4 }}
        title={<span style={{ fontSize: 14, fontWeight: 700 }}>赛事列表</span>}
        extra={<Typography.Text type="secondary">共 {tournaments.length} 个赛事</Typography.Text>}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={tournaments}
          loading={loading}
          pagination={false}
          scroll={{ x: 1155 }}
          tableLayout="fixed"
          size="middle"
          locale={{ emptyText: '暂无赛事，点击右上角「新建赛事」开始配置' }}
        />
      </Card>

      <Modal
        title={editing ? '编辑赛事' : '新建赛事'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        width={980}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Card title="基础信息" size="small" style={{ marginBottom: 16 }}>
            <Form.Item name="coverImageUrl" hidden>
              <Input />
            </Form.Item>
            <Form.Item
              name="name"
              label="赛事名称"
              rules={[
                { required: true, whitespace: true, message: '请输入赛事名称' },
                { min: 2, max: 30, message: '赛事名称长度需为 2-30 字' },
              ]}
            >
              <Input placeholder="羽你相遇，新火相传" maxLength={30} showCount />
            </Form.Item>
            <Form.Item name="organizer" label="主办单位" rules={[{ required: true, whitespace: true, message: '请输入主办单位' }]}>
              <Input placeholder="XX 大学羽毛球协会" />
            </Form.Item>
            <Form.Item name="location" label="比赛地点">
              <Input placeholder="例如：XX 大学体育馆" maxLength={80} />
            </Form.Item>
            <Space style={{ display: 'flex' }} align="start">
              <Form.Item
                name="startDate"
                label="赛事开始日期"
                rules={[{ required: true, message: '请选择赛事开始日期' }]}
                style={{ flex: 1 }}
              >
                <DatePicker format="YYYY年MM月DD日" locale={locale.DatePicker} style={{ width: '100%' }} disabledDate={editing ? undefined : disabledPastDate} />
              </Form.Item>
              <Form.Item
                name="endDate"
                label="赛事结束日期"
                dependencies={['startDate']}
                rules={[
                  { required: true, message: '请选择赛事结束日期' },
                  ({ getFieldValue }) => ({
                    validator(_, value: Dayjs) {
                      const start = getFieldValue('startDate');
                      if (!value || !start || value.isSame(start, 'day') || value.isAfter(start, 'day')) return Promise.resolve();
                      return Promise.reject(new Error('赛事结束日期必须不早于开始日期'));
                    },
                  }),
                ]}
                style={{ flex: 1 }}
              >
                <DatePicker
                  format="YYYY年MM月DD日"
                  locale={locale.DatePicker}
                  style={{ width: '100%' }}
                  disabledDate={(current) => (!editing && disabledPastDate(current)) || (startDate && current.isBefore(startDate, 'day'))}
                />
              </Form.Item>
            </Space>
            <Form.Item label="赛事 LOGO / 封面图">
              <Upload {...uploadProps}>
                {coverFileList.length >= 1 ? null : (
                  <button type="button" style={{ border: 0, background: 'none' }}>
                    <UploadOutlined />
                    <div style={{ marginTop: 8 }}>上传封面</div>
                  </button>
                )}
              </Upload>
            </Form.Item>
            <Form.Item name="description" label="赛事简介">
              <RichTextEditor
                placeholder="显示在公开页，可填写赛事背景、参赛对象、奖励设置等内容；选中文字可设置样式，也可插入图片"
                imageUploadUrl={`${API_BASE}/tournaments/upload-cover`}
                imageUploadHeaders={token ? { Authorization: `Bearer ${token}` } : undefined}
              />
            </Form.Item>
            {isSuperAdmin ? (
              <Form.Item name="showOnHome" label="首页展示" valuePropName="checked">
                <Switch checkedChildren="展示" unCheckedChildren="不展示" />
              </Form.Item>
            ) : null}
            {isSuperAdmin ? (
              <Form.Item name="status" label="赛事状态" rules={[{ required: true, message: '请选择赛事状态' }]}>
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            ) : null}
          </Card>

          <Card title="参赛组别与比赛项目" size="small" style={{ marginBottom: 16 }}>
            {/* 团体赛选项暂时隐藏（代码保留）：打开 SHOW_TEAM_COMPETITION_OPTION 即恢复。 */}
            {SHOW_TEAM_COMPETITION_OPTION && eventTypes.length > 0 && (
              <Form.Item name="includeTeamCompetition" label="是否包含学生组团体赛" valuePropName="checked">
                <Switch checkedChildren="是" unCheckedChildren="否" />
              </Form.Item>
            )}
            {SHOW_TEAM_COMPETITION_OPTION && includeTeamCompetition && eventTypes.length > 0 && (
              <>
                <Form.Item name="teamMaxPlayerAppearances" label="团体赛兼项规则" rules={[{ required: true }]} extra="按同一场团体对阵计算，下一轮重新计算。每队人数不限，不限制男女人数。">
                  <Select options={TEAM_APPEARANCE_OPTIONS} />
                </Form.Item>
                <Form.Item name="teamScoringRule" label="团体子项计分规则" rules={[{ required: true }]} extra="自定义分数和局数可在团体赛设置中调整。"><Select options={TEAM_SCORING_OPTIONS} /></Form.Item>
                <Form.Item name="teamPlayAllMatches" label="胜负确定后继续比赛" valuePropName="checked" extra="开启后打完剩余子项并保留比分；正式比分、胜次和净胜分只统计到先赢够场数时，补打不影响排名。关闭时达到胜场数即结束。抽签后开启可恢复尚未开赛的剩余子项（已生成淘汰赛时不恢复）。">
                  <Switch checkedChildren="继续比赛" unCheckedChildren="结束对阵" />
                </Form.Item>
                <Form.Item name="teamScoringMode" label="团体子项平分规则" rules={[{ required: true }]}><Select options={[{ value: 'CAPPED_30', label: '领先 2 分，封顶决胜' }, { value: 'STANDARD_GOLDEN', label: '目标分直接获胜（金球）' }]} /></Form.Item>
                <Form.Item
                  name="teamWinThreshold"
                  label="团体赛胜场规则"
                  rules={[{ required: true }]}
                  extra="团体赛单项只能从上方「包含的单项」中选择:3 项 2 胜需要至少 3 个单项,5 项 3 胜需要全部 5 个单项。"
                >
                  <Radio.Group
                    options={[
                      { label: '3 项 2 胜', value: 2, disabled: eventTypes.length < 3 },
                      { label: '5 项 3 胜', value: 3, disabled: eventTypes.length < 5 },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  name="teamEventTypes"
                  label="团体赛包含的单项"
                  dependencies={['eventTypes', 'teamWinThreshold']}
                  extra={teamWinThreshold === 3 ? '5 项 3 胜固定包含全部 5 个单项,无需手动勾选。' : undefined}
                  rules={[
                    {
                      validator(_, value: EventType[]) {
                        const requiredCount = teamWinThreshold === 3 ? 5 : 3;
                        if (availableTeamOptions.length < requiredCount) {
                          return Promise.reject(
                            new Error(
                              teamWinThreshold === 3
                                ? '「5 项 3 胜」需要赛事包含全部 5 个单项,请先补全「包含的单项」或改用 3 项 2 胜'
                                : '「3 项 2 胜」需要「包含的单项」中至少勾选 3 项',
                            ),
                          );
                        }
                        if (value?.length === requiredCount) return Promise.resolve();
                        return Promise.reject(new Error(`请选择 ${requiredCount} 个团体赛单项`));
                      },
                    },
                  ]}
                >
                  <Checkbox.Group
                    disabled={teamWinThreshold === 3}
                    options={availableTeamOptions as unknown as Array<{ label: string; value: string }>}
                  />
                </Form.Item>
                <Form.Item label="团体赛单项出场顺序">
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {teamEventTypes.map((type, index) => (
                      <Space key={type}>
                        <Tag>{index + 1}</Tag>
                        <Typography.Text style={{ width: 80 }}>{eventLabel(type)}</Typography.Text>
                        <Button
                          icon={<ArrowUpOutlined />}
                          size="small"
                          disabled={index === 0}
                          onClick={() => form.setFieldValue('teamEventTypes', moveItem(teamEventTypes, index, index - 1))}
                        />
                        <Button
                          icon={<ArrowDownOutlined />}
                          size="small"
                          disabled={index === teamEventTypes.length - 1}
                          onClick={() => form.setFieldValue('teamEventTypes', moveItem(teamEventTypes, index, index + 1))}
                        />
                      </Space>
                    ))}
                  </Space>
                </Form.Item>
              </>
            )}
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              每个组别依次设置：① 组别和年龄要求 → ② 比赛项目 → ③ 报名字段 → ④ 报名设置。一个赛事一个报名码，报名人扫码后自己选组别。各组可用场地在「场地排程」中分配。
            </Typography.Paragraph>
            <Form.List
              name="groups"
              rules={[{
                validator: async (_, groups?: GroupFormValues[]) => {
                  if (!groups?.length) throw new Error('请至少添加一个组别');
                },
              }]}
            >
              {(fields, { add, remove }, { errors }) => (
                <>
                  <Spin spinning={groupsLoading}>
                    {fields.map(({ key, name }) => (
                      <Card
                        key={key}
                        size="small"
                        title={<GroupCardTitle form={form} index={name} />}
                        style={{ marginBottom: 12 }}
                        extra={form.getFieldValue(['groups', name, 'locked']) ? (
                          <Tooltip title="本组已有报名，不能移除；可以在「报名设置」里关闭本组报名">
                            <Button type="text" danger disabled>移除</Button>
                          </Tooltip>
                        ) : (
                          <Button type="text" danger onClick={() => remove(name)}>移除</Button>
                        )}
                      >
                        <GroupConfigFields form={form} prefix={[name]} path={['groups', name]} refDate={groupRefDate} />
                      </Card>
                    ))}
                  </Spin>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <Button type="dashed" icon={<PlusOutlined />} disabled={fields.length >= 50} onClick={() => add(newGroupValues(groupRefDate))}>
                      添加组别
                    </Button>
                    <Button disabled={fields.length >= 50} onClick={() => add(studentPresetValues())}>添加学生组</Button>
                    {/* 选完即重新挂载，下拉框回到占位文字，可以连续添加多个 U 系列组别。 */}
                    <Select
                      key={uPickerKey}
                      placeholder="添加 U 系列组别"
                      style={{ width: 170 }}
                      disabled={fields.length >= 50}
                      options={Array.from({ length: 13 }, (_, index) => ({ value: index + 6, label: `U${index + 6}（未满 ${index + 7} 岁）` }))}
                      onChange={(age: number) => {
                        add(newGroupValues(groupRefDate, { kind: 'U', age }));
                        setUPickerKey((value) => value + 1);
                      }}
                    />
                  </Space>
                  <Form.ErrorList errors={errors} />
                </>
              )}
            </Form.List>
            <Space style={{ display: 'flex' }} align="start">
              <Form.Item name="allowCrossEventRegistration" label="是否允许跨项目报名" valuePropName="checked" style={{ flex: 1 }}>
                <Switch checkedChildren="允许" unCheckedChildren="不允许" />
              </Form.Item>
              <Form.Item name="maxRegistrationEvents" label="每人最多报名项目数" rules={[{ required: true }]} style={{ flex: 1 }}>
                <InputNumber min={1} max={5} disabled={allowCrossEventRegistration === false} style={{ width: '100%' }} />
              </Form.Item>
            </Space>
          </Card>

          <Card title="报名设置" size="small" style={{ marginBottom: 16 }}>
            <Space style={{ display: 'flex' }} align="start">
              <Form.Item
                name="registrationStartDate"
                label="报名开始时间"
                dependencies={['startDate']}
                rules={[
                  { required: true, message: '请选择报名开始时间' },
                  ({ getFieldValue }) => ({
                    validator(_, value: Dayjs) {
                      const competitionStart = getFieldValue('startDate') as Dayjs | undefined;
                      if (!value || !competitionStart || value.isBefore(competitionStart.startOf('day'))) return Promise.resolve();
                      return Promise.reject(new Error('报名开始时间必须早于赛事开始日期'));
                    },
                  }),
                ]}
                style={{ flex: 1 }}
              >
                <DatePicker showTime format="YYYY年MM月DD日 HH:mm" locale={locale.DatePicker} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                name="registrationEndDate"
                label="报名截止时间"
                dependencies={['registrationStartDate', 'startDate']}
                rules={[
                  { required: true, message: '请选择报名截止时间' },
                  ({ getFieldValue }) => ({
                    validator(_, value: Dayjs) {
                      const registerStart = getFieldValue('registrationStartDate');
                      const competitionStart = getFieldValue('startDate');
                      if (!value) return Promise.resolve();
                      if (registerStart && !value.isAfter(registerStart)) return Promise.reject(new Error('报名截止时间必须晚于报名开始时间'));
                      if (competitionStart && !value.isBefore(competitionStart)) return Promise.reject(new Error('报名截止时间必须早于赛事开始日期'));
                      return Promise.resolve();
                    },
                  }),
                ]}
                style={{ flex: 1 }}
              >
                <DatePicker showTime format="YYYY年MM月DD日 HH:mm" locale={locale.DatePicker} style={{ width: '100%' }} />
              </Form.Item>
            </Space>
            <Form.Item name="needsRegistrationReview" label="是否需要审核" valuePropName="checked">
              <Switch checkedChildren="是" unCheckedChildren="否" />
            </Form.Item>
            <Form.Item name="registrationNotice" label="报名说明">
              <Input.TextArea rows={5} placeholder="显示在前台报名页顶部，可填写报名要求、材料说明或联系方式。" />
            </Form.Item>
          </Card>

          <Card title="场地与时间" size="small">
            <Form.List
              name="venueNames"
              rules={[
                {
                  validator(_, value) {
                    if (value?.some((item: { name?: string }) => item?.name?.trim())) return Promise.resolve();
                    return Promise.reject(new Error('请至少填写一个比赛场地'));
                  },
                },
              ]}
            >
              {(fields, { add, remove }, { errors }) => (
                <>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline" style={{ display: 'flex' }}>
                      <Form.Item
                        {...field}
                        name={[field.name, 'name']}
                        label={field.name === 0 ? '比赛场地' : ''}
                        rules={[{ required: true, whitespace: true, message: '请输入场地名称' }]}
                        style={{ flex: 1 }}
                      >
                        <Input placeholder="1 号场" />
                      </Form.Item>
                      <Button icon={<DeleteOutlined />} onClick={() => remove(field.name)} disabled={fields.length <= 1} />
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      const existing: Array<{ name?: string } | undefined> = form.getFieldValue('venueNames') ?? [];
                      const used = new Set(existing.map((item) => item?.name?.trim()).filter(Boolean));
                      let next = existing.length + 1;
                      while (used.has(`${next} 号场`)) next += 1;
                      add({ name: `${next} 号场` });
                    }}
                  >
                    添加场地
                  </Button>
                  <Form.ErrorList errors={errors} />
                </>
              )}
            </Form.List>
            <Space style={{ display: 'flex', marginTop: 16 }} align="start">
              <Form.Item name="defaultMatchMinutes" label="每场预估时长（分钟）" rules={[{ required: true }]} style={{ flex: 1 }}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="breakMinutes" label="场地间隔时间（分钟）" rules={[{ required: true }]} style={{ flex: 1 }}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Space>
            <Form.Item
              name="dailyTimes"
              label="每日比赛时段"
              rules={[
                { required: true, message: '请选择每日比赛时段' },
                {
                  validator(_, value: [Dayjs, Dayjs] | undefined) {
                    if (!value?.[0] || !value?.[1] || value[1].isAfter(value[0])) return Promise.resolve();
                    return Promise.reject(new Error('每日比赛结束时间必须晚于开始时间'));
                  },
                },
              ]}
            >
              <TimePicker.RangePicker format="HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          </Card>
        </Form>
      </Modal>

      <Modal
        title={reviewTarget ? `驳回赛事 · ${reviewTarget.name}` : '驳回赛事'}
        open={reviewTarget !== null}
        onCancel={() => setReviewTarget(null)}
        onOk={handleReject}
        okText="确认驳回"
        okButtonProps={{ danger: true, loading: reviewBusy }}
        cancelText="取消"
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          驳回后赛事将无法对公众发布。请填写驳回原因,方便提交者修改后再申请。
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          maxLength={200}
          showCount
          value={reviewReason}
          onChange={(event) => setReviewReason(event.target.value)}
          placeholder="例如:报名截止时间设置不合理 / 缺少场地信息..."
        />
      </Modal>

      <RegistrationQrModal target={qrTarget} onClose={() => setQrTarget(null)} />
    </div>
  );
}
