'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  HistoryOutlined,
  ReloadOutlined,
  UndoOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { apiFetch } from '@/lib/api';
import {
  RegistrationEditModal,
  isEditDeadlinePassed,
  showRedrawPrompt,
  type EditableFieldRules,
  type RedrawEvent,
} from '@/components/admin/RegistrationEditModal';
import { useCurrentAccess } from '@/lib/use-current-role';
import { ENTRANT_LABELS, type EntrantType, type PaymentStatus, toFen, uploadUrl, yuan } from '@/lib/payments';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type Tournament = { id: string; name: string };

type Setting = {
  entrantType: EntrantType;
  groupId?: string | null;
  groupLabel?: string;
  enabled: boolean;
  singlesFee: number;
  doublesFee: number;
  teamFee: number;
  instructions: string | null;
  qrImageUrl: string | null;
};

type Row = {
  kind: 'EVENT' | 'TEAM';
  id: string;
  entrantType: EntrantType;
  groupId?: string | null;
  groupLabel?: string;
  itemId: string;
  itemName: string;
  name: string;
  contact: string;
  affiliation: string;
  members?: string;
  teamNotes?: string | null;
  amountDue: number;
  paymentStatus: PaymentStatus;
  paidAmount: number | null;
  paidAt: string | null;
  paymentNote: string | null;
  confirmedByName: string | null;
};

type Summary = {
  entrantType: EntrantType;
  groupId?: string | null;
  groupLabel?: string;
  enabled: boolean;
  total: number;
  paidCount: number;
  waivedCount: number;
  unpaidCount: number;
  paidTotal: number;
  unpaidTotal: number;
};

type Overview = {
  competition: Tournament;
  editDeadline: string | null;
  fieldRules?: EditableFieldRules;
  settings: Setting[];
  events: { id: string; type: string; isDouble: boolean; entrantType: EntrantType; groupId?: string | null; label: string }[];
  teamCompetitions: { id: string; name: string; entrantType: EntrantType; groupId?: string | null }[];
  summary: Summary[];
  rows: Row[];
};

type PaymentLogAction = 'STATUS' | 'DELETE' | 'GROUP_CHANGE' | 'EVENT_CHANGE';

type PaymentLog = {
  id: string;
  action?: PaymentLogAction;
  targetName: string;
  itemName: string;
  fromStatus: PaymentStatus;
  toStatus: PaymentStatus;
  amount: number | null;
  note: string | null;
  operatorName: string | null;
  createdAt: string;
};

const STATUS_META: Record<PaymentStatus, { label: string; color: string }> = {
  UNPAID: { label: '未缴费', color: 'orange' },
  PAID: { label: '已缴费', color: 'green' },
  WAIVED: { label: '免缴', color: 'blue' },
};

const ACTION_LABELS: Record<PaymentStatus, string> = { PAID: '确认缴费', WAIVED: '设为免缴', UNPAID: '撤销为未缴费' };

type DeleteResult = {
  deleted: number;
  redrawEvents?: RedrawEvent[];
  redrawTeamCompetitions?: Array<{ id: string; name: string }>;
};

type TeamForm = { name: string; affiliation: string; notes?: string };

function logChangeText(row: PaymentLog) {
  if (row.action === 'DELETE') {
    const amount = row.amount != null && row.fromStatus === 'PAID' ? ` ${yuan(row.amount)}` : '';
    return `删除报名（原为${STATUS_META[row.fromStatus].label}${amount}）`;
  }
  if (row.action === 'GROUP_CHANGE') return `改组别：${row.note ?? ''}`;
  if (row.action === 'EVENT_CHANGE') return `改项目：${row.note ?? ''}`;
  return `${STATUS_META[row.fromStatus].label} → ${STATUS_META[row.toStatus].label}`;
}

/** 已缴费但金额与当前应缴不同（改了组别、项目或收费标准），提示差额由管理员处理。 */
function paidDifference(row: Row) {
  if (row.paymentStatus !== 'PAID' || row.paidAmount == null || row.paidAmount === row.amountDue) return null;
  const diff = row.amountDue - row.paidAmount;
  return diff > 0 ? `少缴 ${yuan(diff)}` : `多缴 ${yuan(-diff)}`;
}

type SettingForm = { enabled: boolean; singles: number; doubles: number; team: number; instructions?: string };

const rowKey = (row: Row) => `${row.kind}:${row.id}`;

export default function AdminPaymentsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const access = useCurrentAccess();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [entrantType, setEntrantType] = useState<string>('SCHOOL');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingSetting, setSavingSetting] = useState(false);
  const [kindFilter, setKindFilter] = useState<'ALL' | 'EVENT' | 'TEAM'>('ALL');
  const [itemFilter, setItemFilter] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [action, setAction] = useState<{ status: PaymentStatus; rows: Row[] } | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<PaymentLog[]>([]);
  const [form] = Form.useForm<SettingForm>();
  const [editingRegistrationId, setEditingRegistrationId] = useState<string | null>(null);
  const [editingTeam, setEditingTeam] = useState<Row | null>(null);
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamForm] = Form.useForm<TeamForm>();
  const [deleteRows, setDeleteRows] = useState<Row[] | null>(null);
  const [deleteNote, setDeleteNote] = useState('');
  const [deleting, setDeleting] = useState(false);
  // 截止时间输入框的草稿；undefined 表示显示已保存的值。
  const [deadlineDraft, setDeadlineDraft] = useState<Dayjs | null | undefined>(undefined);
  const [savingDeadline, setSavingDeadline] = useState(false);
  // 删除报名、修改报名信息只开放给管理员和超级管理员。
  const isAdmin = access.role === 'ADMIN' || access.role === 'ROOT';

  useEffect(() => {
    if (!token) return;
    apiFetch<Tournament[]>('/tournaments', { token })
      .then((data) => {
        setTournaments(data);
        setCompetitionId((current) => current || data[0]?.id || '');
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '加载赛事失败'));
  }, [token]);

  const loadOverview = useCallback(async () => {
    if (!token || !competitionId) return;
    setLoading(true);
    try {
      setOverview(await apiFetch<Overview>(`/admin/competitions/${competitionId}/payments`, { token }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载缴费数据失败');
    } finally {
      setLoading(false);
    }
  }, [token, competitionId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => (cancelled ? undefined : loadOverview()));
    return () => {
      cancelled = true;
    };
  }, [loadOverview]);

  function changeCompetition(id: string) {
    setCompetitionId(id);
    setOverview(null);
    setSelectedKeys([]);
    setDeadlineDraft(undefined);
  }

  function changeEntrantType(value: EntrantType) {
    setEntrantType(value);
    setItemFilter(undefined);
    setSelectedKeys([]);
  }

  function changeKind(value: 'ALL' | 'EVENT' | 'TEAM') {
    setKindFilter(value);
    setItemFilter(undefined);
    setSelectedKeys([]);
  }

  useEffect(() => {
    if (overview?.settings.length && !overview.settings.some(s => (s.groupId ?? s.entrantType) === entrantType)) setEntrantType(overview.settings[0].groupId ?? overview.settings[0].entrantType);
  }, [overview, entrantType]);
  const groupLabel = overview?.settings.find(s => (s.groupId ?? s.entrantType) === entrantType)?.groupLabel ?? '当前组别';
  const setting = overview?.settings.find((item) => (item.groupId ?? item.entrantType) === entrantType);
  const summary = overview?.summary.find((item) => (item.groupId ?? item.entrantType) === entrantType);
  const editLocked = isEditDeadlinePassed(overview?.editDeadline);
  const savedDeadline = overview?.editDeadline ? dayjs(overview.editDeadline) : null;
  const deadline = deadlineDraft === undefined ? savedDeadline : deadlineDraft;

  useEffect(() => {
    if (!setting) return;
    form.setFieldsValue({
      enabled: setting.enabled,
      singles: setting.singlesFee / 100,
      doubles: setting.doublesFee / 100,
      team: setting.teamFee / 100,
      instructions: setting.instructions ?? '',
    });
  }, [form, setting]);

  const itemOptions = useMemo(() => {
    if (!overview) return [];
    const events = overview.events.filter((item) => (item.groupId ?? item.entrantType) === entrantType).map((item) => ({ value: item.id, label: item.label }));
    const teams = overview.teamCompetitions.filter((item) => (item.groupId ?? item.entrantType) === entrantType).map((item) => ({ value: item.id, label: `团体赛 · ${item.name}` }));
    if (kindFilter === 'EVENT') return events;
    if (kindFilter === 'TEAM') return teams;
    return [...events, ...teams];
  }, [overview, entrantType, kindFilter]);

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (overview?.rows ?? []).filter((row) => (row.groupId ?? row.entrantType) === entrantType
      && (kindFilter === 'ALL' || row.kind === kindFilter)
      && (!itemFilter || row.itemId === itemFilter)
      && (statusFilter === 'ALL' || row.paymentStatus === statusFilter)
      && (!keyword || [row.name, row.contact, row.affiliation, row.members ?? ''].some((value) => value.toLowerCase().includes(keyword))));
  }, [overview, entrantType, kindFilter, itemFilter, statusFilter, search]);

  const selectedRows = rows.filter((row) => selectedKeys.includes(rowKey(row)));

  async function saveSetting(values: SettingForm) {
    if (!token || !competitionId) return;
    setSavingSetting(true);
    try {
      await apiFetch(`/admin/competitions/${competitionId}/payments/settings/${entrantType}`, {
        token,
        method: 'PUT',
        body: JSON.stringify({
          enabled: values.enabled,
          singlesFee: toFen(values.singles),
          doublesFee: toFen(values.doubles),
          teamFee: toFen(values.team),
          instructions: values.instructions ?? '',
        }),
      });
      message.success(`${groupLabel}收费设置已保存`);
      await loadOverview();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingSetting(false);
    }
  }

  async function removeQr() {
    if (!token || !competitionId) return;
    try {
      await apiFetch(`/admin/competitions/${competitionId}/payments/settings/${entrantType}/qr`, { token, method: 'DELETE' });
      message.success('收款码已移除');
      await loadOverview();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '移除失败');
    }
  }

  async function submitAction() {
    if (!token || !competitionId || !action) return;
    setSubmitting(true);
    try {
      const result = await apiFetch<{ updated: number }>(`/admin/competitions/${competitionId}/payments`, {
        token,
        method: 'PATCH',
        body: JSON.stringify({
          status: action.status,
          note: actionNote.trim() || undefined,
          entries: action.rows.map((row) => (row.kind === 'TEAM' ? { teamId: row.id } : { registrationId: row.id })),
        }),
      });
      message.success(`已更新 ${result.updated} 条`);
      setAction(null);
      setActionNote('');
      setSelectedKeys([]);
      await loadOverview();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function saveDeadline(value: Dayjs | null) {
    if (!token || !competitionId) return;
    setSavingDeadline(true);
    try {
      await apiFetch(`/admin/competitions/${competitionId}/payments/edit-deadline`, {
        token,
        method: 'PUT',
        body: JSON.stringify({ deadline: value ? value.toISOString() : null }),
      });
      message.success(value ? `修改截止时间已设为 ${value.format('YYYY-MM-DD HH:mm')}` : '已取消修改截止时间');
      setDeadlineDraft(undefined);
      await loadOverview();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingDeadline(false);
    }
  }

  function openEdit(row: Row) {
    if (row.kind === 'EVENT') {
      setEditingRegistrationId(row.id);
      return;
    }
    setEditingTeam(row);
    teamForm.setFieldsValue({ name: row.name, affiliation: row.affiliation, notes: row.teamNotes ?? '' });
  }

  async function saveTeam() {
    if (!token || !competitionId || !editingTeam) return;
    let values: TeamForm;
    try {
      values = await teamForm.validateFields();
    } catch {
      return;
    }
    setTeamSaving(true);
    try {
      await apiFetch(`/admin/competitions/${competitionId}/payments/teams/${editingTeam.id}`, {
        token,
        method: 'PATCH',
        body: JSON.stringify({ name: values.name.trim(), affiliation: values.affiliation.trim(), notes: values.notes?.trim() ?? '' }),
      });
      message.success('队伍信息已保存');
      setEditingTeam(null);
      await loadOverview();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setTeamSaving(false);
    }
  }

  async function submitDelete() {
    if (!token || !competitionId || !deleteRows?.length) return;
    setDeleting(true);
    try {
      const result = await apiFetch<DeleteResult>(`/admin/competitions/${competitionId}/payments/delete`, {
        token,
        method: 'POST',
        body: JSON.stringify({
          note: deleteNote.trim() || undefined,
          entries: deleteRows.map((row) => (row.kind === 'TEAM' ? { teamId: row.id } : { registrationId: row.id })),
        }),
      });
      message.success(`已删除 ${result.deleted} 项`);
      setDeleteRows(null);
      setDeleteNote('');
      setSelectedKeys([]);
      showRedrawPrompt(result);
      await loadOverview();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  async function openLogs() {
    if (!token || !competitionId) return;
    setLogsOpen(true);
    try {
      setLogs(await apiFetch<PaymentLog[]>(`/admin/competitions/${competitionId}/payments/logs`, { token }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载记录失败');
    }
  }

  async function exportRows() {
    const XLSX = await import('xlsx');
    const data = rows.map((row) => ({
      组别: row.groupLabel ?? ENTRANT_LABELS[row.entrantType],
      项目: row.itemName,
      参赛方: row.name,
      队员: row.members ?? '',
      单位: row.affiliation,
      联系方式: row.contact,
      应缴金额: row.amountDue / 100,
      状态: STATUS_META[row.paymentStatus].label,
      实缴金额: row.paidAmount == null ? '' : row.paidAmount / 100,
      确认时间: row.paidAt ? dayjs(row.paidAt).format('YYYY-MM-DD HH:mm') : '',
      确认人: row.confirmedByName ?? '',
      备注: row.paymentNote ?? '',
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, '缴费明细');
    const name = (overview?.competition.name ?? '赛事').replace(/[\\/:*?"<>|]/g, '-');
    XLSX.writeFile(book, `${name}-${groupLabel}-缴费明细-${dayjs().format('YYYYMMDD')}.xlsx`);
  }

  // 第一行是缴费状态操作，第二行是改报名信息和删除（仅管理员），操作列保持原来的宽度，不挡住状态列。
  const actionButtons = (row: Row) => (
    <Space orientation="vertical" size={4}>
      <Space size={4} wrap>
        {row.paymentStatus !== 'PAID' ? (
          <Button size="small" type="primary" onClick={() => setAction({ status: 'PAID', rows: [row] })}>确认缴费</Button>
        ) : null}
        {row.paymentStatus === 'UNPAID' ? (
          <Button size="small" onClick={() => setAction({ status: 'WAIVED', rows: [row] })}>免缴</Button>
        ) : null}
        {row.paymentStatus !== 'UNPAID' ? (
          <Button size="small" danger icon={<UndoOutlined />} onClick={() => setAction({ status: 'UNPAID', rows: [row] })}>撤销</Button>
        ) : null}
      </Space>
      {isAdmin ? (
        <Space size={4} wrap>
          <Tooltip title={editLocked ? '已过报名信息修改截止时间' : row.kind === 'TEAM' ? '修改队名、单位、备注' : '修改组别、项目和选手信息'}>
            <Button size="small" icon={<EditOutlined />} disabled={editLocked} onClick={() => openEdit(row)}>编辑</Button>
          </Tooltip>
          <Button size="small" type="primary" danger icon={<DeleteOutlined />} onClick={() => setDeleteRows([row])}>删除</Button>
        </Space>
      ) : null}
    </Space>
  );

  const deletePaid = (deleteRows ?? []).filter((row) => row.paymentStatus === 'PAID');
  const deletePaidTotal = deletePaid.reduce((sum, row) => sum + (row.paidAmount ?? 0), 0);

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>缴费管理</Typography.Title>
          <Typography.Text type="secondary">
            {access.role === 'ADMIN' ? '只显示你创建的赛事。' : ''}
            按组别设置单打、双打（每对）、团体赛（每队）金额；选手转账后在这里确认。未缴费的选手和队伍不能进入抽签编排。
            「撤销」只把缴费状态改回未缴费；「删除」会连同报名信息一起删除，不能恢复。
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<HistoryOutlined />} onClick={openLogs} disabled={!competitionId}>操作记录</Button>
          <Button icon={<ReloadOutlined />} onClick={loadOverview} loading={loading} disabled={!competitionId}>刷新</Button>
        </Space>
      </div>

      <Card>
        <Space wrap size={16}>
          <Select
            style={{ width: 360 }}
            value={competitionId || undefined}
            placeholder="选择赛事"
            showSearch
            optionFilterProp="label"
            options={tournaments.map((item) => ({ value: item.id, label: item.name }))}
            onChange={changeCompetition}
            notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无赛事" />}
          />
          <Segmented
            value={entrantType}
            onChange={(value) => changeEntrantType(value as EntrantType)}
            options={(overview?.settings ?? []).map(s => ({ value: s.groupId ?? s.entrantType, label: s.groupLabel ?? ENTRANT_LABELS[s.entrantType] }))}
          />
        </Space>
        {overview && isAdmin ? (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Typography.Text strong>报名信息修改截止时间</Typography.Text>
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              value={deadline}
              onChange={(value) => setDeadlineDraft(value ?? null)}
              placeholder="不限制"
              style={{ width: 200 }}
            />
            <Button
              loading={savingDeadline}
              disabled={(deadline?.valueOf() ?? null) === (savedDeadline?.valueOf() ?? null)}
              onClick={() => saveDeadline(deadline)}
            >
              保存
            </Button>
            {overview.editDeadline ? (
              <Button type="link" disabled={savingDeadline} onClick={() => saveDeadline(null)}>不限制</Button>
            ) : null}
            <Typography.Text type={editLocked ? 'danger' : 'secondary'}>
              {editLocked
                ? '已过截止时间：缴费管理和参赛选手页都不能再改报名信息和组别，删除不受影响。'
                : '过了这个时间，缴费管理和参赛选手页都不能再改报名信息和组别，删除不受影响。'}
            </Typography.Text>
          </div>
        ) : null}
      </Card>

      {competitionId && setting ? (
        <Card title={`${groupLabel}收费设置`} loading={loading && !overview}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 24, alignItems: 'start' }}>
            <Form form={form} layout="vertical" onFinish={saveSetting} requiredMark={false}>
              <Form.Item name="enabled" label="本组别收费" valuePropName="checked">
                <Switch checkedChildren="收费" unCheckedChildren="不收费" />
              </Form.Item>
              <Space wrap size={16}>
                <Form.Item name="singles" label="单打（元/人）" rules={[{ required: true, message: '请填写金额' }]}>
                  <InputNumber min={0} max={100000} precision={2} style={{ width: 160 }} />
                </Form.Item>
                <Form.Item name="doubles" label="双打（元/对）" rules={[{ required: true, message: '请填写金额' }]}>
                  <InputNumber min={0} max={100000} precision={2} style={{ width: 160 }} />
                </Form.Item>
                <Form.Item name="team" label="团体赛（元/队）" rules={[{ required: true, message: '请填写金额' }]}>
                  <InputNumber min={0} max={100000} precision={2} style={{ width: 160 }} />
                </Form.Item>
              </Space>
              <Form.Item name="instructions" label="收款说明" extra="收款户名、账号、转账备注要求等，审核通过的选手在报名查询和我的报名中可以看到。">
                <Input.TextArea rows={3} maxLength={2000} showCount placeholder="例如：转账时备注「姓名+项目」，收款人：xxx" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={savingSetting}>保存设置</Button>
            </Form>
            <Space orientation="vertical" align="center">
              <Typography.Text strong>收款码</Typography.Text>
              {setting.qrImageUrl ? (
                <Image src={uploadUrl(setting.qrImageUrl)} alt="收款码" width={160} />
              ) : (
                <div style={{ width: 160, height: 160, border: '1px dashed #d9d9d9', borderRadius: 8, display: 'grid', placeItems: 'center', color: '#999' }}>未上传</div>
              )}
              <Upload
                name="file"
                accept="image/png,image/jpeg,image/webp"
                showUploadList={false}
                action={`${API_BASE}/admin/competitions/${competitionId}/payments/settings/${entrantType}/qr`}
                headers={token ? { Authorization: `Bearer ${token}` } : undefined}
                beforeUpload={(file) => {
                  if (file.size > 4 * 1024 * 1024) {
                    message.error('图片需小于 4MB');
                    return Upload.LIST_IGNORE;
                  }
                  return true;
                }}
                onChange={(info) => {
                  if (info.file.status === 'done') {
                    message.success('收款码已上传');
                    void loadOverview();
                  }
                  if (info.file.status === 'error') message.error(info.file.response?.message ?? '上传失败');
                }}
              >
                <Button icon={<UploadOutlined />}>{setting.qrImageUrl ? '更换' : '上传'}</Button>
              </Upload>
              {setting.qrImageUrl ? (
                <Popconfirm title="移除收款码？" onConfirm={removeQr}>
                  <Button size="small" type="link" danger icon={<DeleteOutlined />}>移除</Button>
                </Popconfirm>
              ) : null}
            </Space>
          </div>
        </Card>
      ) : null}

      {summary ? (
        <Card>
          {!summary.enabled ? (
            <Alert type="info" showIcon style={{ marginBottom: 16 }} title={`${groupLabel}未开启收费，选手显示「无需缴费」，抽签编排不受影响。`} />
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
            <Statistic title="需缴费" value={summary.total} suffix="项" />
            <Statistic title="已缴费" value={summary.paidCount} suffix="项" styles={{ content: { color: '#16a34a' } }} />
            <Statistic title="免缴" value={summary.waivedCount} suffix="项" />
            <Statistic title="未缴费" value={summary.unpaidCount} suffix="项" styles={{ content: { color: summary.unpaidCount ? '#ea580c' : undefined } }} />
            <Statistic title="已收金额" value={yuan(summary.paidTotal)} />
            <Statistic title="待收金额" value={yuan(summary.unpaidTotal)} />
          </div>
        </Card>
      ) : null}

      {overview ? (
        <Card
          title="缴费明细"
          extra={(
            <Space wrap>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                disabled={!selectedRows.some((row) => row.paymentStatus !== 'PAID')}
                onClick={() => setAction({ status: 'PAID', rows: selectedRows.filter((row) => row.paymentStatus !== 'PAID') })}
              >
                批量确认缴费
              </Button>
              <Button
                disabled={!selectedRows.some((row) => row.paymentStatus === 'UNPAID')}
                onClick={() => setAction({ status: 'WAIVED', rows: selectedRows.filter((row) => row.paymentStatus === 'UNPAID') })}
              >
                批量免缴
              </Button>
              {isAdmin ? (
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  disabled={!selectedRows.length}
                  onClick={() => setDeleteRows(selectedRows)}
                >
                  批量删除{selectedRows.length ? `（${selectedRows.length}）` : ''}
                </Button>
              ) : null}
              <Button icon={<DownloadOutlined />} onClick={exportRows} disabled={!rows.length}>导出</Button>
            </Space>
          )}
        >
          <Space wrap style={{ marginBottom: 16 }}>
            <Segmented
              value={kindFilter}
              onChange={(value) => changeKind(value as typeof kindFilter)}
              options={[{ value: 'ALL', label: '全部' }, { value: 'EVENT', label: '单项' }, { value: 'TEAM', label: '团体赛' }]}
            />
            <Select allowClear placeholder="全部项目" style={{ width: 220 }} value={itemFilter} options={itemOptions} onChange={setItemFilter} />
            <Select
              style={{ width: 130 }}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'ALL', label: '全部状态' },
                { value: 'UNPAID', label: '未缴费' },
                { value: 'PAID', label: '已缴费' },
                { value: 'WAIVED', label: '免缴' },
              ]}
            />
            <Input.Search allowClear placeholder="姓名 / 联系方式 / 单位" style={{ width: 240 }} onSearch={setSearch} onChange={(event) => !event.target.value && setSearch('')} />
          </Space>
          <Table<Row>
            rowKey={rowKey}
            loading={loading}
            dataSource={rows}
            scroll={{ x: 1100 }}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
            rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
            columns={[
              { title: '项目', dataIndex: 'itemName', width: 180 },
              {
                title: '参赛方',
                dataIndex: 'name',
                render: (value: string, row) => (
                  <Space orientation="vertical" size={0}>
                    <span>{value}</span>
                    {row.members ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.members}</Typography.Text> : null}
                  </Space>
                ),
              },
              { title: '单位', dataIndex: 'affiliation', width: 140, ellipsis: true },
              { title: '联系方式', dataIndex: 'contact', width: 150 },
              {
                title: '应缴',
                dataIndex: 'amountDue',
                width: 110,
                render: (value: number, row) => (
                  <Space orientation="vertical" size={0}>
                    {value > 0 || row.paymentStatus !== 'UNPAID' ? yuan(value) : <Typography.Text type="secondary">无需</Typography.Text>}
                    {paidDifference(row) ? <Typography.Text type="warning" style={{ fontSize: 12 }}>{paidDifference(row)}</Typography.Text> : null}
                  </Space>
                ),
              },
              {
                title: '状态',
                dataIndex: 'paymentStatus',
                width: 170,
                render: (value: PaymentStatus, row) => (
                  <Space orientation="vertical" size={0}>
                    <Tag color={STATUS_META[value].color}>{STATUS_META[value].label}{value === 'PAID' && row.paidAmount != null ? ` ${yuan(row.paidAmount)}` : ''}</Tag>
                    {row.paidAt ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(row.paidAt).format('MM/DD HH:mm')} {row.confirmedByName ?? ''}
                      </Typography.Text>
                    ) : null}
                    {row.paymentNote ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>备注：{row.paymentNote}</Typography.Text> : null}
                  </Space>
                ),
              },
              { title: '操作', width: 200, fixed: 'right', render: (_, row) => actionButtons(row) },
            ]}
          />
        </Card>
      ) : competitionId ? null : (
        <Card><Empty description="请先创建赛事" /></Card>
      )}

      <Modal
        open={!!action}
        title={action ? `${ACTION_LABELS[action.status]}（${action.rows.length} 项）` : ''}
        okText="确定"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={submitAction}
        onCancel={() => { setAction(null); setActionNote(''); }}
        destroyOnHidden
      >
        {action ? (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {action.rows.slice(0, 8).map((row) => `${row.name}（${row.itemName}）`).join('、')}
              {action.rows.length > 8 ? ` 等 ${action.rows.length} 项` : ''}
            </Typography.Paragraph>
            {action.status === 'PAID' ? (
              <Typography.Text type="secondary">将按当前设置的金额记录实缴：{yuan(action.rows.reduce((sum, row) => sum + row.amountDue, 0))}</Typography.Text>
            ) : null}
            <Input.TextArea rows={2} maxLength={255} value={actionNote} onChange={(event) => setActionNote(event.target.value)} placeholder="备注（可选），如转账流水号、免缴原因" />
          </Space>
        ) : null}
      </Modal>

      <Modal
        open={!!deleteRows}
        title={deleteRows ? `删除报名（${deleteRows.length} 项）` : ''}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={deleting}
        onOk={submitDelete}
        onCancel={() => { setDeleteRows(null); setDeleteNote(''); }}
        destroyOnHidden
      >
        {deleteRows ? (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {deleteRows.slice(0, 8).map((row) => `${row.name}（${row.itemName}）`).join('、')}
              {deleteRows.length > 8 ? ` 等 ${deleteRows.length} 项` : ''}
            </Typography.Paragraph>
            <Alert
              type="warning"
              showIcon
              title="删除后报名信息一并删除，不能恢复"
              description="单项只删除这一个项目，该选手报的其他项目保留；团体赛删除整支队伍。已抽签的项目删除后需要重新抽签；签表已冻结、已发布或已开赛的不能删除。"
            />
            {deletePaid.length ? (
              <Alert
                type="error"
                showIcon
                title={`其中 ${deletePaid.length} 项已缴费，共 ${yuan(deletePaidTotal)}，请线下退款`}
                description="缴费操作记录里会保留删除时的状态和金额。"
              />
            ) : null}
            <Input.TextArea rows={2} maxLength={255} value={deleteNote} onChange={(event) => setDeleteNote(event.target.value)} placeholder="删除原因（可选），会记入缴费操作记录" />
          </Space>
        ) : null}
      </Modal>

      <Modal
        open={!!editingTeam}
        title={editingTeam ? `编辑队伍：${editingTeam.name}` : ''}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: editLocked }}
        confirmLoading={teamSaving}
        onOk={saveTeam}
        onCancel={() => setEditingTeam(null)}
        forceRender
      >
        <Form form={teamForm} layout="vertical" disabled={editLocked}>
          <Form.Item label="队名" name="name" rules={[{ required: true, whitespace: true, message: '请填写队名' }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item label="单位" name="affiliation" rules={[{ required: true, whitespace: true, message: '请填写单位' }]}>
            <Input maxLength={191} />
          </Form.Item>
          <Form.Item label="备注" name="notes">
            <Input.TextArea rows={2} maxLength={191} />
          </Form.Item>
          <Typography.Text type="secondary">队员名单请到团体赛管理中调整；团体赛队伍不能在这里改组别。</Typography.Text>
        </Form>
      </Modal>

      {overview ? (
        <RegistrationEditModal
          open={!!editingRegistrationId}
          registrationId={editingRegistrationId}
          basePath={`/admin/competitions/${competitionId}/payments/registrations`}
          token={token}
          events={overview.events}
          fieldRules={overview.fieldRules}
          editDeadline={overview.editDeadline}
          onClose={() => setEditingRegistrationId(null)}
          onSaved={async (result) => {
            setEditingRegistrationId(null);
            showRedrawPrompt(result);
            await loadOverview();
          }}
        />
      ) : null}

      <Drawer title="缴费操作记录" size={800} open={logsOpen} onClose={() => setLogsOpen(false)}>
        <Table<PaymentLog>
          rowKey="id"
          size="small"
          dataSource={logs}
          pagination={{ pageSize: 20 }}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 100, render: (value: string) => dayjs(value).format('MM/DD HH:mm') },
            { title: '参赛方', render: (_, row) => `${row.targetName}（${row.itemName}）` },
            { title: '变更', width: 200, render: (_, row) => logChangeText(row) },
            { title: '操作人', dataIndex: 'operatorName', width: 100 },
            {
              title: '备注',
              dataIndex: 'note',
              width: 140,
              render: (value: string | null, row) => (row.action === 'GROUP_CHANGE' || row.action === 'EVENT_CHANGE' ? '' : value ?? ''),
            },
          ]}
        />
      </Drawer>
    </Space>
  );
}
