'use client';

import type { Key } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { AuditOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, RollbackOutlined, StopOutlined, UsergroupAddOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

type CompetitionEventOption = {
  id: string;
  type: string;
  label: string;
  isDouble: boolean;
};

type Competition = {
  id: string;
  title: string;
  eventOptions?: CompetitionEventOption[];
};

type Player = {
  id: string;
  competitionRegistrationId?: string | null;
  eventId?: string;
  email: string;
  name: string;
  primaryName?: string;
  teamName?: string | null;
  isTemporary?: boolean;
  partner?: {
    name: string;
    studentId?: string;
    genderLabel?: string;
    school?: string;
    className?: string;
    phone?: string;
  } | null;
  studentId: string;
  school?: string;
  className: string;
  phone: string;
  genderLabel: string;
  eventName: string;
  createdAt: string;
  statusLabel: string;
};

type BatchImportItem = {
  name: string;
  gender: 'MALE' | 'FEMALE';
  studentId: string;
  school: string;
  className: string;
  contact: string;
  teamName?: string;
  partnerName?: string;
  partnerGender?: 'MALE' | 'FEMALE';
  partnerStudentId?: string;
  partnerSchool?: string;
  partnerClassName?: string;
  partnerContact?: string;
};

type ParsedBatchRow = Partial<BatchImportItem> & {
  key: string;
  lineNumber: number;
  raw: string;
  error?: string;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function normalizeGenderValue(value?: string) {
  const normalized = value?.trim().toUpperCase();
  if (normalized === '男' || normalized === 'MALE' || normalized === 'M') return 'MALE';
  if (normalized === '女' || normalized === 'FEMALE' || normalized === 'F') return 'FEMALE';
  return null;
}

function genderText(value?: string) {
  if (value === 'MALE') return '男';
  if (value === 'FEMALE') return '女';
  return value || '-';
}

function genderLabelToValue(value?: string): 'MALE' | 'FEMALE' | undefined {
  if (value === '男' || value === 'MALE') return 'MALE';
  if (value === '女' || value === 'FEMALE') return 'FEMALE';
  return undefined;
}

type PlayerFormValues = {
  eventId: string;
  name: string;
  gender: 'MALE' | 'FEMALE';
  studentId: string;
  school: string;
  className: string;
  contact: string;
  teamName?: string;
  partnerName?: string;
  partnerGender?: 'MALE' | 'FEMALE';
  partnerStudentId?: string;
  partnerSchool?: string;
  partnerClassName?: string;
  partnerContact?: string;
};

const GENDER_OPTIONS = [
  { value: 'MALE', label: '男' },
  { value: 'FEMALE', label: '女' },
];

function normalizeRouteParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function splitClipboardLine(line: string) {
  return line
    .trim()
    .split(/[\s、，,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBatchRows(text: string, isDouble: boolean): ParsedBatchRow[] {
  const expectedCount = isDouble ? 13 : 6;
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim())
    .map(({ line, lineNumber }) => {
      const parts = splitClipboardLine(line);
      const base = { key: `${lineNumber}-${line}`, lineNumber, raw: line };
      if (parts.length !== expectedCount) {
        return {
          ...base,
          error: `需要 ${expectedCount} 个字段，当前 ${parts.length} 个`,
        };
      }

      if (!isDouble) {
        const [name, genderRaw, studentId, school, className, contact] = parts;
        const gender = normalizeGenderValue(genderRaw);
        if (!gender) return { ...base, name, studentId, school, className, contact, error: '性别需填写男或女' };
        return { ...base, name, gender, studentId, school, className, contact };
      }

      const [
        teamName,
        name,
        genderRaw,
        studentId,
        school,
        className,
        contact,
        partnerName,
        partnerGenderRaw,
        partnerStudentId,
        partnerSchool,
        partnerClassName,
        partnerContact,
      ] = parts;
      const gender = normalizeGenderValue(genderRaw);
      const partnerGender = normalizeGenderValue(partnerGenderRaw);
      if (!gender || !partnerGender) {
        return {
          ...base,
          teamName,
          name,
          studentId,
          school,
          className,
          contact,
          partnerName,
          partnerStudentId,
          partnerSchool,
          partnerClassName,
          partnerContact,
          error: '性别和搭档性别需填写男或女',
        };
      }
      return {
        ...base,
        teamName,
        name,
        gender,
        studentId,
        school,
        className,
        contact,
        partnerName,
        partnerGender,
        partnerStudentId,
        partnerSchool,
        partnerClassName,
        partnerContact,
      };
    });
}

export default function AdminCompetitionPlayersPage() {
  const params = useParams<{ id: string }>();
  const id = normalizeRouteParam(params?.id);
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const sessionRole = (session?.user as { role?: string } | undefined)?.role;
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
  // 参赛选手写操作:降权后的总管理员(SUPER_ADMIN)只读,仅管理员/超级管理员可增删改。
  const canManage = role === 'ADMIN' || role === 'ROOT';
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [eventName, setEventName] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchEventId, setBatchEventId] = useState<string>();
  const [batchText, setBatchText] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [form] = Form.useForm<PlayerFormValues>();
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Key[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const watchedFormEventId = Form.useWatch('eventId', form);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (eventName !== 'all') params.set('eventName', eventName);
    if (search.trim()) params.set('search', search.trim());
    const value = params.toString();
    return value ? `?${value}` : '';
  }, [eventName, search]);

  const eventOptions = useMemo(
    () =>
      competition?.eventOptions?.map((event) => ({
        value: event.id,
        label: event.label,
      })) ?? [],
    [competition],
  );
  const selectedBatchEvent = useMemo(
    () => competition?.eventOptions?.find((event) => event.id === batchEventId),
    [competition, batchEventId],
  );
  const formIsDouble = useMemo(
    () => Boolean(competition?.eventOptions?.find((event) => event.id === watchedFormEventId)?.isDouble),
    [competition, watchedFormEventId],
  );
  const parsedBatchRows = useMemo(
    () => parseBatchRows(batchText, Boolean(selectedBatchEvent?.isDouble)),
    [batchText, selectedBatchEvent?.isDouble],
  );
  const batchErrorCount = parsedBatchRows.filter((row) => row.error).length;

  const loadData = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const [competitionList, playerData] = await Promise.all([
        apiFetch<Competition[]>('/admin/competitions', { token }),
        apiFetch<Player[]>(`/admin/competitions/${id}/players${query}`, { token }),
      ]);
      setCompetition(competitionList.find((item) => item.id === id) ?? null);
      setPlayers(playerData);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '参赛选手列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, id, query]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setSelectedPlayerIds([]);
  }, [eventName, search]);

  useEffect(() => {
    if (!canManage) setSelectedPlayerIds([]);
  }, [canManage]);

  async function removePlayerRecord(record: Player) {
    if (!token || !id) return;
    if (record.competitionRegistrationId) {
      await apiFetch(`/admin/competition-registrations/${record.competitionRegistrationId}/remove`, {
        method: 'PATCH',
        token,
      });
      return;
    }
    await apiFetch(`/admin/competitions/${id}/players/${record.id}/remove`, {
      method: 'PATCH',
      token,
    });
  }

  async function removePlayer(record: Player) {
    if (!token) return;
    try {
      await removePlayerRecord(record);
      message.success('已移除该报名');
      setSelectedPlayerIds((current) => current.filter((key) => key !== record.id));
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '移除失败');
    }
  }

  async function removeSelectedPlayers() {
    if (!token || !id || !selectedPlayerIds.length) return;
    const selectedIdSet = new Set(selectedPlayerIds.map(String));
    const selectedPlayers = players.filter((player) => selectedIdSet.has(player.id));
    if (!selectedPlayers.length) {
      setSelectedPlayerIds([]);
      return;
    }

    setBulkDeleting(true);
    try {
      await Promise.all(selectedPlayers.map((player) => removePlayerRecord(player)));
      message.success(`已批量删除 ${selectedPlayers.length} 条参赛记录`);
      setSelectedPlayerIds([]);
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '批量删除失败');
      await loadData();
    } finally {
      setBulkDeleting(false);
    }
  }

  function openBatchModal() {
    const defaultEvent =
      competition?.eventOptions?.find((event) => event.label === eventName) ??
      competition?.eventOptions?.[0];
    setBatchEventId(defaultEvent?.id);
    setBatchModalOpen(true);
  }

  async function submitBatchPlayers() {
    if (!token || !id) return;
    if (!batchEventId) {
      message.warning('请选择参赛项目');
      return;
    }
    if (!parsedBatchRows.length) {
      message.warning('请先粘贴选手数据');
      return;
    }
    const firstError = parsedBatchRows.find((row) => row.error);
    if (firstError) {
      message.error(`第 ${firstError.lineNumber} 行：${firstError.error}`);
      return;
    }

    const playersPayload = parsedBatchRows.map((row) => ({
      name: row.name ?? '',
      gender: row.gender ?? 'MALE',
      studentId: row.studentId ?? '',
      school: row.school ?? '',
      className: row.className ?? '',
      contact: row.contact ?? '',
      teamName: row.teamName,
      partnerName: row.partnerName,
      partnerGender: row.partnerGender,
      partnerStudentId: row.partnerStudentId,
      partnerSchool: row.partnerSchool,
      partnerClassName: row.partnerClassName,
      partnerContact: row.partnerContact,
    }));

    setBatchSubmitting(true);
    try {
      const result = await apiFetch<{ createdCount: number }>(`/admin/competitions/${id}/players/batch`, {
        method: 'POST',
        body: JSON.stringify({ eventId: batchEventId, players: playersPayload }),
        token,
      });
      message.success(`已新增 ${result.createdCount} 条参赛记录`);
      setBatchModalOpen(false);
      setBatchText('');
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '批量新增失败');
    } finally {
      setBatchSubmitting(false);
    }
  }

  function openCreateModal() {
    if (!competition?.eventOptions?.length) {
      message.warning('当前赛事暂无参赛项目');
      return;
    }
    setEditingPlayer(null);
    const defaultEvent =
      competition.eventOptions.find((event) => event.label === eventName) ?? competition.eventOptions[0];
    form.resetFields();
    form.setFieldsValue({ eventId: defaultEvent?.id, gender: 'MALE' });
    setFormModalOpen(true);
  }

  function openEditModal(record: Player) {
    setEditingPlayer(record);
    form.resetFields();
    form.setFieldsValue({
      eventId: record.eventId,
      name: record.primaryName || record.name,
      gender: genderLabelToValue(record.genderLabel) ?? 'MALE',
      studentId: record.studentId,
      school: record.school ?? '',
      className: record.className,
      contact: record.phone,
      teamName: record.teamName ?? undefined,
      partnerName: record.partner?.name,
      partnerGender: genderLabelToValue(record.partner?.genderLabel),
      partnerStudentId: record.partner?.studentId,
      partnerSchool: record.partner?.school,
      partnerClassName: record.partner?.className,
      partnerContact: record.partner?.phone,
    });
    setFormModalOpen(true);
  }

  async function submitPlayerForm() {
    if (!token || !id) return;
    let values: PlayerFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const isDouble = Boolean(
      competition?.eventOptions?.find((event) => event.id === values.eventId)?.isDouble,
    );
    const payload: Record<string, string | undefined> = {
      eventId: values.eventId,
      name: values.name.trim(),
      gender: values.gender,
      studentId: values.studentId.trim(),
      school: values.school.trim(),
      className: values.className.trim(),
      contact: values.contact.trim(),
    };
    if (isDouble) {
      payload.teamName = values.teamName?.trim();
      payload.partnerName = values.partnerName?.trim();
      payload.partnerGender = values.partnerGender;
      payload.partnerStudentId = values.partnerStudentId?.trim();
      payload.partnerSchool = values.partnerSchool?.trim();
      payload.partnerClassName = values.partnerClassName?.trim();
      payload.partnerContact = values.partnerContact?.trim();
    }

    setFormSubmitting(true);
    try {
      if (editingPlayer) {
        await apiFetch(`/admin/competitions/${id}/players/${editingPlayer.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
          token,
        });
        message.success('已更新参赛选手信息');
      } else {
        await apiFetch(`/admin/competitions/${id}/players`, {
          method: 'POST',
          body: JSON.stringify(payload),
          token,
        });
        message.success('已新增参赛选手');
      }
      setFormModalOpen(false);
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setFormSubmitting(false);
    }
  }

  const columns = [
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      render: (value: string) => value || <Typography.Text type="secondary">临时录入</Typography.Text>,
    },
    {
      title: '队伍/姓名',
      key: 'name',
      width: 160,
      render: (_: unknown, record: Player) => (
        <Space direction="vertical" size={0}>
          {record.teamName ? (
            <Typography.Text strong>{record.teamName}</Typography.Text>
          ) : null}
          <Space size={4}>
            <Typography.Text type={record.teamName ? 'secondary' : undefined}>
              {record.primaryName || record.name}
            </Typography.Text>
            {record.isTemporary ? <Tag color="orange">临时</Tag> : null}
          </Space>
          {record.partner ? (
            <Typography.Text type="secondary">
              {record.partner.name}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '学号',
      key: 'studentId',
      width: 150,
      render: (_: unknown, record: Player) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.studentId || '-'}</Typography.Text>
          {record.partner ? (
            <Typography.Text type="secondary">{record.partner.studentId || '-'}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '学校',
      dataIndex: 'school',
      key: 'school',
      width: 180,
      render: (value: string | undefined, record: Player) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{value || '-'}</Typography.Text>
          {record.partner ? (
            <Typography.Text type="secondary">{record.partner.school || '-'}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '学院班级',
      key: 'className',
      width: 150,
      render: (_: unknown, record: Player) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.className || '-'}</Typography.Text>
          {record.partner ? (
            <Typography.Text type="secondary">{record.partner.className || '-'}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '联系电话',
      dataIndex: 'phone',
      key: 'phone',
      width: 140,
      render: (value: string | undefined, record: Player) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{value || '-'}</Typography.Text>
          {record.partner ? (
            <Typography.Text type="secondary">{record.partner.phone || '-'}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '性别',
      dataIndex: 'genderLabel',
      key: 'genderLabel',
      width: 70,
      render: (value: string | undefined, record: Player) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{value || '-'}</Typography.Text>
          {record.partner ? (
            <Typography.Text type="secondary">{record.partner.genderLabel || '-'}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '参赛项目',
      dataIndex: 'eventName',
      key: 'eventName',
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: '报名时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '审核状态',
      key: 'status',
      render: (_: unknown, record: Player) => <Tag color="green">{record.statusLabel}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      render: (_: unknown, record: Player) =>
        canManage ? (
          <Space>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)}>
              编辑
            </Button>
            <Popconfirm title="确认移除该报名？" onConfirm={() => removePlayer(record)}>
              <Button size="small" danger icon={<StopOutlined />}>移除</Button>
            </Popconfirm>
          </Space>
        ) : (
          <Typography.Text type="secondary">只读</Typography.Text>
        ),
    },
  ];

  const batchPreviewColumns = [
    { title: '行', dataIndex: 'lineNumber', key: 'lineNumber', width: 64 },
    {
      title: '队伍/姓名',
      key: 'name',
      render: (_: unknown, record: ParsedBatchRow) => (
        <Space direction="vertical" size={0}>
          {selectedBatchEvent?.isDouble ? (
            <Typography.Text strong>{record.teamName || '-'}</Typography.Text>
          ) : null}
          <Typography.Text>{record.name || '-'}</Typography.Text>
          {selectedBatchEvent?.isDouble ? (
            <Typography.Text type="secondary">{record.partnerName || '-'}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '性别',
      key: 'gender',
      width: 80,
      render: (_: unknown, record: ParsedBatchRow) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{genderText(record.gender)}</Typography.Text>
          {selectedBatchEvent?.isDouble ? (
            <Typography.Text type="secondary">{genderText(record.partnerGender)}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '学号',
      key: 'studentId',
      render: (_: unknown, record: ParsedBatchRow) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.studentId || '-'}</Typography.Text>
          {selectedBatchEvent?.isDouble ? (
            <Typography.Text type="secondary">{record.partnerStudentId || '-'}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '学校',
      key: 'school',
      width: 160,
      render: (_: unknown, record: ParsedBatchRow) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.school || '-'}</Typography.Text>
          {selectedBatchEvent?.isDouble ? (
            <Typography.Text type="secondary">{record.partnerSchool || '-'}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '学院班级',
      key: 'className',
      render: (_: unknown, record: ParsedBatchRow) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.className || '-'}</Typography.Text>
          {selectedBatchEvent?.isDouble ? (
            <Typography.Text type="secondary">{record.partnerClassName || '-'}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '联系方式',
      key: 'contact',
      render: (_: unknown, record: ParsedBatchRow) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.contact || '-'}</Typography.Text>
          {selectedBatchEvent?.isDouble ? (
            <Typography.Text type="secondary">{record.partnerContact || '-'}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 180,
      render: (_: unknown, record: ParsedBatchRow) =>
        record.error ? <Tag color="red">{record.error}</Tag> : <Tag color="green">可导入</Tag>,
    },
  ];

  const batchFormatText = selectedBatchEvent?.isDouble
    ? '双打：队伍名称、姓名、性别、学号、学校、学院班级、联系方式、搭档姓名、搭档性别、搭档学号、搭档学校、搭档学院班级、搭档联系方式'
    : '单打：姓名、性别、学号、学校、学院班级、联系方式';
  const rowSelection = canManage
    ? {
        selectedRowKeys: selectedPlayerIds,
        onChange: (keys: Key[]) => setSelectedPlayerIds(keys),
      }
    : undefined;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            参赛选手
          </Typography.Title>
          <Typography.Text type="secondary">
            {competition?.title ?? '当前赛事'}，这里只显示审核通过的报名记录。
          </Typography.Text>
        </div>
        <Space wrap>
          <Select
            value={eventName}
            onChange={setEventName}
            style={{ width: 180 }}
            options={[
              { value: 'all', label: '全部项目' },
              { value: '男子单打', label: '男子单打' },
              { value: '女子单打', label: '女子单打' },
              { value: '男子双打', label: '男子双打' },
              { value: '女子双打', label: '女子双打' },
              { value: '混合双打', label: '混合双打' },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="搜索邮箱、姓名、学号、学校"
            onSearch={setSearch}
            style={{ width: 260 }}
          />
          {canManage ? (
            <>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreateModal}
                disabled={!competition?.eventOptions?.length}
              >
                新增选手
              </Button>
              <Button
                icon={<UsergroupAddOutlined />}
                onClick={openBatchModal}
                disabled={!competition?.eventOptions?.length}
              >
                批量新增
              </Button>
              <Popconfirm
                title={`确认批量删除选中的 ${selectedPlayerIds.length} 条参赛记录？`}
                description="删除后这些报名会从参赛选手列表中移除。"
                okText="确认删除"
                cancelText="取消"
                okButtonProps={{ danger: true, loading: bulkDeleting }}
                onConfirm={removeSelectedPlayers}
                disabled={!selectedPlayerIds.length || bulkDeleting}
              >
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  disabled={!selectedPlayerIds.length || bulkDeleting}
                  loading={bulkDeleting}
                >
                  批量删除{selectedPlayerIds.length ? `（${selectedPlayerIds.length}）` : ''}
                </Button>
              </Popconfirm>
            </>
          ) : null}
          <Button icon={<DownloadOutlined />} onClick={() => message.info('导出按钮已预留，可在后续接入 Excel 导出。')}>
            导出
          </Button>
          <Button icon={<AuditOutlined />} onClick={() => router.push(`/admin/competitions/${id}/registrations`)}>
            报名审核
          </Button>
          <Button icon={<RollbackOutlined />} onClick={() => router.push('/admin/competitions')}>
            返回
          </Button>
        </Space>
      </div>
      <Table
        rowKey="id"
        rowSelection={rowSelection}
        columns={columns}
        dataSource={players}
        loading={loading}
        pagination={{ pageSize: 20 }}
      />
      <Modal
        title="批量新增参赛选手"
        open={batchModalOpen}
        onCancel={() => setBatchModalOpen(false)}
        onOk={submitBatchPlayers}
        okText={`新增 ${parsedBatchRows.length - batchErrorCount} 条`}
        okButtonProps={{ disabled: !parsedBatchRows.length || batchErrorCount > 0 }}
        confirmLoading={batchSubmitting}
        width={1100}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Select
            value={batchEventId}
            onChange={(value) => {
              setBatchEventId(value);
              setBatchText('');
            }}
            options={eventOptions}
            placeholder="选择参赛项目"
            style={{ width: 220 }}
          />
          <Alert
            type={batchErrorCount ? 'error' : 'info'}
            showIcon
            message={batchFormatText}
            description="每行一条记录，字段可用空格、顿号、逗号或制表符分隔。"
          />
          <Input.TextArea
            rows={8}
            value={batchText}
            onChange={(event) => setBatchText(event.target.value)}
            placeholder={
              selectedBatchEvent?.isDouble
                ? '例如：一队、张三、男、2024001、第一大学、计算机1班、13800000000、李四、男、2024002、第一大学、计算机1班、13900000000'
                : '例如：张三、男、2024001、第一大学、计算机1班、13800000000'
            }
          />
          <Table
            size="small"
            rowKey="key"
            columns={batchPreviewColumns}
            dataSource={parsedBatchRows}
            pagination={false}
            scroll={{ x: 980, y: 260 }}
          />
        </Space>
      </Modal>
      <Modal
        title={editingPlayer ? '编辑参赛选手' : '新增参赛选手'}
        open={formModalOpen}
        onCancel={() => setFormModalOpen(false)}
        onOk={submitPlayerForm}
        okText="保存"
        confirmLoading={formSubmitting}
        forceRender
        width={formIsDouble ? 720 : 480}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="参赛项目"
            name="eventId"
            rules={[{ required: true, message: '请选择参赛项目' }]}
          >
            <Select options={eventOptions} placeholder="选择参赛项目" />
          </Form.Item>
          <Typography.Text strong>{formIsDouble ? '队员一' : '选手信息'}</Typography.Text>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              columnGap: 12,
              marginTop: 8,
            }}
          >
            <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请填写姓名' }]}>
              <Input placeholder="姓名" />
            </Form.Item>
            <Form.Item label="性别" name="gender" rules={[{ required: true, message: '请选择性别' }]}>
              <Select options={GENDER_OPTIONS} placeholder="性别" />
            </Form.Item>
            <Form.Item label="学号" name="studentId" rules={[{ required: true, message: '请填写学号' }]}>
              <Input placeholder="学号" />
            </Form.Item>
            <Form.Item label="学校" name="school" rules={[{ required: true, message: '请填写学校' }]}>
              <Input placeholder="学校" />
            </Form.Item>
            <Form.Item label="学院班级" name="className" rules={[{ required: true, message: '请填写学院班级' }]}>
              <Input placeholder="学院班级" />
            </Form.Item>
            <Form.Item label="联系方式" name="contact" rules={[{ required: true, message: '请填写联系方式' }]}>
              <Input placeholder="联系方式" />
            </Form.Item>
          </div>
          {formIsDouble ? (
            <>
              <Form.Item
                label="队伍名称"
                name="teamName"
                rules={[{ required: true, message: '请填写队伍名称' }]}
              >
                <Input placeholder="队伍名称" />
              </Form.Item>
              <Typography.Text strong>队员二（搭档）</Typography.Text>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  columnGap: 12,
                  marginTop: 8,
                }}
              >
                <Form.Item
                  label="搭档姓名"
                  name="partnerName"
                  rules={[{ required: true, message: '请填写搭档姓名' }]}
                >
                  <Input placeholder="搭档姓名" />
                </Form.Item>
                <Form.Item
                  label="搭档性别"
                  name="partnerGender"
                  rules={[{ required: true, message: '请选择搭档性别' }]}
                >
                  <Select options={GENDER_OPTIONS} placeholder="搭档性别" />
                </Form.Item>
                <Form.Item
                  label="搭档学号"
                  name="partnerStudentId"
                  rules={[{ required: true, message: '请填写搭档学号' }]}
                >
                  <Input placeholder="搭档学号" />
                </Form.Item>
                <Form.Item
                  label="搭档学校"
                  name="partnerSchool"
                  rules={[{ required: true, message: '请填写搭档学校' }]}
                >
                  <Input placeholder="搭档学校" />
                </Form.Item>
                <Form.Item
                  label="搭档学院班级"
                  name="partnerClassName"
                  rules={[{ required: true, message: '请填写搭档学院班级' }]}
                >
                  <Input placeholder="搭档学院班级" />
                </Form.Item>
                <Form.Item
                  label="搭档联系方式"
                  name="partnerContact"
                  rules={[{ required: true, message: '请填写搭档联系方式' }]}
                >
                  <Input placeholder="搭档联系方式" />
                </Form.Item>
              </div>
            </>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}
