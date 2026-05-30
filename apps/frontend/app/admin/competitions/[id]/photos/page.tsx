'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Button,
  Card,
  Checkbox,
  DatePicker,
  Empty,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileSearchOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, '');
const PAGE_SIZE = 30;

type Uploader = { id: string; username: string | null };
type AdminPhoto = {
  id: string;
  category: 'PLAYER' | 'MATCH' | 'AWARD';
  url: string;
  thumbUrl: string;
  originalUrl: string;
  fileSize: number;
  width: number;
  height: number;
  uploadedAt: string;
  uploader: Uploader | null;
};
type PhotoPage = { total: number; page: number; pageSize: number; items: AdminPhoto[] };
type OpLog = {
  id: string;
  photoId: string | null;
  action: string;
  operator: string | null;
  detail: unknown;
  createdAt: string;
};

const CATEGORY_OPTIONS = [
  { label: '全部', value: 'ALL' },
  { label: '选手照', value: 'PLAYER' },
  { label: '现场照', value: 'MATCH' },
  { label: '颁奖照', value: 'AWARD' },
];

const CATEGORY_LABEL: Record<AdminPhoto['category'], string> = {
  PLAYER: '选手照',
  MATCH: '现场照',
  AWARD: '颁奖照',
};

const ACTION_LABEL: Record<string, string> = {
  VIEW_ORIGINAL: '查看原图',
  DELETE_PHOTO: '删除图片',
  BATCH_DELETE: '批量删除',
  DELETE_TOURNAMENT_PHOTOS: '删除整届图片',
};

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDateTime(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('zh-CN', { hour12: false });
}

export default function AdminPhotosPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;

  const [title, setTitle] = useState('当前赛事');
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [category, setCategory] = useState('ALL');
  const [uploaderId, setUploaderId] = useState<string | undefined>();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<OpLog[]>([]);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeInput, setPurgeInput] = useState('');
  const [purging, setPurging] = useState(false);

  // Uploader options accumulated from loaded photos.
  const [uploaderOptions, setUploaderOptions] = useState<Uploader[]>([]);

  useEffect(() => {
    if (!token || !id) return;
    apiFetch<Array<{ id: string; title: string }>>('/admin/competitions', { token })
      .then((list) => {
        const found = list.find((c) => c.id === id);
        if (found) setTitle(found.title);
      })
      .catch(() => undefined);
  }, [token, id]);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const params2 = new URLSearchParams({
        tournamentId: id,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (category !== 'ALL') params2.set('category', category);
      if (uploaderId) params2.set('uploaderId', uploaderId);
      if (range.from) params2.set('from', range.from);
      if (range.to) params2.set('to', range.to);
      const data = await apiFetch<PhotoPage>(`/admin/photos?${params2.toString()}`, { token });
      setPhotos(data.items);
      setTotal(data.total);
      setSelected(new Set());
      // Merge any new uploaders into the filter options.
      setUploaderOptions((prev) => {
        const map = new Map(prev.map((u) => [u.id, u]));
        data.items.forEach((p) => {
          if (p.uploader) map.set(p.uploader.id, p.uploader);
        });
        return Array.from(map.values());
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, id, page, category, uploaderId, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset to page 1 when filters change.
  useEffect(() => {
    setPage(1);
  }, [category, uploaderId, range.from, range.to]);

  function toggle(photoId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  async function viewOriginal(photo: AdminPhoto) {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/admin/photos/${photo.id}/original`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('无法获取原图');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank');
      // Revoke a bit later so the new tab has time to load.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '获取原图失败');
    }
  }

  async function deleteOne(photo: AdminPhoto) {
    if (!token) return;
    try {
      await apiFetch(`/admin/photos/${photo.id}`, { method: 'DELETE', token });
      message.success('已删除');
      void load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  async function deleteSelected() {
    if (!token || selected.size === 0) return;
    try {
      await apiFetch('/admin/photos', {
        method: 'DELETE',
        token,
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      message.success(`已删除 ${selected.size} 张图片`);
      void load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '批量删除失败');
    }
  }

  async function purgeTournament() {
    if (!token || !id) return;
    setPurging(true);
    try {
      const res = await apiFetch<{ deleted: number }>(`/admin/tournaments/${id}/photos`, {
        method: 'DELETE',
        token,
        body: JSON.stringify({ confirmName: purgeInput }),
      });
      message.success(`已删除整届图片(${res.deleted} 张)`);
      setPurgeOpen(false);
      setPurgeInput('');
      void load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setPurging(false);
    }
  }

  async function openLogs() {
    if (!token || !id) return;
    setLogsOpen(true);
    try {
      const data = await apiFetch<OpLog[]>(`/admin/tournaments/${id}/photo-logs`, { token });
      setLogs(data);
    } catch {
      message.error('日志加载失败');
    }
  }

  const allSelected = photos.length > 0 && photos.every((p) => selected.has(p.id));

  const logColumns = useMemo(
    () => [
      { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 180, render: (v: string) => formatDateTime(v) },
      { title: '操作人', dataIndex: 'operator', key: 'operator', width: 120, render: (v: string | null) => v ?? '—' },
      {
        title: '操作',
        dataIndex: 'action',
        key: 'action',
        width: 120,
        render: (v: string) => <Tag>{ACTION_LABEL[v] ?? v}</Tag>,
      },
      {
        title: '详情',
        dataIndex: 'detail',
        key: 'detail',
        render: (v: unknown) => (v ? <Typography.Text type="secondary">{JSON.stringify(v)}</Typography.Text> : '—'),
      },
    ],
    [],
  );

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/admin/competitions')}>
          返回赛事管理
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          图片管理 · {title}
        </Typography.Title>
      </Space>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size="middle">
          <Segmented
            options={CATEGORY_OPTIONS}
            value={category}
            onChange={(v) => setCategory(String(v))}
          />
          <Select
            allowClear
            placeholder="上传人"
            style={{ width: 180 }}
            value={uploaderId}
            onChange={setUploaderId}
            options={uploaderOptions.map((u) => ({ value: u.id, label: u.username ?? u.id }))}
          />
          <DatePicker.RangePicker
            showTime
            onChange={(values) => {
              const v = values as unknown as Array<{ toISOString: () => string } | null> | null;
              setRange({
                from: v?.[0]?.toISOString(),
                to: v?.[1]?.toISOString(),
              });
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
          <Button icon={<FileSearchOutlined />} onClick={openLogs}>
            操作日志
          </Button>
        </Space>
      </Card>

      <Space style={{ marginBottom: 12 }} wrap>
        <Checkbox
          checked={allSelected}
          indeterminate={selected.size > 0 && !allSelected}
          onChange={(e) => {
            if (e.target.checked) setSelected(new Set(photos.map((p) => p.id)));
            else setSelected(new Set());
          }}
        >
          全选本页
        </Checkbox>
        <Popconfirm
          title={`确认删除选中的 ${selected.size} 张图片?`}
          onConfirm={deleteSelected}
          disabled={selected.size === 0}
        >
          <Button danger icon={<DeleteOutlined />} disabled={selected.size === 0}>
            批量删除({selected.size})
          </Button>
        </Popconfirm>
        <Button danger type="primary" icon={<DeleteOutlined />} onClick={() => setPurgeOpen(true)}>
          删除整届图片
        </Button>
        <Typography.Text type="secondary">共 {total} 张</Typography.Text>
      </Space>

      {photos.length === 0 && !loading ? (
        <Empty description="暂无图片" style={{ padding: 48 }} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          {photos.map((photo) => (
            <Card
              key={photo.id}
              size="small"
              styles={{ body: { padding: 8 } }}
              style={{ border: selected.has(photo.id) ? '2px solid #1677ff' : undefined }}
            >
              <div style={{ position: 'relative', paddingTop: '70%', background: '#f0f2f5', borderRadius: 6, overflow: 'hidden' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${API_ORIGIN}${photo.thumbUrl}`}
                  alt={CATEGORY_LABEL[photo.category]}
                  loading="lazy"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <Checkbox
                  checked={selected.has(photo.id)}
                  onChange={() => toggle(photo.id)}
                  style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(255,255,255,0.85)', borderRadius: 4, padding: 2 }}
                />
                <Tag
                  color="blue"
                  style={{ position: 'absolute', top: 6, right: 6, margin: 0 }}
                >
                  {CATEGORY_LABEL[photo.category]}
                </Tag>
              </div>
              <div style={{ marginTop: 6 }}>
                <Typography.Text style={{ fontSize: 12, display: 'block' }}>
                  {formatDateTime(photo.uploadedAt)}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {photo.uploader?.username ?? '未知'} · {formatSize(photo.fileSize)}
                </Typography.Text>
              </div>
              <Space style={{ marginTop: 6 }} size={4}>
                <Button size="small" icon={<EyeOutlined />} onClick={() => viewOriginal(photo)}>
                  原图
                </Button>
                <Popconfirm title="确认删除该图片?" onConfirm={() => deleteOne(photo)}>
                  <Button size="small" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            </Card>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Pagination
            current={page}
            total={total}
            pageSize={PAGE_SIZE}
            showSizeChanger={false}
            onChange={setPage}
          />
        </div>
      )}

      <Modal
        title="删除整届图片"
        open={purgeOpen}
        onCancel={() => {
          setPurgeOpen(false);
          setPurgeInput('');
        }}
        onOk={purgeTournament}
        okButtonProps={{ danger: true, disabled: purgeInput.trim() !== title, loading: purging }}
        okText="确认删除"
        cancelText="取消"
      >
        <Typography.Paragraph>
          此操作将永久删除本届赛事的<b>全部图片</b>(原图、水印版与缩略图),不可恢复。
        </Typography.Paragraph>
        <Typography.Paragraph>
          请输入赛事名称 <Typography.Text code>{title}</Typography.Text> 以确认:
        </Typography.Paragraph>
        <Input.TextArea
          autoSize
          value={purgeInput}
          onChange={(e) => setPurgeInput(e.target.value)}
          placeholder="输入赛事名称"
        />
      </Modal>

      <Modal
        title="操作日志(近 90 天)"
        open={logsOpen}
        onCancel={() => setLogsOpen(false)}
        footer={null}
        width={720}
      >
        <Table
          rowKey="id"
          size="small"
          columns={logColumns}
          dataSource={logs}
          pagination={{ pageSize: 10 }}
        />
      </Modal>
    </div>
  );
}
