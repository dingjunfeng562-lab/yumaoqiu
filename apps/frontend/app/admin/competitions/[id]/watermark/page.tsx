'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Button, Card, Empty, Space, Spin, Typography, Upload, message } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, '');
const MAX_LOGOS = 5;

type Logo = { order: number; path: string; filename?: string; url: string };
type WatermarkConfig = { tournamentId: string; logos: Logo[]; updatedAt: string | null };

export default function WatermarkSettingsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;

  const [logos, setLogos] = useState<Logo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const data = await apiFetch<WatermarkConfig>(`/admin/tournaments/${id}/watermark`, { token });
      setLogos(data.logos);
      setDirty(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '水印配置加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadLogo(file: File) {
    if (!token || !id) return;
    if (file.type !== 'image/png') {
      message.error('Logo 必须为 PNG 格式');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      message.error('Logo 文件需小于 5MB');
      return;
    }
    if (logos.length >= MAX_LOGOS) {
      message.warning('最多只能添加 5 个 Logo');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/admin/tournaments/${id}/watermark/logos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: '上传失败' }));
        throw new Error(err.message ?? '上传失败');
      }
      const data = (await res.json()) as WatermarkConfig;
      setLogos(data.logos);
      setDirty(false);
      message.success('Logo 已添加');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function deleteLogo(logo: Logo) {
    if (!token || !id) return;
    try {
      const data = await apiFetch<WatermarkConfig>(`/admin/tournaments/${id}/watermark/logos`, {
        method: 'DELETE',
        token,
        body: JSON.stringify({ path: logo.path }),
      });
      setLogos(data.logos);
      setDirty(false);
      message.success('Logo 已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  function move(index: number, dir: -1 | 1) {
    setLogos((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((l, i) => ({ ...l, order: i + 1 }));
    });
    setDirty(true);
  }

  async function save() {
    if (!token || !id) return;
    setSaving(true);
    try {
      const data = await apiFetch<WatermarkConfig>(`/admin/tournaments/${id}/watermark`, {
        method: 'PUT',
        token,
        body: JSON.stringify({
          logos: logos.map((l, i) => ({ order: i + 1, path: l.path, filename: l.filename })),
        }),
      });
      setLogos(data.logos);
      setDirty(false);
      message.success('水印设置已保存,将应用于后续上传的图片');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  const previewLogos = useMemo(() => logos, [logos]);

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/admin/competitions')}>
          返回赛事管理
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          水印设置
        </Typography.Title>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="第 1 个为赛事主 Logo,其余为赞助商 Logo,展示时以「×」连接。最多 5 个,仅支持透明背景 PNG(< 5MB)。"
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <Card title="Logo 列表" style={{ flex: '1 1 420px', minWidth: 320 }} loading={loading}>
          <Upload
            accept="image/png"
            showUploadList={false}
            beforeUpload={(file) => {
              void uploadLogo(file as File);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={uploading} disabled={logos.length >= MAX_LOGOS}>
              添加 Logo({logos.length}/{MAX_LOGOS})
            </Button>
          </Upload>

          <div style={{ marginTop: 16 }}>
            {logos.length === 0 ? (
              <Empty description="暂无 Logo" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }}>
                {logos.map((logo, index) => (
                  <div
                    key={logo.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: 8,
                      border: '1px solid #eee',
                      borderRadius: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 64,
                        height: 48,
                        background:
                          'repeating-conic-gradient(#e9edf5 0% 25%, #fff 0% 50%) 50% / 12px 12px',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`${API_ORIGIN}${logo.url}`}
                        alt={logo.filename ?? 'logo'}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text strong>
                        {index === 0 ? '赛事主 Logo' : `赞助商 Logo ${index}`}
                      </Typography.Text>
                      <Typography.Paragraph type="secondary" ellipsis style={{ margin: 0, fontSize: 12 }}>
                        {logo.filename ?? logo.path.split('/').pop()}
                      </Typography.Paragraph>
                    </div>
                    <Space>
                      <Button
                        size="small"
                        icon={<ArrowUpOutlined />}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      />
                      <Button
                        size="small"
                        icon={<ArrowDownOutlined />}
                        disabled={index === logos.length - 1}
                        onClick={() => move(index, 1)}
                      />
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => deleteLogo(logo)}
                      />
                    </Space>
                  </div>
                ))}
              </Space>
            )}
          </div>

          <div style={{ marginTop: 16 }}>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!dirty}
              onClick={save}
            >
              保存设置
            </Button>
            {dirty && (
              <Typography.Text type="warning" style={{ marginLeft: 12 }}>
                顺序有改动,请保存
              </Typography.Text>
            )}
          </div>
        </Card>

        <Card title="效果预览" style={{ flex: '1 1 420px', minWidth: 320 }}>
          <div
            style={{
              position: 'relative',
              width: '100%',
              paddingTop: '60%',
              borderRadius: 8,
              overflow: 'hidden',
              background: 'linear-gradient(135deg, #1f6feb, #0a2a66)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                opacity: 0.85,
              }}
            >
              {previewLogos.length === 0 ? (
                <Typography.Text style={{ color: 'rgba(255,255,255,0.7)' }}>
                  未配置 Logo
                </Typography.Text>
              ) : (
                previewLogos.map((logo, index) => (
                  <span key={logo.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    {index > 0 && (
                      <span style={{ color: '#fff', fontSize: 22, fontFamily: 'sans-serif' }}>×</span>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${API_ORIGIN}${logo.url}`}
                      alt={logo.filename ?? 'logo'}
                      style={{ height: 30, objectFit: 'contain' }}
                    />
                  </span>
                ))
              )}
            </div>
            <Typography.Text
              style={{ position: 'absolute', bottom: 12, left: 16, color: 'rgba(255,255,255,0.65)' }}
            >
              示例照片 —— 水印显示在右上角
            </Typography.Text>
          </div>
          {loading && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Spin />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
