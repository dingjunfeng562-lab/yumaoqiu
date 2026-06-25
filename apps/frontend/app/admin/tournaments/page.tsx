'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  TimePicker,
  Typography,
  Upload,
  message,
} from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { RichTextEditor } from '@/components/RichTextEditor';
import dayjs, { Dayjs } from 'dayjs';

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
  events: Array<{ id: string; type: EventType }>;
  venues: Array<{ id: string; name: string; isActive: boolean; sortOrder: number }>;
  teamCompetitions: Array<{
    id: string;
    winThreshold: number;
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
  includeTeamCompetition: boolean;
  teamWinThreshold: 2 | 3;
  teamEventTypes: EventType[];
  maxRegistrationEvents: number;
  allowCrossEventRegistration: boolean;
  registrationStartDate: Dayjs;
  registrationEndDate: Dayjs;
  needsRegistrationReview: boolean;
  registrationNotice?: string;
  venueNames: Array<{ name: string }>;
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

const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

const APPROVAL_META: Record<
  'PENDING' | 'APPROVED' | 'REJECTED',
  { label: string; color: string }
> = {
  PENDING: { label: '待总管理员审核', color: 'gold' },
  APPROVED: { label: '已通过审核', color: 'green' },
  REJECTED: { label: '已驳回', color: 'red' },
};

export default function TournamentsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const sessionRole = (session?.user as { role?: string } | undefined)?.role;

  // Pull the live role from /auth/me so a promotion to SUPER_ADMIN takes
  // effect immediately even if the cached session JWT still shows ADMIN.
  const [liveRole, setLiveRole] = useState<string | undefined>(sessionRole);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<{ role?: string }>('/auth/me', { token })
      .then((me) => {
        if (!cancelled && me?.role) setLiveRole(me.role);
      })
      .catch(() => {
        /* fall back to session role */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const role = liveRole ?? sessionRole;
  const isSuperAdmin = role === SUPER_ADMIN_ROLE || role === 'ROOT';

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

  const eventTypes = Form.useWatch('eventTypes', form) ?? [];
  const includeTeamCompetition = Form.useWatch('includeTeamCompetition', form);
  const teamWinThreshold = Form.useWatch('teamWinThreshold', form) ?? 2;
  const teamEventTypes = Form.useWatch('teamEventTypes', form) ?? [];
  const allowCrossEventRegistration = Form.useWatch('allowCrossEventRegistration', form);
  const startDate = Form.useWatch('startDate', form);

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
    const selected = sortEventTypes(teamEventTypes.filter((type) => eventTypes.includes(type)));
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
      eventTypes: ['MENS_SINGLES', 'WOMENS_SINGLES'],
      includeTeamCompetition: false,
      teamWinThreshold: 2,
      teamEventTypes: [],
      maxRegistrationEvents: 2,
      allowCrossEventRegistration: true,
      needsRegistrationReview: true,
      venueNames: [{ name: '1 号场' }],
      defaultMatchMinutes: 45,
      breakMinutes: 10,
      dailyTimes: [dayjs('09:00', 'HH:mm'), dayjs('18:00', 'HH:mm')],
    });
    setModalOpen(true);
  }, [form]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') !== '1') return;
    const timer = window.setTimeout(openCreate, 0);
    return () => window.clearTimeout(timer);
  }, [openCreate]);

  const openEdit = (tournament: Tournament) => {
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

    const teamCompetition = tournament.teamCompetitions[0];
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
      eventTypes: sortEventTypes(tournament.events.map((event) => event.type)),
      includeTeamCompetition: Boolean(teamCompetition),
      teamWinThreshold: (teamCompetition?.winThreshold as 2 | 3 | undefined) ?? 2,
      teamEventTypes: sortEventTypes(teamCompetition?.items.map((item) => item.eventType) ?? []),
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
    });
    setModalOpen(true);
  };

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
      if (!isValidType) message.error('仅支持 jpg / png 图片');
      const isSmallEnough = file.size / 1024 / 1024 < 2;
      if (!isSmallEnough) message.error('图片需小于 2MB');
      return isValidType && isSmallEnough;
    },
    onChange(info) {
      setCoverFileList(info.fileList);
      if (info.file.status === 'done') {
        const url = info.file.response?.url;
        if (url) {
          form.setFieldValue('coverImageUrl', url);
          message.success('封面上传成功');
        }
      }
      if (info.file.status === 'error') message.error('封面上传失败');
    },
    onRemove() {
      form.setFieldValue('coverImageUrl', undefined);
      return true;
    },
  };

  async function submitValues(values: TournamentFormValues) {
    const venueNames = values.venueNames.map((item) => item.name?.trim()).filter(Boolean);
    const payload = {
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
      eventTypes: values.eventTypes,
      includeTeamCompetition: Boolean(values.includeTeamCompetition),
      teamWinThreshold: values.includeTeamCompetition ? values.teamWinThreshold : undefined,
      teamEventTypes: values.includeTeamCompetition ? values.teamEventTypes : [],
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
      projectText: values.eventTypes.map(eventLabel).join(' / '),
      formatText: values.includeTeamCompetition
        ? `单项赛 + 团体赛（${values.teamWinThreshold === 3 ? '5 项 3 胜' : '3 项 2 胜'}）`
        : '单项赛',
    };

    setSubmitting(true);
    try {
      if (editing) {
        await apiFetch(`/tournaments/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
          token,
        });
        message.success('赛事已更新');
      } else {
        await apiFetch('/tournaments', { method: 'POST', body: JSON.stringify(payload), token });
        message.success('赛事已创建');
      }
      setModalOpen(false);
      await fetchTournaments();
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
          content: '如果赛事已经开始报名或已抽签，修改单项、报名上限、团体赛或场地可能影响已有数据。',
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
      message.error('仅总管理员可审核赛事');
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
      message.error('仅总管理员可审核赛事');
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

  const columns = [
    {
      title: '赛事',
      key: 'name',
      render: (_: unknown, record: Tournament) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.name}</Typography.Text>
          <Typography.Text type="secondary">{record.organizer || '-'}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '时间',
      key: 'dates',
      render: (_: unknown, record: Tournament) =>
        `${dayjs(record.startDate).format('YYYY/MM/DD')} - ${dayjs(record.endDate).format('YYYY/MM/DD')}`,
    },
    {
      title: '项目',
      key: 'events',
      render: (_: unknown, record: Tournament) => record.events.map((event) => eventLabel(event.type)).join(' / ') || '-',
    },
    {
      title: '状态',
      key: 'status',
      render: (_: unknown, record: Tournament) => {
        const meta = statusLabel(record.status);
        if (isSuperAdmin && !record.isArchived) {
          return (
            <Space>
              <Select
                size="small"
                value={record.status}
                options={STATUS_OPTIONS}
                style={{ width: 120 }}
                loading={statusUpdatingId === record.id}
                onChange={(status) => handleStatusChange(record, status)}
              />
              {record.showOnHome && <Tag color="gold">首页展示</Tag>}
            </Space>
          );
        }
        return (
          <Space>
            <Tag color={meta.color}>{meta.label}</Tag>
            {record.showOnHome && <Tag color="gold">首页展示</Tag>}
            {record.isArchived && <Tag>已归档</Tag>}
          </Space>
        );
      },
    },
    {
      title: '审核',
      key: 'approval',
      width: 160,
      render: (_: unknown, record: Tournament) => {
        const meta = APPROVAL_META[record.approvalStatus] ?? APPROVAL_META.PENDING;
        return (
          <Space direction="vertical" size={2}>
            <Tag color={meta.color}>{meta.label}</Tag>
            {record.approvalStatus === 'REJECTED' && record.rejectReason ? (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {record.rejectReason}
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    { title: '场地', key: 'venues', render: (_: unknown, record: Tournament) => record.venues.filter((venue) => venue.isActive).length },
    {
      title: '操作',
      key: 'actions',
      width: 320,
      render: (_: unknown, record: Tournament) => (
        <Space wrap>
          {isSuperAdmin && record.approvalStatus !== 'APPROVED' && !record.isArchived ? (
            <>
              <Popconfirm title="确认通过审核?通过后将自动公开赛事" onConfirm={() => handleApprove(record)}>
                <Button type="primary" size="small">
                  通过审核
                </Button>
              </Popconfirm>
              <Button danger size="small" onClick={() => openReject(record)}>
                驳回
              </Button>
            </>
          ) : null}
          <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(record)} disabled={record.isArchived}>
            编辑
          </Button>
          {!record.isArchived && (
            <Popconfirm title="归档后不建议继续编辑，确认归档？" onConfirm={() => handleArchive(record.id)}>
              <Button icon={<InboxOutlined />} size="small">
                归档
              </Button>
            </Popconfirm>
          )}
          <Popconfirm title="确认删除？此操作不可恢复" onConfirm={() => handleDelete(record.id)}>
            <Button icon={<DeleteOutlined />} size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const pendingCount = tournaments.filter((t) => t.approvalStatus === 'PENDING' && !t.isArchived).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            赛事配置
          </Typography.Title>
          <Typography.Text type="secondary">
            创建赛事,新建后须由<strong>总管理员</strong>审核通过,赛事才会向公众发布。
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
              : `已提交 ${pendingCount} 个赛事,等待总管理员审核`
          }
          description={
            isSuperAdmin
              ? '点击表格中"通过审核"或"驳回"即可处理。通过后赛事会自动对公众发布。'
              : '审核通过前,该赛事不会在前台赛事列表中显示。'
          }
        />
      ) : null}

      <Table rowKey="id" columns={columns} dataSource={tournaments} loading={loading} pagination={false} />

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
                <DatePicker style={{ width: '100%' }} disabledDate={editing ? undefined : disabledPastDate} />
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

          <Card title="赛事内容设置" size="small" style={{ marginBottom: 16 }}>
            <Form.Item name="eventTypes" label="包含的单项" rules={[{ required: true, message: '请至少选择一个单项' }]}>
              <Checkbox.Group options={EVENT_OPTIONS as unknown as Array<{ label: string; value: string }>} />
            </Form.Item>
            <Form.Item name="includeTeamCompetition" label="是否包含团体赛" valuePropName="checked">
              <Switch checkedChildren="是" unCheckedChildren="否" />
            </Form.Item>
            {includeTeamCompetition && (
              <>
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
                <DatePicker showTime style={{ width: '100%' }} />
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
                <DatePicker showTime style={{ width: '100%' }} />
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
    </div>
  );
}
