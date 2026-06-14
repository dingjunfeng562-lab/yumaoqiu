'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Button, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { AuditOutlined, DownloadOutlined, RollbackOutlined, StopOutlined, UsergroupAddOutlined } from '@ant-design/icons';
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
  const id = params?.id;
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [eventName, setEventName] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchEventId, setBatchEventId] = useState<string>();
  const [batchText, setBatchText] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);

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

  async function removePlayer(record: Player) {
    if (!token) return;
    try {
      if (record.competitionRegistrationId) {
        await apiFetch(`/admin/competition-registrations/${record.competitionRegistrationId}/remove`, {
          method: 'PATCH',
          token,
        });
      } else {
        await apiFetch(`/admin/competitions/${id}/players/${record.id}/remove`, {
          method: 'PATCH',
          token,
        });
      }
      message.success('已移除该报名');
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '移除失败');
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
      width: 120,
      render: (_: unknown, record: Player) => (
        <Popconfirm title="确认移除该报名？" onConfirm={() => removePlayer(record)}>
          <Button size="small" danger icon={<StopOutlined />}>移除</Button>
        </Popconfirm>
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
          <Button
            type="primary"
            icon={<UsergroupAddOutlined />}
            onClick={openBatchModal}
            disabled={!competition?.eventOptions?.length}
          >
            批量新增
          </Button>
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
    </div>
  );
}
