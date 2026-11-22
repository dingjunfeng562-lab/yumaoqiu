'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import dayjs, { Dayjs } from 'dayjs';
import { Button, Card, Checkbox, DatePicker, Form, Image, Input, Modal, QRCode, Radio, Segmented, Select, Skeleton, Space, Table, Tag, Typography, Upload, message } from 'antd';
import type { UploadFile } from 'antd';
import { CheckOutlined, CopyOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, PictureOutlined, PlusOutlined, QrcodeOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined, UploadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { useCurrentAccess } from '@/lib/use-current-role';
import { PHOTO_MANAGEMENT_ACCESS, PHOTO_MANAGEMENT_REVIEW_PAGE, PHOTO_MANAGEMENT_STATUS, photoManagementTargetKey } from '@/lib/photo-management-access';
import type { PhotoManagementRequest, PhotoManagementTargetType } from '@/lib/photo-management-access';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, '');

type TargetType = PhotoManagementTargetType;
type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
type UsageFilter = 'ALL' | 'USED' | 'UNUSED';

type PhotoTarget = {
  targetType: TargetType;
  id: string;
  title: string;
  coverImageUrl: string | null;
  startAt: string;
  endAt: string | null;
  approvalStatus: ApprovalStatus;
  rejectReason: string | null;
  isArchived: boolean;
  dateMode: 'SINGLE' | 'RANGE' | null;
  photoCount: number;
  managementAllowed: boolean;
  managementOpened: boolean;
  managementApprovalId: string | null;
  photoAccessEnabled: boolean;
  photoUploadAccessEnabled: boolean;
  submittedBy: { id: string; username: string | null } | null;
  createdAt: string;
};

type ActivityForm = {
  title: string;
  dateMode: 'SINGLE' | 'RANGE';
  startAt?: Dayjs;
  range?: [Dayjs, Dayjs];
};

const ACTIVITY_APPROVAL_STATUS = {
  PENDING: { color: 'orange', label: '待审核' },
  APPROVED: { color: 'green', label: '已通过' },
  REJECTED: { color: 'red', label: '已驳回' },
} as const;

const TYPE_LABEL: Record<TargetType, string> = { TOURNAMENT: '赛事', ACTIVITY: '活动' };
const TYPE_COLOR: Record<TargetType, string> = { TOURNAMENT: 'blue', ACTIVITY: 'purple' };

const ACTIVITY_APPROVAL_FILTERS = [
  { value: 'ALL', label: '全部活动审核状态' },
  ...Object.entries(ACTIVITY_APPROVAL_STATUS).map(([value, status]) => ({ value, label: status.label })),
];

const USAGE_FILTERS = [
  { value: 'ALL', label: '全部图片使用状态' },
  { value: 'USED', label: '已使用' },
  { value: 'UNUSED', label: '未使用' },
];

function fullUrl(path?: string | null) {
  if (!path) return '';
  return path.startsWith('/api/') ? `${API_ORIGIN}${path}` : path;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

/** 图片管理 / 水印设置沿用现有路由：赛事走比赛路径，活动走活动图片路径。 */
function targetBasePath(item: PhotoTarget) {
  const base = item.targetType === 'TOURNAMENT' ? '/nicaiyixiahh/competitions' : '/nicaiyixiahh/photo-activities';
  return `${base}/${encodeURIComponent(item.id)}`;
}

function targetKey(item: PhotoTarget) {
  return photoManagementTargetKey(item.targetType, item.id);
}

export default function PhotoActivitiesPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken;
  const access = useCurrentAccess();
  if (!access.ready || !token) return <Skeleton active />;
  return <PhotoActivities token={token} role={access.role} />;
}

function PhotoActivities({ token, role }: { token: string; role: string | undefined }) {
  const router = useRouter();
  const [form] = Form.useForm<ActivityForm>();
  const dateMode = Form.useWatch('dateMode', form) ?? 'SINGLE';
  const [rows, setRows] = useState<PhotoTarget[]>([]);
  const [requests, setRequests] = useState<PhotoManagementRequest[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestTargetKey, setRequestTargetKey] = useState<string>();
  const [requestPurpose, setRequestPurpose] = useState('');
  const [requestSaving, setRequestSaving] = useState(false);
  const [revoking, setRevoking] = useState<PhotoTarget | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeSaving, setRevokeSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<PhotoTarget | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverFiles, setCoverFiles] = useState<UploadFile[]>([]);
  const [rejecting, setRejecting] = useState<PhotoTarget | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [deleting, setDeleting] = useState<PhotoTarget | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [qr, setQr] = useState<{ title: string; url: string }>();
  const [qrLoading, setQrLoading] = useState<string>();
  const [typeFilter, setTypeFilter] = useState<'ALL' | TargetType>('ALL');
  const [activityApprovalFilter, setActivityApprovalFilter] = useState<'ALL' | ApprovalStatus>('ALL');
  const [usageFilter, setUsageFilter] = useState<UsageFilter>('ALL');
  const [includeArchived, setIncludeArchived] = useState(true);
  const qrRef = useRef<HTMLDivElement>(null);
  const showActivityApproval = typeFilter === 'ACTIVITY'
    || (typeFilter === 'ALL' && rows.some((item) => item.targetType === 'ACTIVITY'));
  const deletingTournamentPhotos = deleting?.targetType === 'TOURNAMENT';
  const deleteTargetLabel = deletingTournamentPhotos ? '赛事' : '活动';

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [targets, applications] = await Promise.all([
        apiFetch<PhotoTarget[]>('/admin/photo-targets', { token, cache: 'no-store' }),
        role === 'ADMIN'
          ? apiFetch<PhotoManagementRequest[]>(PHOTO_MANAGEMENT_ACCESS, { token, cache: 'no-store' })
          : Promise.resolve([]),
      ]);
      setRows(targets);
      setRequests(applications);
    }
    catch (error) { message.error(error instanceof Error ? error.message : '活动图片加载失败'); }
    finally { setLoading(false); }
  }, [token, role]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    window.addEventListener('focus', load);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  const requestByTarget = useMemo(() => new Map(requests.map((request) => [
    photoManagementTargetKey(request.targetType, request.targetId), request,
  ])), [requests]);
  const [listedRows, applicationTournaments] = useMemo(() => [
    rows.filter((row) => row.targetType === 'ACTIVITY' || row.managementOpened),
    rows.filter((row) => row.targetType === 'TOURNAMENT' && !row.managementOpened),
  ], [rows]);
  const requestTarget = requestTargetKey ? rows.find((row) => targetKey(row) === requestTargetKey) : undefined;
  const activeRequest = requestTargetKey ? requestByTarget.get(requestTargetKey) : undefined;
  const canSubmitRequest = !!requestTarget && !requestTarget.managementOpened
    && activeRequest?.status !== 'PENDING' && activeRequest?.status !== 'APPROVED';

  function openRequest(target?: PhotoTarget) {
    setRequestTargetKey(target ? targetKey(target) : undefined);
    setRequestPurpose('');
    setRequestOpen(true);
  }

  async function requestAccess() {
    const purpose = requestPurpose.trim();
    if (!requestTarget || !canSubmitRequest || !purpose || requestSaving) return;
    setRequestSaving(true);
    try {
      await apiFetch(PHOTO_MANAGEMENT_ACCESS, {
        token, method: 'POST',
        body: JSON.stringify({ targetType: requestTarget.targetType, targetId: requestTarget.id, purpose }),
      });
      message.success('申请已提交，等待超级管理员审核');
      setRequestOpen(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '申请提交失败');
    } finally {
      setRequestSaving(false);
      await load();
    }
  }

  async function revokeAccess() {
    const approvalId = revoking?.managementApprovalId;
    const reason = revokeReason.trim();
    if (role !== 'ROOT' || !token || !approvalId || !reason || revokeSaving) return;

    setRevokeSaving(true);
    try {
      await apiFetch(`${PHOTO_MANAGEMENT_ACCESS}/requests/${encodeURIComponent(approvalId)}`, {
        token, method: 'PATCH', body: JSON.stringify({ decision: 'revoke', reason }),
      });
      message.success('已取消开通图片管理');
      setRevoking(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '取消开通失败');
      if ((error as { status?: number } | null)?.status === 409) setRevoking(null);
    } finally {
      await load();
      setRevokeSaving(false);
    }
  }

  const filteredRows = useMemo(
    () => listedRows.filter((item) => {
      if (typeFilter !== 'ALL' && item.targetType !== typeFilter) return false;
      if (showActivityApproval && activityApprovalFilter !== 'ALL'
        && (item.targetType !== 'ACTIVITY' || item.approvalStatus !== activityApprovalFilter)) return false;
      if (role === 'ROOT' && usageFilter !== 'ALL' && (item.photoCount > 0) !== (usageFilter === 'USED')) return false;
      if (!includeArchived && item.isArchived) return false;
      return true;
    }).sort((a, b) => {
      const aHasTournamentPhotos = a.targetType === 'TOURNAMENT' && a.photoCount > 0;
      const bHasTournamentPhotos = b.targetType === 'TOURNAMENT' && b.photoCount > 0;
      return Number(bHasTournamentPhotos) - Number(aHasTournamentPhotos);
    }),
    [listedRows, typeFilter, showActivityApproval, activityApprovalFilter, role, usageFilter, includeArchived],
  );

  function openCreate() {
    setEditing(null);
    setCoverFiles([]);
    form.setFieldsValue({ title: '', dateMode: 'SINGLE', startAt: dayjs().millisecond(0), range: undefined });
    setFormOpen(true);
  }

  function openEdit(item: PhotoTarget) {
    setEditing(item);
    setCoverFiles([]);
    form.setFieldsValue({
      title: item.title,
      dateMode: item.dateMode === 'RANGE' ? 'RANGE' : 'SINGLE',
      startAt: item.dateMode === 'RANGE' ? undefined : dayjs(item.startAt),
      range: item.dateMode === 'RANGE' && item.endAt ? [dayjs(item.startAt), dayjs(item.endAt)] : undefined,
    });
    setFormOpen(true);
  }

  async function save() {
    if (!token) return;
    const values = await form.validateFields();
    if (!editing && !coverFiles.length) { message.error('请设置活动封面'); return; }
    const start = values.dateMode === 'RANGE' ? values.range?.[0] : values.startAt;
    const end = values.dateMode === 'RANGE' ? values.range?.[1] : undefined;
    if (!start || (values.dateMode === 'RANGE' && !end)) return;
    const body = new FormData();
    body.append('title', values.title.trim());
    body.append('dateMode', values.dateMode);
    body.append('startAt', start.millisecond(0).toISOString());
    if (end) body.append('endAt', end.millisecond(0).toISOString());
    const cover = coverFiles[0]?.originFileObj;
    if (cover) body.append('cover', cover);
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/admin/photo-activities${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PUT' : 'POST', headers: { Authorization: `Bearer ${token}` }, body,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ message: '保存失败' }));
        throw new Error(Array.isArray(data.message) ? data.message.join('；') : data.message);
      }
      message.success(role === 'ROOT' ? '活动已保存并自动通过审核' : '活动已提交，等待超级管理员审核');
      setFormOpen(false);
      await load();
    } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  }

  async function approve(item: PhotoTarget) {
    if (!token) return;
    try { await apiFetch(`/admin/photo-activities/${item.id}/approve`, { method: 'PATCH', token, body: '{}' }); message.success('活动已通过审核'); await load(); }
    catch (error) { message.error(error instanceof Error ? error.message : '审核失败'); }
  }

  async function reject() {
    if (!token || !rejecting) return;
    try {
      await apiFetch(`/admin/photo-activities/${rejecting.id}/reject`, { method: 'PATCH', token, body: JSON.stringify({ reason: rejectReason }) });
      message.success('活动已驳回'); setRejecting(null); setRejectReason(''); await load();
    } catch (error) { message.error(error instanceof Error ? error.message : '驳回失败'); }
  }

  function openDelete(item: PhotoTarget) {
    if (role !== 'ROOT') return;
    setDeleting(item);
    setDeleteInput('');
  }

  function closeDelete() {
    setDeleting(null);
    setDeleteInput('');
  }

  async function deleteTarget() {
    const confirmation = deleteInput.trim();
    if (role !== 'ROOT' || !token || !deleting || deleteLoading || confirmation !== deleting.title) return;
    setDeleteLoading(true);
    try {
      const id = encodeURIComponent(deleting.id);
      if (deleting.targetType === 'TOURNAMENT') {
        const { deleted } = await apiFetch<{ deleted: number }>(`/admin/tournaments/${id}/photos`, {
          method: 'DELETE', token, body: JSON.stringify({ confirmName: confirmation }),
        });
        message.success(`已删除 ${deleted} 张赛事图片`);
      } else {
        await apiFetch(`/admin/photo-activities/${id}`, {
          method: 'DELETE', token, body: JSON.stringify({ confirmTitle: confirmation }),
        });
        message.success('活动及其全部图片已删除');
      }
      closeDelete();
      await load();
    } catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); }
    finally { setDeleteLoading(false); }
  }

  async function showQr(item: PhotoTarget) {
    if (!token) return;
    setQrLoading(targetKey(item));
    try {
      // 已有二维码的对象无论审核状态都能再次查看；没有二维码时才由后端校验审核状态。
      const data = await apiFetch<{ path: string }>(
        item.targetType === 'TOURNAMENT'
          ? `/admin/competitions/${encodeURIComponent(item.id)}/photo-access`
          : `/admin/photo-activities/${encodeURIComponent(item.id)}/photo-access`,
        { method: 'POST', token, body: '{}' },
      );
      setQr({ title: item.title, url: new URL(data.path, window.location.origin).toString() });
      await load();
    } catch (error) { message.error(error instanceof Error ? error.message : '二维码生成失败'); }
    finally { setQrLoading(undefined); }
  }

  async function copyQr() {
    if (!qr) return;
    try { await navigator.clipboard.writeText(qr.url); message.success('图片地址已复制'); }
    catch { message.error('复制失败，请手动复制'); }
  }

  function downloadQr() {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas || !qr) return;
    const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = `${qr.title}-图片二维码.png`; link.click();
  }

  const columns = [
    { title: '封面', dataIndex: 'coverImageUrl', width: 92, render: (value: string | null) => value ? <Image alt="封面" src={fullUrl(value)} width={72} height={48} style={{ objectFit: 'cover', borderRadius: 6 }} /> : <div style={{ width: 72, height: 48, borderRadius: 6, background: '#f1f5f9' }} /> },
    { title: '名称', dataIndex: 'title', width: 230, render: (value: string, item: PhotoTarget) => <Space direction="vertical" size={2}>
      <Space size={6} wrap>
        <Tag color={TYPE_COLOR[item.targetType]} style={{ marginInlineEnd: 0 }}>{TYPE_LABEL[item.targetType]}</Tag>
        <Typography.Text strong>{value}</Typography.Text>
        {item.isArchived ? <Tag style={{ marginInlineEnd: 0 }}>已归档</Tag> : null}
      </Space>
      {item.targetType === 'ACTIVITY' && item.rejectReason ? <Typography.Text type="danger" style={{ fontSize: 12 }}>驳回原因：{item.rejectReason}</Typography.Text> : null}
    </Space> },
    { title: '时间', key: 'time', width: 218, render: (_: unknown, item: PhotoTarget) => item.endAt ? `${formatTime(item.startAt)} — ${formatTime(item.endAt)}` : formatTime(item.startAt) },
    ...(role === 'ROOT' ? [{ title: '创建人', key: 'creator', width: 100, render: (_: unknown, item: PhotoTarget) => item.submittedBy?.username ?? '—' }] : []),
    ...(showActivityApproval ? [{
      title: '活动审核', dataIndex: 'approvalStatus', width: 96,
      render: (value: ApprovalStatus, item: PhotoTarget) => item.targetType === 'ACTIVITY'
        ? <Tag color={ACTIVITY_APPROVAL_STATUS[value].color}>{ACTIVITY_APPROVAL_STATUS[value].label}</Tag>
        : null,
    }] : []),
    ...(role === 'ROOT' ? [{
      title: '图片管理开通', key: 'managementStatus', width: 142,
      render: (_: unknown, item: PhotoTarget) => item.managementApprovalId ? (
        <Space orientation="vertical" size={4}>
          <Tag color="green">已开通</Tag>
          <Button
            size="small"
            danger
            onClick={() => { setRevokeReason(''); setRevoking(item); }}
          >
            取消开通
          </Button>
        </Space>
      ) : item.managementOpened ? <Tag>平台管理</Tag> : null,
    }] : []),
    { title: '图片', dataIndex: 'photoCount', width: 70, render: (value: number, item: PhotoTarget) => item.managementAllowed ? `${value} 张` : '—' },
    { title: '操作', key: 'actions', width: 384, render: (_: unknown, item: PhotoTarget) => {
      const canShowQr = item.photoAccessEnabled || item.approvalStatus === 'APPROVED';
      const qrHint = canShowQr ? undefined : '审核通过后才能生成二维码';
      const request = requestByTarget.get(targetKey(item));
      const requestStatus = request ? PHOTO_MANAGEMENT_STATUS[request.status] : null;
      const reason = request?.status === 'REJECTED' ? request.reviewReason
        : request?.status === 'REVOKED' ? request.revokeReason : null;
      return <Space wrap>
        {item.targetType === 'ACTIVITY' ? <Button icon={<EditOutlined />} onClick={() => openEdit(item)}>编辑</Button> : null}
        {item.managementAllowed ? <>
          {role === 'ADMIN' ? <Tag color="green">已开通</Tag> : null}
          <Button icon={<SafetyCertificateOutlined />} onClick={() => router.push(`${targetBasePath(item)}/watermark`)}>Logo 设置</Button>
          <Button type="primary" icon={<PictureOutlined />} onClick={() => router.push(`${targetBasePath(item)}/photos`)}>图片管理</Button>
          <Button icon={<QrcodeOutlined />} loading={qrLoading === targetKey(item)} disabled={!canShowQr} title={qrHint} onClick={() => void showQr(item)}>{item.photoAccessEnabled ? '查看二维码' : '生成二维码'}</Button>
          {role === 'ROOT' && item.targetType === 'TOURNAMENT' && item.photoCount > 0 ? (
            <Button danger icon={<DeleteOutlined />} onClick={() => openDelete(item)}>删除赛事图片</Button>
          ) : null}
        </> : (
          <Space orientation="vertical" size={4}>
            <Space wrap>
              {requestStatus ? <Tag color={requestStatus.color}>{requestStatus.label}</Tag> : <Tag>未申请</Tag>}
              {request?.status !== 'PENDING' && request?.status !== 'APPROVED' ? (
                <Button type="primary" onClick={() => openRequest(item)}>
                  {request ? '重新申请' : '申请图片管理'}
                </Button>
              ) : null}
            </Space>
            {reason ? <Typography.Text type="secondary">{reason}</Typography.Text> : null}
          </Space>
        )}
        {role === 'ROOT' && item.targetType === 'ACTIVITY' && item.approvalStatus !== 'APPROVED' ? <Button icon={<CheckOutlined />} onClick={() => void approve(item)}>通过</Button> : null}
        {role === 'ROOT' && item.targetType === 'ACTIVITY' && item.approvalStatus !== 'REJECTED' ? <Button danger icon={<StopOutlined />} onClick={() => setRejecting(item)}>驳回</Button> : null}
        {role === 'ROOT' && item.targetType === 'ACTIVITY' ? <Button danger type="primary" icon={<DeleteOutlined />} onClick={() => openDelete(item)}>删除</Button> : null}
      </Space>;
    } },
  ];

  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
      <div><Typography.Title level={4} style={{ margin: 0 }}>活动图片</Typography.Title><Typography.Text type="secondary">赛事与活动图片、Logo 水印、AI 图片审核和二维码访问</Typography.Text></div>
      <Space wrap>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
        {role === 'ADMIN' && applicationTournaments.length > 0 ? <Button onClick={() => openRequest()}>申请图片管理</Button> : null}
        {role === 'ROOT' ? <Button href={PHOTO_MANAGEMENT_REVIEW_PAGE}>图片管理申请</Button> : null}
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建活动</Button>
      </Space>
    </div>

    <Card size="small" style={{ marginBottom: 16 }}>
      <Space wrap size="middle">
        <Segmented
          options={[{ label: `全部 ${listedRows.length}`, value: 'ALL' }, { label: `赛事 ${listedRows.filter((item) => item.targetType === 'TOURNAMENT').length}`, value: 'TOURNAMENT' }, { label: `活动 ${listedRows.filter((item) => item.targetType === 'ACTIVITY').length}`, value: 'ACTIVITY' }]}
          value={typeFilter}
          onChange={(value) => setTypeFilter(value as 'ALL' | TargetType)}
        />
        {showActivityApproval ? (
          <Select
            aria-label="活动审核筛选"
            style={{ width: 160 }}
            value={activityApprovalFilter}
            onChange={(value) => setActivityApprovalFilter(value as 'ALL' | ApprovalStatus)}
            options={ACTIVITY_APPROVAL_FILTERS}
          />
        ) : null}
        {role === 'ROOT' ? (
          <Select
            aria-label="图片使用状态筛选"
            style={{ width: 176 }}
            value={usageFilter}
            onChange={(value) => setUsageFilter(value as UsageFilter)}
            options={USAGE_FILTERS}
          />
        ) : null}
        <Checkbox checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)}>包含已归档赛事</Checkbox>
      </Space>
    </Card>

    <Card><Table rowKey={targetKey} columns={columns} dataSource={filteredRows} loading={loading} scroll={{ x: (role === 'ROOT' ? 1236 : 994) + (showActivityApproval ? 96 : 0) }} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: '暂无匹配项目' }} /></Card>

    <Modal
      title="申请开通图片管理"
      open={requestOpen}
      onCancel={() => { if (!requestSaving) setRequestOpen(false); }}
      onOk={() => void requestAccess()}
      confirmLoading={requestSaving}
      okText="提交申请"
      okButtonProps={{ disabled: !canSubmitRequest || !requestPurpose.trim() }}
    >
      <Space orientation="vertical" style={{ width: '100%' }}>
        {requestTarget?.targetType === 'ACTIVITY' ? <Typography.Text strong>{requestTarget.title}</Typography.Text> : (
          <Select
            aria-label="选择赛事"
            placeholder="选择要申请的赛事"
            value={requestTargetKey}
            onChange={(key) => { setRequestTargetKey(key); setRequestPurpose(''); }}
            options={applicationTournaments.map((item) => ({
              label: `${item.title} · ${formatTime(item.startAt)}`,
              value: targetKey(item),
            }))}
            disabled={requestSaving}
            style={{ width: '100%' }}
          />
        )}
        {activeRequest ? (
          <Space wrap>
            <Tag color={PHOTO_MANAGEMENT_STATUS[activeRequest.status].color}>{PHOTO_MANAGEMENT_STATUS[activeRequest.status].label}</Tag>
            <Typography.Text type="secondary">{activeRequest.revokeReason ?? activeRequest.reviewReason}</Typography.Text>
          </Space>
        ) : null}
        {canSubmitRequest ? (
          <Input.TextArea aria-label="申请用途" placeholder="填写图片管理用途" value={requestPurpose} onChange={(event) => setRequestPurpose(event.target.value)} disabled={requestSaving} maxLength={500} showCount rows={4} />
        ) : null}
      </Space>
    </Modal>

    <Modal
      title="取消开通图片管理"
      open={role === 'ROOT' && !!revoking}
      onCancel={() => { if (!revokeSaving) setRevoking(null); }}
      onOk={() => void revokeAccess()}
      confirmLoading={revokeSaving}
      closable={!revokeSaving}
      cancelButtonProps={{ disabled: revokeSaving }}
      okText="确认取消开通"
      okButtonProps={{ danger: true, disabled: !revokeReason.trim() }}
    >
      <Typography.Paragraph strong>{revoking?.title}</Typography.Paragraph>
      <Typography.Paragraph>取消后，{revoking?.submittedBy?.username || '创建人'}将失去图片管理权限，已有图片会保留。需要恢复时可以重新申请。</Typography.Paragraph>
      <Input.TextArea aria-label="取消开通原因" placeholder="填写取消开通原因" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} disabled={revokeSaving} maxLength={500} showCount rows={3} />
    </Modal>

    <Modal title={editing ? '编辑活动图片' : '新建活动图片'} open={formOpen} onCancel={() => setFormOpen(false)} onOk={() => void save()} confirmLoading={saving} width={620} okText={role === 'ROOT' ? '保存' : '提交审核'} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ dateMode: 'SINGLE' }}>
        <Form.Item name="title" label="活动名称" rules={[{ required: true, message: '请输入活动名称' }, { max: 120 }]}><Input placeholder="例如：校园开放日" /></Form.Item>
        <Form.Item label={editing ? '活动封面（留空保持原封面）' : '活动封面'} required={!editing} extra="封面会经过图片 AI 审核，禁止包含二维码或违规内容。">
          <Upload.Dragger accept="image/*" maxCount={1} fileList={coverFiles} beforeUpload={() => false} onChange={(info) => setCoverFiles(info.fileList.slice(-1))} onRemove={() => { setCoverFiles([]); return true; }}>
            <p className="ant-upload-drag-icon"><UploadOutlined /></p><p className="ant-upload-text">点击或拖拽封面图片</p><p className="ant-upload-hint">单张不超过 15MB</p>
          </Upload.Dragger>
        </Form.Item>
        <Form.Item name="dateMode" label="日期方式" rules={[{ required: true }]}><Radio.Group optionType="button" buttonStyle="solid" options={[{ label: '指定日期', value: 'SINGLE' }, { label: '日期范围', value: 'RANGE' }]} /></Form.Item>
        {dateMode === 'RANGE' ? <Form.Item name="range" label="活动起止时间" rules={[{ required: true, message: '请选择起止时间' }]}><DatePicker.RangePicker showTime={{ format: 'HH:mm:ss' }} format="YYYY-MM-DD HH:mm:ss" style={{ width: '100%' }} /></Form.Item> : <Form.Item name="startAt" label="活动时间" rules={[{ required: true, message: '请选择活动时间' }]}><DatePicker showTime={{ format: 'HH:mm:ss' }} format="YYYY-MM-DD HH:mm:ss" style={{ width: '100%' }} /></Form.Item>}
      </Form>
    </Modal>

    <Modal title={rejecting ? `驳回：${rejecting.title}` : '驳回活动'} open={!!rejecting} onCancel={() => setRejecting(null)} onOk={() => void reject()} okButtonProps={{ danger: true, disabled: !rejectReason.trim() }} okText="确认驳回"><Input.TextArea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={500} showCount rows={4} placeholder="填写驳回原因" /></Modal>

    <Modal
      title={deletingTournamentPhotos ? '删除赛事图片' : '删除活动'}
      open={role === 'ROOT' && !!deleting}
      onCancel={() => { if (!deleteLoading) closeDelete(); }}
      onOk={() => void deleteTarget()}
      confirmLoading={deleteLoading}
      closable={!deleteLoading}
      cancelButtonProps={{ disabled: deleteLoading }}
      okText={deletingTournamentPhotos ? '删除全部图片' : '永久删除'}
      okButtonProps={{ danger: true, disabled: !deleting || deleteInput.trim() !== deleting.title }}
    >
      <Typography.Paragraph>
        {deletingTournamentPhotos
          ? '此操作会永久清空该赛事相册中的原图、水印版和缩略图。'
          : '此操作会永久删除活动、封面、Logo、全部图片、二维码和操作记录，无法恢复。'}
      </Typography.Paragraph>
      <Typography.Paragraph>请输入完整{deleteTargetLabel}名称 <Typography.Text code>{deleting?.title}</Typography.Text> 确认删除。</Typography.Paragraph>
      <Input aria-label={`${deleteTargetLabel}名称`} value={deleteInput} onChange={(event) => setDeleteInput(event.target.value)} placeholder={`输入完整${deleteTargetLabel}名称`} />
    </Modal>

    <Modal title={qr ? `${qr.title} · 图片二维码` : '图片二维码'} open={!!qr} onCancel={() => setQr(undefined)} footer={null} width={440}>
      {qr ? <Space direction="vertical" size={18} style={{ width: '100%', alignItems: 'center' }}>
        <div ref={qrRef} style={{ padding: 12, background: '#fff', borderRadius: 12 }}><QRCode type="canvas" value={qr.url} size={260} bordered={false} /></div>
        <Typography.Text type="secondary">扫码后先显示封面，点击进入照片墙。</Typography.Text>
        <Input value={qr.url} readOnly addonAfter={<CopyOutlined onClick={() => void copyQr()} />} />
        <Space><Button icon={<CopyOutlined />} onClick={() => void copyQr()}>复制地址</Button><Button type="primary" icon={<DownloadOutlined />} onClick={downloadQr}>下载二维码</Button></Space>
      </Space> : null}
    </Modal>
  </div>;
}
