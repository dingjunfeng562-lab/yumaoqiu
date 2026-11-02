'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Button,
  Card,
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
  Typography,
  Upload,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  HistoryOutlined,
  ReloadOutlined,
  UndoOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { apiFetch } from '@/lib/api';
import { useCurrentAccess } from '@/lib/use-current-role';
import { ENTRANT_LABELS, type EntrantType, type PaymentStatus, toFen, uploadUrl, yuan } from '@/lib/payments';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type Tournament = { id: string; name: string };

type Setting = {
  entrantType: EntrantType;
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
  itemId: string;
  itemName: string;
  name: string;
  contact: string;
  affiliation: string;
  members?: string;
  amountDue: number;
  paymentStatus: PaymentStatus;
  paidAmount: number | null;
  paidAt: string | null;
  paymentNote: string | null;
  confirmedByName: string | null;
};

type Summary = {
  entrantType: EntrantType;
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
  settings: Setting[];
  events: { id: string; entrantType: EntrantType; label: string }[];
  teamCompetitions: { id: string; name: string; entrantType: EntrantType }[];
  summary: Summary[];
  rows: Row[];
};

type PaymentLog = {
  id: string;
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

type SettingForm = { enabled: boolean; singles: number; doubles: number; team: number; instructions?: string };

const rowKey = (row: Row) => `${row.kind}:${row.id}`;

export default function AdminPaymentsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const access = useCurrentAccess();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [entrantType, setEntrantType] = useState<EntrantType>('SCHOOL');
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

  const setting = overview?.settings.find((item) => item.entrantType === entrantType);
  const summary = overview?.summary.find((item) => item.entrantType === entrantType);

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
    const events = overview.events.filter((item) => item.entrantType === entrantType).map((item) => ({ value: item.id, label: item.label }));
    const teams = overview.teamCompetitions.filter((item) => item.entrantType === entrantType).map((item) => ({ value: item.id, label: `团体赛 · ${item.name}` }));
    if (kindFilter === 'EVENT') return events;
    if (kindFilter === 'TEAM') return teams;
    return [...events, ...teams];
  }, [overview, entrantType, kindFilter]);

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (overview?.rows ?? []).filter((row) => row.entrantType === entrantType
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
      message.success(`${ENTRANT_LABELS[entrantType]}收费设置已保存`);
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
      组别: ENTRANT_LABELS[row.entrantType],
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
    XLSX.writeFile(book, `${name}-${ENTRANT_LABELS[entrantType]}-缴费明细-${dayjs().format('YYYYMMDD')}.xlsx`);
  }

  const actionButtons = (row: Row) => (
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
  );

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>缴费管理</Typography.Title>
          <Typography.Text type="secondary">
            {access.role === 'ADMIN' ? '只显示你创建的赛事。' : ''}
            按组别设置单打、双打（每对）、团体赛（每队）金额；选手转账后在这里确认。未缴费的选手和队伍不能进入抽签编排。
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
            options={[{ value: 'SCHOOL', label: '学生组' }, { value: 'SOCIAL', label: '社会组' }]}
          />
        </Space>
      </Card>

      {competitionId && setting ? (
        <Card title={`${ENTRANT_LABELS[entrantType]}收费设置`} loading={loading && !overview}>
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
            <Alert type="info" showIcon style={{ marginBottom: 16 }} title={`${ENTRANT_LABELS[entrantType]}未开启收费，选手显示「无需缴费」，抽签编排不受影响。`} />
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
                width: 90,
                render: (value: number, row) => (value > 0 || row.paymentStatus !== 'UNPAID' ? yuan(value) : <Typography.Text type="secondary">无需</Typography.Text>),
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

      <Drawer title="缴费操作记录" size={640} open={logsOpen} onClose={() => setLogsOpen(false)}>
        <Table<PaymentLog>
          rowKey="id"
          size="small"
          dataSource={logs}
          pagination={{ pageSize: 20 }}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 120, render: (value: string) => dayjs(value).format('MM/DD HH:mm') },
            { title: '参赛方', render: (_, row) => `${row.targetName}（${row.itemName}）` },
            { title: '变更', width: 150, render: (_, row) => `${STATUS_META[row.fromStatus].label} → ${STATUS_META[row.toStatus].label}` },
            { title: '操作人', dataIndex: 'operatorName', width: 100 },
            { title: '备注', dataIndex: 'note', width: 120, render: (value: string | null) => value ?? '' },
          ]}
        />
      </Drawer>
    </Space>
  );
}
