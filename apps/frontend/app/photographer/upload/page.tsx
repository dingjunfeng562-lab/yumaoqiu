'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Progress,
  Radio,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CloudUploadOutlined,
  DeleteOutlined,
  InboxOutlined,
  PictureOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const MAX_FILES = 20;
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED = /^image\/(png|jpe?g)$/;

const CATEGORIES = [
  { value: 'PLAYER', label: '选手证件照' },
  { value: 'MATCH', label: '比赛现场照' },
  { value: 'AWARD', label: '颁奖照片' },
] as const;

type CategoryValue = (typeof CATEGORIES)[number]['value'];

type Tournament = {
  id: string;
  name: string;
  edition: number;
  startDate: string;
  endDate: string;
};

type QueueStatus = 'pending' | 'uploading' | 'processing' | 'done' | 'error';

type QueueItem = {
  id: string;
  file: File;
  previewUrl: string;
  status: QueueStatus;
  progress: number;
  error?: string;
};

type SessionItem = {
  id: string;
  previewUrl: string;
  tournamentName: string;
  categoryLabel: string;
  uploadedAt: string;
};

const STATUS_META: Record<QueueStatus, { color: string; label: string }> = {
  pending: { color: 'default', label: '等待中' },
  uploading: { color: 'processing', label: '上传中' },
  processing: { color: 'warning', label: '处理中' },
  done: { color: 'success', label: '已完成' },
  error: { color: 'error', label: '失败' },
};

function formatDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('zh-CN');
}

function categoryLabel(value: CategoryValue) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

let idSeq = 0;
function nextId() {
  idSeq += 1;
  return `q_${Date.now()}_${idSeq}`;
}

export default function PhotographerUploadPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentId, setTournamentId] = useState<string | undefined>();
  const [category, setCategory] = useState<CategoryValue | undefined>();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [sessionItems, setSessionItems] = useState<SessionItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedTournament = useMemo(
    () => tournaments.find((t) => t.id === tournamentId),
    [tournaments, tournamentId],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/photographer/tournaments`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('赛事加载失败');
        const data = (await res.json()) as Tournament[];
        if (!cancelled) setTournaments(data);
      } catch {
        if (!cancelled) message.error('赛事列表加载失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Revoke object URLs on unmount to avoid leaks.
  useEffect(() => {
    return () => {
      queue.forEach((q) => URL.revokeObjectURL(q.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = Boolean(tournamentId && category);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      const accepted: File[] = [];
      let rejectedType = 0;
      let rejectedSize = 0;
      for (const f of incoming) {
        if (!ACCEPTED.test(f.type)) {
          rejectedType += 1;
          continue;
        }
        if (f.size > MAX_FILE_SIZE) {
          rejectedSize += 1;
          continue;
        }
        accepted.push(f);
      }
      if (rejectedType) message.warning(`已忽略 ${rejectedType} 个非 JPG/PNG 文件`);
      if (rejectedSize) message.warning(`已忽略 ${rejectedSize} 个超过 ${MAX_FILE_SIZE_MB}MB 的文件`);

      setQueue((prev) => {
        const remaining = MAX_FILES - prev.length;
        if (remaining <= 0) {
          message.warning('每批最多上传 20 张,请分批上传或减少选择数量');
          return prev;
        }
        if (accepted.length > remaining) {
          message.warning('每批最多上传 20 张,请分批上传或减少选择数量');
        }
        const slice = accepted.slice(0, remaining).map<QueueItem>((file) => ({
          id: nextId(),
          file,
          previewUrl: URL.createObjectURL(file),
          status: 'pending',
          progress: 0,
        }));
        return [...prev, ...slice];
      });
    },
    [],
  );

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  }

  function removeItem(id: string) {
    setQueue((prev) => {
      const target = prev.find((q) => q.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((q) => q.id !== id);
    });
  }

  const uploadOne = useCallback(
    (item: QueueItem) =>
      new Promise<boolean>((resolve) => {
        if (!token || !tournamentId || !category) {
          resolve(false);
          return;
        }
        const form = new FormData();
        form.append('tournamentId', tournamentId);
        form.append('category', category);
        form.append('photos', item.file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/photographer/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          const pct = Math.round((ev.loaded / ev.total) * 100);
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? { ...q, status: pct >= 100 ? 'processing' : 'uploading', progress: pct }
                : q,
            ),
          );
        };

        xhr.onload = () => {
          let ok = false;
          let reason = '处理失败';
          try {
            const res = JSON.parse(xhr.responseText) as {
              uploaded?: number;
              failed?: Array<{ name: string; reason: string }>;
            };
            ok = xhr.status >= 200 && xhr.status < 300 && (res.uploaded ?? 0) >= 1;
            if (!ok && res.failed?.length) reason = res.failed[0].reason;
          } catch {
            ok = false;
          }
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? { ...q, status: ok ? 'done' : 'error', progress: 100, error: ok ? undefined : reason }
                : q,
            ),
          );
          resolve(ok);
        };

        xhr.onerror = () => {
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id ? { ...q, status: 'error', error: '网络错误' } : q,
            ),
          );
          resolve(false);
        };

        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: 'uploading', progress: 0 } : q)),
        );
        xhr.send(form);
      }),
    [token, tournamentId, category],
  );

  // Bounded-concurrency runner over a set of queue items.
  const runUploads = useCallback(
    async (items: QueueItem[]) => {
      if (!items.length) return;
      setUploading(true);
      const CONCURRENCY = 3;
      let cursor = 0;
      let success = 0;
      const worker = async () => {
        while (cursor < items.length) {
          const current = items[cursor];
          cursor += 1;
          // eslint-disable-next-line no-await-in-loop
          const ok = await uploadOne(current);
          if (ok) success += 1;
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
      setUploading(false);

      if (success > 0) {
        message.success(`成功上传 ${success} 张图片`);
        const now = new Date().toISOString();
        const tName = selectedTournament?.name ?? '';
        const cLabel = category ? categoryLabel(category) : '';
        setQueue((prev) => {
          const doneItems = prev.filter((q) => items.some((i) => i.id === q.id) && q.status === 'done');
          setSessionItems((s) => [
            ...doneItems.map<SessionItem>((d) => ({
              id: d.id,
              previewUrl: d.previewUrl,
              tournamentName: tName,
              categoryLabel: cLabel,
              uploadedAt: now,
            })),
            ...s,
          ]);
          // Keep failed items for retry; drop the succeeded ones from the queue.
          return prev.filter((q) => !(items.some((i) => i.id === q.id) && q.status === 'done'));
        });
      }
    },
    [uploadOne, selectedTournament, category],
  );

  function startUpload() {
    const pending = queue.filter((q) => q.status === 'pending' || q.status === 'error');
    if (!pending.length) {
      message.info('没有待上传的图片');
      return;
    }
    void runUploads(pending);
  }

  function retryItem(item: QueueItem) {
    void runUploads([item]);
  }

  const pendingCount = queue.filter((q) => q.status === 'pending' || q.status === 'error').length;
  const doneCount = queue.filter((q) => q.status === 'done').length;

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        现场图片上传
      </Typography.Title>

      {/* Step 1: tournament */}
      <Card size="small" title="第一步:选择赛事" style={{ marginBottom: 12 }}>
        <Select
          style={{ width: '100%', maxWidth: 480 }}
          placeholder="请选择本届 / 历届赛事"
          value={tournamentId}
          onChange={setTournamentId}
          options={tournaments.map((t) => ({
            value: t.id,
            label: `${t.name}(${formatDate(t.startDate)} - ${formatDate(t.endDate)})`,
          }))}
          showSearch
          optionFilterProp="label"
        />
      </Card>

      {/* Step 2: category */}
      <Card size="small" title="第二步:选择分类" style={{ marginBottom: 12 }}>
        <Radio.Group
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          optionType="button"
          buttonStyle="solid"
          options={CATEGORIES.map((c) => ({ label: c.label, value: c.value }))}
        />
      </Card>

      {/* Step 3: upload */}
      <Card size="small" title="第三步:上传图片" style={{ marginBottom: 12 }}>
        {!ready && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="请先选择赛事和分类后再上传图片"
          />
        )}
        <div
          role="button"
          tabIndex={0}
          onClick={() => ready && fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (ready && (e.key === 'Enter' || e.key === ' ')) fileInputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (ready) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (ready && e.dataTransfer.files) addFiles(e.dataTransfer.files);
          }}
          style={{
            border: `2px dashed ${dragOver ? '#0a5dd1' : '#d0d7e2'}`,
            borderRadius: 8,
            padding: '32px 16px',
            textAlign: 'center',
            background: ready ? (dragOver ? '#eef4ff' : '#fafcff') : '#f5f5f5',
            cursor: ready ? 'pointer' : 'not-allowed',
            opacity: ready ? 1 : 0.6,
          }}
        >
          <InboxOutlined style={{ fontSize: 40, color: '#0a5dd1' }} />
          <div style={{ marginTop: 8 }}>
            <Typography.Text strong>点击选择或拖拽图片到此处</Typography.Text>
          </div>
          <Typography.Text type="secondary">
            支持 JPG / PNG,单张 ≤ {MAX_FILE_SIZE_MB}MB,每批最多 {MAX_FILES} 张
          </Typography.Text>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            multiple
            hidden
            onChange={onPick}
          />
        </div>

        {queue.length > 0 && (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                margin: '16px 0 8px',
              }}
            >
              <Space>
                <Typography.Text>
                  待上传 {pendingCount} 张{doneCount ? ` · 已完成 ${doneCount} 张` : ''}(共 {queue.length}/{MAX_FILES})
                </Typography.Text>
              </Space>
              <Space>
                <Button onClick={() => setQueue([])} disabled={uploading}>
                  清空
                </Button>
                <Button
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  loading={uploading}
                  onClick={startUpload}
                  disabled={!ready || pendingCount === 0}
                >
                  开始上传
                </Button>
              </Space>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: 12,
              }}
            >
              {queue.map((item) => {
                const meta = STATUS_META[item.status];
                return (
                  <div
                    key={item.id}
                    style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', background: '#fff' }}
                  >
                    <div style={{ position: 'relative', paddingTop: '75%', background: '#f0f2f5' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.previewUrl}
                        alt={item.file.name}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                      {item.status === 'pending' && (
                        <Button
                          size="small"
                          danger
                          type="text"
                          icon={<DeleteOutlined />}
                          onClick={() => removeItem(item.id)}
                          style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(255,255,255,0.8)' }}
                        />
                      )}
                    </div>
                    <div style={{ padding: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                        <Tag color={meta.color} style={{ margin: 0 }}>
                          {meta.label}
                          {item.status === 'uploading' ? ` ${item.progress}%` : ''}
                        </Tag>
                        {item.status === 'error' && (
                          <Button
                            size="small"
                            type="link"
                            icon={<ReloadOutlined />}
                            onClick={() => retryItem(item)}
                          >
                            重试
                          </Button>
                        )}
                      </div>
                      {(item.status === 'uploading' || item.status === 'processing') && (
                        <Progress
                          percent={item.progress}
                          size="small"
                          status={item.status === 'processing' ? 'active' : 'normal'}
                          showInfo={false}
                          style={{ marginTop: 4 }}
                        />
                      )}
                      {item.status === 'error' && item.error && (
                        <Typography.Text type="danger" style={{ fontSize: 12 }}>
                          {item.error}
                        </Typography.Text>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* Session uploads */}
      <Card
        size="small"
        title={
          <Space>
            <PictureOutlined />
            本次会话已上传
          </Space>
        }
      >
        {sessionItems.length === 0 ? (
          <Empty description="尚未上传图片" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 12,
            }}
          >
            {sessionItems.map((item) => (
              <div key={item.id} style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ position: 'relative', paddingTop: '75%', background: '#f0f2f5' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.previewUrl}
                    alt="已上传"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <div style={{ padding: 8 }}>
                  <Typography.Text style={{ fontSize: 12, display: 'block' }} ellipsis>
                    {item.tournamentName}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {item.categoryLabel} · {new Date(item.uploadedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                  </Typography.Text>
                  <div style={{ marginTop: 4 }}>
                    <Tooltip title="请联系管理员删除">
                      <Button size="small" icon={<DeleteOutlined />} disabled block>
                        删除
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
