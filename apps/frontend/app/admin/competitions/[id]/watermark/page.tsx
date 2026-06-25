'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Button,
  Card,
  Empty,
  InputNumber,
  Radio,
  Slider,
  Space,
  Spin,
  Typography,
  Upload,
  message,
} from 'antd';
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
const DEFAULT_LOGO_PERCENT = 8;
const MIN_LOGO_PERCENT = 2;
const MAX_LOGO_PERCENT = 80;
const DEFAULT_LOGO_GAP = 20;
const MIN_LOGO_GAP = 0;
const MAX_LOGO_GAP = 200;

type WatermarkPosition = 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';
const DEFAULT_POSITION: WatermarkPosition = 'TOP_RIGHT';
const POSITION_OPTIONS: Array<{ value: WatermarkPosition; label: string }> = [
  { value: 'TOP_LEFT', label: '左上角' },
  { value: 'TOP_RIGHT', label: '右上角' },
  { value: 'BOTTOM_LEFT', label: '左下角' },
  { value: 'BOTTOM_RIGHT', label: '右下角' },
];

type Logo = { order: number; path: string; filename?: string; url: string };
type WatermarkConfig = {
  tournamentId: string;
  logos: Logo[];
  logoHeightPercent: number;
  logoGapPercent: number;
  position: WatermarkPosition;
  portraitPosition: WatermarkPosition;
  updatedAt: string | null;
};

export default function WatermarkSettingsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;

  const [logos, setLogos] = useState<Logo[]>([]);
  const [logoPercent, setLogoPercent] = useState<number>(DEFAULT_LOGO_PERCENT);
  const [logoGap, setLogoGap] = useState<number>(DEFAULT_LOGO_GAP);
  const [position, setPosition] = useState<WatermarkPosition>(DEFAULT_POSITION);
  const [portraitPosition, setPortraitPosition] = useState<WatermarkPosition>(DEFAULT_POSITION);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Measure the preview "photo" height so the logo size mirrors the real
  // watermark (logo height = imageHeight * percent), not a fixed pixel size.
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewBoxH, setPreviewBoxH] = useState(0);
  useLayoutEffect(() => {
    const el = previewRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setPreviewBoxH(el.clientHeight));
    ro.observe(el);
    setPreviewBoxH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const data = await apiFetch<WatermarkConfig>(`/admin/tournaments/${id}/watermark`, { token });
      setLogos(data.logos);
      setLogoPercent(data.logoHeightPercent ?? DEFAULT_LOGO_PERCENT);
      setLogoGap(data.logoGapPercent ?? DEFAULT_LOGO_GAP);
      setPosition(data.position ?? DEFAULT_POSITION);
      setPortraitPosition(data.portraitPosition ?? data.position ?? DEFAULT_POSITION);
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
      // Keep any pending (unsaved) size change; only clear dirty if it matches.
      setDirty(
        logoPercent !== (data.logoHeightPercent ?? DEFAULT_LOGO_PERCENT) ||
          logoGap !== (data.logoGapPercent ?? DEFAULT_LOGO_GAP) ||
          position !== (data.position ?? DEFAULT_POSITION) ||
          portraitPosition !== (data.portraitPosition ?? data.position ?? DEFAULT_POSITION),
      );
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
      setDirty(
        logoPercent !== (data.logoHeightPercent ?? DEFAULT_LOGO_PERCENT) ||
          logoGap !== (data.logoGapPercent ?? DEFAULT_LOGO_GAP) ||
          position !== (data.position ?? DEFAULT_POSITION) ||
          portraitPosition !== (data.portraitPosition ?? data.position ?? DEFAULT_POSITION),
      );
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
          logoHeightPercent: logoPercent,
          logoGapPercent: logoGap,
          position,
          portraitPosition,
        }),
      });
      setLogos(data.logos);
      setLogoPercent(data.logoHeightPercent ?? logoPercent);
      setLogoGap(data.logoGapPercent ?? logoGap);
      setPosition(data.position ?? position);
      setPortraitPosition(data.portraitPosition ?? data.position ?? portraitPosition);
      setDirty(false);
      message.success('水印设置已保存,将应用于后续上传的图片');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  const previewLogos = useMemo(() => logos, [logos]);
  // Logo height in preview px mirrors the real watermark: imageHeight * percent.
  const previewLogoPx = Math.max(8, Math.round(((previewBoxH || 180) * logoPercent) / 100));
  // Gap mirrors the real watermark: a percentage of the logo height.
  const previewGap = Math.round((previewLogoPx * logoGap) / 100);

  function changePercent(value: number | null) {
    if (value == null) return;
    const clamped = Math.min(MAX_LOGO_PERCENT, Math.max(MIN_LOGO_PERCENT, Math.round(value)));
    setLogoPercent(clamped);
    setDirty(true);
  }

  function changeGap(value: number | null) {
    if (value == null) return;
    const clamped = Math.min(MAX_LOGO_GAP, Math.max(MIN_LOGO_GAP, Math.round(value)));
    setLogoGap(clamped);
    setDirty(true);
  }

  function changePosition(value: WatermarkPosition) {
    setPosition(value);
    setDirty(true);
  }

  function changePortraitPosition(value: WatermarkPosition) {
    setPortraitPosition(value);
    setDirty(true);
  }

  // Preview corner placement (matches backend EDGE_MARGIN ratio, ~4% of edge).
  const previewCornerOffset = '4%';
  function previewCornerFor(value: WatermarkPosition) {
    return {
      top: value.startsWith('TOP_') ? previewCornerOffset : undefined,
      bottom: value.startsWith('BOTTOM_') ? previewCornerOffset : undefined,
      left: value.endsWith('_LEFT') ? previewCornerOffset : undefined,
      right: value.endsWith('_RIGHT') ? previewCornerOffset : undefined,
    } as const;
  }

  function renderPreviewPhoto(value: WatermarkPosition, shape: 'landscape' | 'portrait') {
    const aspect = shape === 'portrait' ? '66%' : '100%';
    const paddingTop = shape === 'portrait' ? '136%' : '60%';
    const corner = previewCornerFor(value);
    return (
      <div
        ref={shape === 'landscape' ? previewRef : undefined}
        style={{
          position: 'relative',
          width: aspect,
          maxWidth: shape === 'portrait' ? 240 : undefined,
          margin: shape === 'portrait' ? '0 auto' : undefined,
          paddingTop,
          borderRadius: 8,
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #1f6feb, #0a2a66)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            ...corner,
            display: 'flex',
            alignItems: 'center',
            gap: previewGap,
            opacity: 0.85,
          }}
        >
          {previewLogos.length === 0 ? (
            <Typography.Text style={{ color: 'rgba(255,255,255,0.7)' }}>
              未配置 Logo
            </Typography.Text>
          ) : (
            previewLogos.map((logo) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={logo.path}
                src={`${API_ORIGIN}${logo.url}`}
                alt={logo.filename ?? 'logo'}
                style={{ height: previewLogoPx, objectFit: 'contain' }}
              />
            ))
          )}
        </div>
        <Typography.Text
          style={{
            position: 'absolute',
            color: 'rgba(255,255,255,0.65)',
            fontSize: 12,
            ...(value.startsWith('TOP_') ? { bottom: 12 } : { top: 12 }),
            ...(value.endsWith('_LEFT') ? { right: 16 } : { left: 16 }),
          }}
        >
          {shape === 'portrait' ? '竖图预览' : '横图预览'} - {POSITION_OPTIONS.find((o) => o.value === value)?.label ?? ''}
        </Typography.Text>
      </div>
    );
  }

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
        message="第 1 个为赛事主 Logo,其余为赞助商 Logo,多个 Logo 横向并排展示(间距可调)。最多 5 个,仅支持透明背景 PNG(< 5MB)。"
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
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <Typography.Text strong>Logo 大小</Typography.Text>
              <InputNumber
                size="small"
                min={MIN_LOGO_PERCENT}
                max={MAX_LOGO_PERCENT}
                value={logoPercent}
                onChange={changePercent}
                formatter={(v) => `${v}%`}
                parser={(v) => Number((v ?? '').replace('%', ''))}
                style={{ width: 88 }}
              />
            </div>
            <Slider
              min={MIN_LOGO_PERCENT}
              max={MAX_LOGO_PERCENT}
              value={logoPercent}
              onChange={changePercent}
              tooltip={{ formatter: (v) => `${v}%` }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Logo 高度 = 图片高度的 {logoPercent}%(下方预览实时模拟)
            </Typography.Text>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                margin: '16px 0 4px',
              }}
            >
              <Typography.Text strong>Logo 间距</Typography.Text>
              <InputNumber
                size="small"
                min={MIN_LOGO_GAP}
                max={MAX_LOGO_GAP}
                value={logoGap}
                onChange={changeGap}
                formatter={(v) => `${v}%`}
                parser={(v) => Number((v ?? '').replace('%', ''))}
                style={{ width: 88 }}
              />
            </div>
            <Slider
              min={MIN_LOGO_GAP}
              max={MAX_LOGO_GAP}
              value={logoGap}
              onChange={changeGap}
              tooltip={{ formatter: (v) => `${v}%` }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              多个 Logo 之间的间距 = Logo 高度的 {logoGap}%(仅在有 2 个及以上 Logo 时生效)
            </Typography.Text>

            <div style={{ marginTop: 16 }}>
              <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
                横图水印位置
              </Typography.Text>
              <Radio.Group
                value={position}
                onChange={(e) => changePosition(e.target.value as WatermarkPosition)}
                optionType="button"
                buttonStyle="solid"
                options={POSITION_OPTIONS}
              />
            </div>

            <div style={{ marginTop: 16 }}>
              <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
                竖图水印位置
              </Typography.Text>
              <Radio.Group
                value={portraitPosition}
                onChange={(e) => changePortraitPosition(e.target.value as WatermarkPosition)}
                optionType="button"
                buttonStyle="solid"
                options={POSITION_OPTIONS}
              />
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
                当图片高度大于宽度时使用这个位置。
              </Typography.Text>
            </div>
          </div>

          <div
            ref={previewRef}
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
                ...previewCornerFor(position),
                display: 'flex',
                alignItems: 'center',
                gap: previewGap,
                opacity: 0.85,
              }}
            >
              {previewLogos.length === 0 ? (
                <Typography.Text style={{ color: 'rgba(255,255,255,0.7)' }}>
                  未配置 Logo
                </Typography.Text>
              ) : (
                previewLogos.map((logo) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={logo.path}
                    src={`${API_ORIGIN}${logo.url}`}
                    alt={logo.filename ?? 'logo'}
                    style={{ height: previewLogoPx, objectFit: 'contain' }}
                  />
                ))
              )}
            </div>
            {/* Caption hugs the opposite corner of the watermark so it never overlaps. */}
            <Typography.Text
              style={{
                position: 'absolute',
                color: 'rgba(255,255,255,0.65)',
                fontSize: 12,
                ...(position.startsWith('TOP_') ? { bottom: 12 } : { top: 12 }),
                ...(position.endsWith('_LEFT') ? { right: 16 } : { left: 16 }),
              }}
            >
              示例照片 —— 水印显示在{POSITION_OPTIONS.find((o) => o.value === position)?.label ?? ''}
            </Typography.Text>
          </div>
          <div style={{ marginTop: 12 }}>
            {renderPreviewPhoto(portraitPosition, 'portrait')}
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
