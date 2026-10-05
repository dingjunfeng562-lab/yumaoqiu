'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import dayjs, { Dayjs } from 'dayjs';
import { Button, Card, DatePicker, Form, Image, Input, Modal, QRCode, Radio, Space, Table, Tag, Typography, Upload, message } from 'antd';
import type { UploadFile } from 'antd';
import { CheckOutlined, CopyOutlined, DownloadOutlined, EditOutlined, PictureOutlined, PlusOutlined, QrcodeOutlined, SafetyCertificateOutlined, StopOutlined, UploadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { useCurrentRole } from '@/lib/use-current-role';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, '');

type Activity = {
  id: string;
  title: string;
  coverImageUrl: string | null;
  dateMode: 'SINGLE' | 'RANGE';
  startAt: string;
  endAt: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason: string | null;
  submittedBy?: { username: string | null };
  photoCount: number;
  photoAccessEnabled: boolean;
};

type ActivityForm = {
  title: string;
  dateMode: 'SINGLE' | 'RANGE';
  startAt?: Dayjs;
  range?: [Dayjs, Dayjs];
};

const STATUS = {
  PENDING: { color: 'orange', label: '待审核' },
  APPROVED: { color: 'green', label: '已通过' },
  REJECTED: { color: 'red', label: '已驳回' },
} as const;

function fullUrl(path?: string | null) {
  if (!path) return '';
  return path.startsWith('/api/') ? `${API_ORIGIN}${path}` : path;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export default function PhotoActivitiesPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;
  const role = useCurrentRole();
  const [form] = Form.useForm<ActivityForm>();
  const dateMode = Form.useWatch('dateMode', form) ?? 'SINGLE';
  const [rows, setRows] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverFiles, setCoverFiles] = useState<UploadFile[]>([]);
  const [rejecting, setRejecting] = useState<Activity | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [qr, setQr] = useState<{ title: string; url: string }>();
  const [qrLoading, setQrLoading] = useState<string>();
  const qrRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try { setRows(await apiFetch<Activity[]>('/admin/photo-activities', { token })); }
    catch (error) { message.error(error instanceof Error ? error.message : '活动图片加载失败'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setCoverFiles([]);
    form.setFieldsValue({ title: '', dateMode: 'SINGLE', startAt: dayjs().millisecond(0), range: undefined });
    setFormOpen(true);
  }

  function openEdit(item: Activity) {
    setEditing(item);
    setCoverFiles([]);
    form.setFieldsValue({
      title: item.title,
      dateMode: item.dateMode,
      startAt: item.dateMode === 'SINGLE' ? dayjs(item.startAt) : undefined,
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

  async function approve(item: Activity) {
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

  async function showQr(item: Activity) {
    if (!token) return;
    setQrLoading(item.id);
    try {
      const data = await apiFetch<{ path: string }>(`/admin/photo-activities/${item.id}/photo-access`, { method: 'POST', token, body: '{}' });
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
    const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = `${qr.title}-活动图片二维码.png`; link.click();
  }

  const columns = [
    { title: '封面', dataIndex: 'coverImageUrl', width: 96, render: (value: string | null) => value ? <Image alt="活动封面" src={fullUrl(value)} width={72} height={48} style={{ objectFit: 'cover', borderRadius: 6 }} /> : '—' },
    { title: '活动名称', dataIndex: 'title', render: (value: string, item: Activity) => <Space direction="vertical" size={0}><Typography.Text strong>{value}</Typography.Text>{item.rejectReason ? <Typography.Text type="danger" style={{ fontSize: 12 }}>驳回原因：{item.rejectReason}</Typography.Text> : null}</Space> },
    { title: '活动时间', key: 'time', width: 230, render: (_: unknown, item: Activity) => item.dateMode === 'RANGE' && item.endAt ? `${formatTime(item.startAt)} — ${formatTime(item.endAt)}` : formatTime(item.startAt) },
    ...(role === 'ROOT' ? [{ title: '创建人', key: 'creator', width: 120, render: (_: unknown, item: Activity) => item.submittedBy?.username ?? '—' }] : []),
    { title: '审核状态', dataIndex: 'approvalStatus', width: 100, render: (value: Activity['approvalStatus']) => <Tag color={STATUS[value].color}>{STATUS[value].label}</Tag> },
    { title: '图片', dataIndex: 'photoCount', width: 80, render: (value: number) => `${value} 张` },
    { title: '操作', key: 'actions', width: 430, render: (_: unknown, item: Activity) => <Space wrap>
      <Button icon={<EditOutlined />} onClick={() => openEdit(item)}>编辑</Button>
      <Button icon={<SafetyCertificateOutlined />} onClick={() => router.push(`/admin/photo-activities/${item.id}/watermark`)}>Logo 设置</Button>
      <Button type="primary" icon={<PictureOutlined />} onClick={() => router.push(`/admin/photo-activities/${item.id}/photos`)}>图片管理</Button>
      <Button icon={<QrcodeOutlined />} loading={qrLoading === item.id} disabled={item.approvalStatus !== 'APPROVED'} title={item.approvalStatus !== 'APPROVED' ? '审核通过后才能生成二维码' : undefined} onClick={() => void showQr(item)}>{item.photoAccessEnabled ? '查看二维码' : '生成二维码'}</Button>
      {role === 'ROOT' && item.approvalStatus !== 'APPROVED' ? <Button icon={<CheckOutlined />} onClick={() => void approve(item)}>通过</Button> : null}
      {role === 'ROOT' && item.approvalStatus !== 'REJECTED' ? <Button danger icon={<StopOutlined />} onClick={() => setRejecting(item)}>驳回</Button> : null}
    </Space> },
  ];

  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 16 }}>
      <div><Typography.Title level={4} style={{ margin: 0 }}>活动图片</Typography.Title><Typography.Text type="secondary">独立活动照片墙、Logo 水印、AI 图片审核和二维码访问</Typography.Text></div>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建活动</Button>
    </div>
    <Card><Table rowKey="id" columns={columns} dataSource={rows} loading={loading} scroll={{ x: 1080 }} pagination={{ pageSize: 10 }} /></Card>

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

    <Modal title={qr ? `${qr.title} · 活动图片二维码` : '活动图片二维码'} open={!!qr} onCancel={() => setQr(undefined)} footer={null} width={440}>
      {qr ? <Space direction="vertical" size={18} style={{ width: '100%', alignItems: 'center' }}>
        <div ref={qrRef} style={{ padding: 12, background: '#fff', borderRadius: 12 }}><QRCode type="canvas" value={qr.url} size={260} bordered={false} /></div>
        <Typography.Text type="secondary">扫码后先显示活动封面，点击进入照片墙。</Typography.Text>
        <Input value={qr.url} readOnly addonAfter={<CopyOutlined onClick={() => void copyQr()} />} />
        <Space><Button icon={<CopyOutlined />} onClick={() => void copyQr()}>复制地址</Button><Button type="primary" icon={<DownloadOutlined />} onClick={downloadQr}>下载二维码</Button></Space>
      </Space> : null}
    </Modal>
  </div>;
}
