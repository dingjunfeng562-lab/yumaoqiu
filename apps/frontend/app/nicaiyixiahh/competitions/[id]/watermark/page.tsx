'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Button,
  Card,
  Divider,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Slider,
  Space,
  Switch,
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
const DEFAULT_TEXT_COLOR = '#FFFFFF';
const DEFAULT_TEXT_SIZE = 6;
const MIN_TEXT_SIZE = 2;
const MAX_TEXT_SIZE = 80;
const MAX_TEXT_LENGTH = 100;
type WatermarkPosition = 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';
type TextFontType = 'HEITI' | 'SONGTI' | 'KAITI';
type Orientation = 'landscape' | 'portrait';
const DEFAULT_POSITION: WatermarkPosition = 'TOP_RIGHT';
const DEFAULT_TEXT_FONT: TextFontType = 'HEITI';
const FONT_OPTIONS: Array<{ value: TextFontType; label: string; family: string; weight?: number }> = [
  { value: 'HEITI', label: '黑体', family: "'Noto Sans CJK SC','Microsoft YaHei','SimHei',sans-serif", weight: 700 },
  { value: 'SONGTI', label: '宋体', family: "'Noto Serif CJK SC','SimSun','Songti SC',serif", weight: 400 },
  { value: 'KAITI', label: '楷体', family: "'KaiTi','STKaiti','Kaiti SC',serif", weight: 400 },
];
const POSITION_OPTIONS: Array<{ value: WatermarkPosition; label: string }> = [
  { value: 'TOP_LEFT', label: '左上角' },
  { value: 'TOP_RIGHT', label: '右上角' },
  { value: 'BOTTOM_LEFT', label: '左下角' },
  { value: 'BOTTOM_RIGHT', label: '右下角' },
];
const ORIENTATION_OPTIONS: Array<{ value: Orientation; label: string }> = [
  { value: 'landscape', label: '横图' },
  { value: 'portrait', label: '竖图' },
];
const ORIENTATION_LABEL: Record<Orientation, string> = {
  landscape: '横图',
  portrait: '竖图',
};
const FONT_SEGMENT_OPTIONS = FONT_OPTIONS.map((option) => ({
  value: option.value,
  label: (
    <span style={{ fontFamily: option.family, fontWeight: option.weight ?? 400 }}>
      {option.label}
    </span>
  ),
}));

type Logo = { order: number; path: string; filename?: string; url: string };
type WatermarkConfig = {
  tournamentId: string;
  logos: Logo[];
  logoHeightPercent: number;
  portraitLogoHeightPercent?: number;
  logoGapPercent: number;
  portraitLogoGapPercent?: number;
  position: string;
  portraitPosition: string;
  text: string;
  textColor: string;
  textSizePercent: number;
  portraitTextSizePercent?: number;
  textFont: TextFontType;
  textPosition?: string;
  textPortraitPosition?: string;
  updatedAt: string | null;
};
/** Legacy corner placement, or a free center position in percentages. */
type PositionState =
  | { kind: 'corner'; corner: WatermarkPosition }
  | { kind: 'free'; x: number; y: number };

function positionLabel(value: WatermarkPosition) {
  return POSITION_OPTIONS.find((option) => option.value === value)?.label ?? '';
}

function parsePosition(value?: string | null): PositionState {
  const raw = (value ?? '').trim();
  if (POSITION_OPTIONS.some((option) => option.value === raw)) {
    return { kind: 'corner', corner: raw as WatermarkPosition };
  }
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(raw);
  if (match) {
    const clamp = (number: number) => Math.min(100, Math.max(0, number));
    return { kind: 'free', x: clamp(Number(match[1])), y: clamp(Number(match[2])) };
  }
  return { kind: 'corner', corner: DEFAULT_POSITION };
}

function serializePosition(value: PositionState): string {
  return value.kind === 'corner' ? value.corner : `${value.x.toFixed(1)},${value.y.toFixed(1)}`;
}

function samePosition(a: PositionState, b: PositionState): boolean {
  if (a.kind === 'corner' && b.kind === 'corner') return a.corner === b.corner;
  if (a.kind === 'free' && b.kind === 'free') {
    return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;
  }
  return false;
}

export default function WatermarkSettingsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const pathname = usePathname();
  const isActivity = pathname.startsWith('/nicaiyixiahh/photo-activities/');
  // Page routes live under /nicaiyixiahh, but the backend admin API is /admin.
  const resourceBase = isActivity ? `/admin/photo-activities/${id}` : `/admin/tournaments/${id}`;
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken as string | undefined;

  const [logos, setLogos] = useState<Logo[]>([]);
  const [logoPercent, setLogoPercent] = useState<number>(DEFAULT_LOGO_PERCENT);
  const [portraitLogoPercent, setPortraitLogoPercent] = useState<number>(DEFAULT_LOGO_PERCENT);
  const [logoGap, setLogoGap] = useState<number>(DEFAULT_LOGO_GAP);
  const [portraitLogoGap, setPortraitLogoGap] = useState<number>(DEFAULT_LOGO_GAP);
  const [landscapePosition, setLandscapePosition] = useState<PositionState>({
    kind: 'corner',
    corner: DEFAULT_POSITION,
  });
  const [portraitPosition, setPortraitPosition] = useState<PositionState>({
    kind: 'corner',
    corner: DEFAULT_POSITION,
  });
  const [landscapeTextPosition, setLandscapeTextPosition] = useState<PositionState>({
    kind: 'corner',
    corner: 'BOTTOM_LEFT',
  });
  const [portraitTextPosition, setPortraitTextPosition] = useState<PositionState>({
    kind: 'corner',
    corner: 'BOTTOM_LEFT',
  });
  const [text, setText] = useState<string>('');
  const [textEnabled, setTextEnabled] = useState(false);
  const [textColor, setTextColor] = useState<string>(DEFAULT_TEXT_COLOR);
  const [textSize, setTextSize] = useState<number>(DEFAULT_TEXT_SIZE);
  const [portraitTextSize, setPortraitTextSize] = useState<number>(DEFAULT_TEXT_SIZE);
  const [textFont, setTextFont] = useState<TextFontType>(DEFAULT_TEXT_FONT);
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState<'logo' | 'text' | null>(null);
  const [dirty, setDirty] = useState(false);

  // One preview at a time. Its shorter edge drives the previewed watermark size,
  // matching the backend rule (height for landscape, width for portrait).
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    target: 'logo' | 'text';
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [previewBase, setPreviewBase] = useState(0);
  useLayoutEffect(() => {
    const el = previewRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setPreviewBase(Math.min(el.clientWidth, el.clientHeight));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const data = await apiFetch<WatermarkConfig>(`${resourceBase}/watermark`, { token });
      setLogos(data.logos);
      setLogoPercent(data.logoHeightPercent ?? DEFAULT_LOGO_PERCENT);
      setPortraitLogoPercent(
        data.portraitLogoHeightPercent ?? data.logoHeightPercent ?? DEFAULT_LOGO_PERCENT,
      );
      setLogoGap(data.logoGapPercent ?? DEFAULT_LOGO_GAP);
      setPortraitLogoGap(
        data.portraitLogoGapPercent ?? data.logoGapPercent ?? DEFAULT_LOGO_GAP,
      );
      setLandscapePosition(parsePosition(data.position));
      setPortraitPosition(parsePosition(data.portraitPosition ?? data.position));
      setLandscapeTextPosition(parsePosition(data.textPosition ?? data.position));
      setPortraitTextPosition(
        parsePosition(
          data.textPortraitPosition ?? data.textPosition ?? data.portraitPosition ?? data.position,
        ),
      );
      setText(data.text ?? '');
      setTextEnabled(Boolean(data.text?.trim()));
      setTextColor(data.textColor ?? DEFAULT_TEXT_COLOR);
      setTextSize(data.textSizePercent ?? DEFAULT_TEXT_SIZE);
      setPortraitTextSize(
        data.portraitTextSizePercent ?? data.textSizePercent ?? DEFAULT_TEXT_SIZE,
      );
      setTextFont(data.textFont ?? DEFAULT_TEXT_FONT);
      setDirty(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '水印配置加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, id, resourceBase]);

  useEffect(() => {
    // Initial data fetch; the state updates come from the request lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function configMatches(data: WatermarkConfig) {
    const savedText = data.text ?? '';
    return (
      logoPercent === (data.logoHeightPercent ?? DEFAULT_LOGO_PERCENT) &&
      portraitLogoPercent ===
        (data.portraitLogoHeightPercent ??
          data.logoHeightPercent ??
          DEFAULT_LOGO_PERCENT) &&
      logoGap === (data.logoGapPercent ?? DEFAULT_LOGO_GAP) &&
      portraitLogoGap ===
        (data.portraitLogoGapPercent ?? data.logoGapPercent ?? DEFAULT_LOGO_GAP) &&
      samePosition(landscapePosition, parsePosition(data.position)) &&
      samePosition(portraitPosition, parsePosition(data.portraitPosition ?? data.position)) &&
      samePosition(landscapeTextPosition, parsePosition(data.textPosition ?? data.position)) &&
      samePosition(
        portraitTextPosition,
        parsePosition(
          data.textPortraitPosition ?? data.textPosition ?? data.portraitPosition ?? data.position,
        ),
      ) &&
      (textEnabled ? text.trim() : '') === savedText &&
      textColor === (data.textColor ?? DEFAULT_TEXT_COLOR) &&
      textSize === (data.textSizePercent ?? DEFAULT_TEXT_SIZE) &&
      portraitTextSize ===
        (data.portraitTextSizePercent ?? data.textSizePercent ?? DEFAULT_TEXT_SIZE) &&
      textFont === (data.textFont ?? DEFAULT_TEXT_FONT)
    );
  }

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
      const res = await fetch(`${API_BASE}${resourceBase}/watermark/logos`, {
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
      // Uploading persists the logo list; keep the dirty flag only for the
      // style changes that are still unsaved.
      setDirty(!configMatches(data));
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
      const data = await apiFetch<WatermarkConfig>(`${resourceBase}/watermark/logos`, {
        method: 'DELETE',
        token,
        body: JSON.stringify({ path: logo.path }),
      });
      setLogos(data.logos);
      setDirty(!configMatches(data));
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
      const data = await apiFetch<WatermarkConfig>(`${resourceBase}/watermark`, {
        method: 'PUT',
        token,
        body: JSON.stringify({
          logos: logos.map((l, i) => ({ order: i + 1, path: l.path, filename: l.filename })),
          logoHeightPercent: logoPercent,
          portraitLogoHeightPercent: portraitLogoPercent,
          logoGapPercent: logoGap,
          portraitLogoGapPercent: portraitLogoGap,
          position: serializePosition(landscapePosition),
          portraitPosition: serializePosition(portraitPosition),
          textPosition: serializePosition(landscapeTextPosition),
          textPortraitPosition: serializePosition(portraitTextPosition),
          text: textEnabled ? text.trim() : '',
          textColor,
          textSizePercent: textSize,
          portraitTextSizePercent: portraitTextSize,
          textFont,
        }),
      });
      setLogos(data.logos);
      setLogoPercent(data.logoHeightPercent ?? logoPercent);
      setPortraitLogoPercent(
        data.portraitLogoHeightPercent ?? data.logoHeightPercent ?? portraitLogoPercent,
      );
      setLogoGap(data.logoGapPercent ?? logoGap);
      setPortraitLogoGap(
        data.portraitLogoGapPercent ?? data.logoGapPercent ?? portraitLogoGap,
      );
      setLandscapePosition(parsePosition(data.position));
      setPortraitPosition(parsePosition(data.portraitPosition ?? data.position));
      setLandscapeTextPosition(parsePosition(data.textPosition ?? data.position));
      setPortraitTextPosition(
        parsePosition(
          data.textPortraitPosition ?? data.textPosition ?? data.portraitPosition ?? data.position,
        ),
      );
      setText(data.text ?? '');
      setTextEnabled(Boolean(data.text?.trim()));
      setTextColor(data.textColor ?? DEFAULT_TEXT_COLOR);
      setTextSize(data.textSizePercent ?? DEFAULT_TEXT_SIZE);
      setPortraitTextSize(
        data.portraitTextSizePercent ?? data.textSizePercent ?? DEFAULT_TEXT_SIZE,
      );
      setTextFont(data.textFont ?? DEFAULT_TEXT_FONT);
      setDirty(false);
      message.success('水印设置已保存,将应用于后续上传的图片');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  const activePosition = orientation === 'landscape' ? landscapePosition : portraitPosition;
  const activeTextPosition =
    orientation === 'landscape' ? landscapeTextPosition : portraitTextPosition;
  const activeLogoPercent = orientation === 'landscape' ? logoPercent : portraitLogoPercent;
  const activeLogoGap = orientation === 'landscape' ? logoGap : portraitLogoGap;
  const activeTextSize = orientation === 'landscape' ? textSize : portraitTextSize;
  const orientationLabel = ORIENTATION_LABEL[orientation];
  const trimmedText = text.trim();
  const previewText = textEnabled ? trimmedText : '';

  /** Preview sizes mirror the real watermark, which is sized from the shorter edge. */
  function previewMetrics() {
    const baseSize = previewBase || (orientation === 'portrait' ? 260 : 320);
    const logoPx = Math.max(8, Math.round((baseSize * activeLogoPercent) / 100));
    return {
      logoPx,
      gapPx: Math.round((logoPx * activeLogoGap) / 100),
      textPx: Math.max(8, Math.round((baseSize * activeTextSize) / 100)),
    };
  }

  function changePercent(value: number) {
    const next = Math.min(MAX_LOGO_PERCENT, Math.max(MIN_LOGO_PERCENT, Math.round(value)));
    if (orientation === 'landscape') setLogoPercent(next);
    else setPortraitLogoPercent(next);
    setDirty(true);
  }

  function changeGap(value: number) {
    const next = Math.min(MAX_LOGO_GAP, Math.max(MIN_LOGO_GAP, Math.round(value)));
    if (orientation === 'landscape') setLogoGap(next);
    else setPortraitLogoGap(next);
    setDirty(true);
  }

  function changeText(value: string) {
    setText(value.slice(0, MAX_TEXT_LENGTH));
    setDirty(true);
  }

  function changeTextColor(value: string) {
    setTextColor(value);
    setDirty(true);
  }

  function changeTextSize(value: number) {
    const next = Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, Math.round(value)));
    if (orientation === 'landscape') setTextSize(next);
    else setPortraitTextSize(next);
    setDirty(true);
  }

  function changeTextFont(value: TextFontType) {
    setTextFont(value);
    setDirty(true);
  }

  function toggleText(enabled: boolean) {
    setTextEnabled(enabled);
    if (text.trim()) setDirty(true);
  }

  function updatePosition(target: 'logo' | 'text', next: PositionState) {
    if (orientation === 'landscape') {
      if (target === 'logo') setLandscapePosition(next);
      else setLandscapeTextPosition(next);
    } else if (target === 'logo') {
      setPortraitPosition(next);
    } else {
      setPortraitTextPosition(next);
    }
    setDirty(true);
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    target: 'logo' | 'text',
  ) {
    const box = previewRef.current;
    if (!box || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const overlay = event.currentTarget;
    const overlayRect = overlay.getBoundingClientRect();
    dragRef.current = {
      target,
      offsetX: event.clientX - (overlayRect.left + overlayRect.width / 2),
      offsetY: event.clientY - (overlayRect.top + overlayRect.height / 2),
      width: overlay.offsetWidth,
      height: overlay.offsetHeight,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    try {
      overlay.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    setDragging(target);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const box = previewRef.current;
    if (!drag || !box) return;
    event.preventDefault();
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return;
      drag.moved = true;
    }
    const rect = box.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const halfX = (drag.width / 2 / rect.width) * 100;
    const halfY = (drag.height / 2 / rect.height) * 100;
    const clampAxis = (value: number, half: number) => {
      const low = Math.min(half, 100 - half);
      const high = Math.max(half, 100 - half);
      return Math.min(high, Math.max(low, value));
    };
    const x = ((event.clientX - drag.offsetX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - drag.offsetY - rect.top) / rect.height) * 100;
    updatePosition(drag.target, {
      kind: 'free',
      x: Math.round(clampAxis(x, halfX) * 10) / 10,
      y: Math.round(clampAxis(y, halfY) * 10) / 10,
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    setDragging(null);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* pointer capture is best-effort */
    }
  }

  function overlayPositionStyle(value: PositionState) {
    if (value.kind === 'corner') return previewCornerFor(value.corner);
    return { left: `${value.x}%`, top: `${value.y}%`, transform: 'translate(-50%, -50%)' };
  }

  // Preview corner placement (matches the backend edge margin, ~4% of the edge).
  const previewCornerOffset = '4%';
  function previewCornerFor(value: WatermarkPosition) {
    return {
      top: value.startsWith('TOP_') ? previewCornerOffset : undefined,
      bottom: value.startsWith('BOTTOM_') ? previewCornerOffset : undefined,
      left: value.endsWith('_LEFT') ? previewCornerOffset : undefined,
      right: value.endsWith('_RIGHT') ? previewCornerOffset : undefined,
    } as const;
  }

  function renderLayer(
    target: 'logo' | 'text',
    value: PositionState,
    content: ReactNode,
    gap?: number,
  ) {
    const active = dragging === target;
    return (
      <div
        onPointerDown={(event) => handlePointerDown(event, target)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDragStart={(event) => event.preventDefault()}
        title={target === 'logo' ? '拖动 Logo 调整位置' : '拖动文字调整位置'}
        style={{
          position: 'absolute',
          ...overlayPositionStyle(value),
          display: target === 'logo' ? 'flex' : 'block',
          alignItems: 'center',
          gap,
          opacity: 0.85,
          cursor: active ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
          outline: active ? '2px dashed rgba(255,255,255,0.8)' : undefined,
          outlineOffset: 4,
          borderRadius: 4,
        }}
      >
        {content}
      </div>
    );
  }

  function renderWatermarkOverlay() {
    const { logoPx, gapPx, textPx } = previewMetrics();
    const hasLogos = logos.length > 0;
    const hasText = Boolean(previewText);

    if (!hasLogos && !hasText) {
      return (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography.Text style={{ color: 'rgba(255,255,255,0.7)' }}>
            未配置水印
          </Typography.Text>
        </div>
      );
    }

    const logoContent = logos.map((logo) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={logo.path}
        src={`${API_ORIGIN}${logo.url}`}
        alt={logo.filename ?? 'logo'}
        draggable={false}
        style={{ height: logoPx, objectFit: 'contain' }}
      />
    ));
    const fontOption = FONT_OPTIONS.find((option) => option.value === textFont) ?? FONT_OPTIONS[0];
    const textContent = (
      <span
        style={{
          color: textColor,
          fontSize: textPx,
          fontFamily: fontOption.family,
          fontWeight: fontOption.weight ?? 400,
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        {previewText}
      </span>
    );

    return (
      <>
        {hasLogos && renderLayer('logo', activePosition, logoContent, gapPx)}
        {hasText && renderLayer('text', activeTextPosition, textContent)}
      </>
    );
  }

  function renderPreviewPhoto() {
    const isPortrait = orientation === 'portrait';
    return (
      <div
        ref={previewRef}
        style={{
          position: 'relative',
          width: isPortrait ? '66%' : '100%',
          maxWidth: isPortrait ? 260 : undefined,
          margin: isPortrait ? '0 auto' : undefined,
          aspectRatio: isPortrait ? '2 / 3' : '5 / 3',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #1f6feb, #0a2a66)',
        }}
      >
        {renderWatermarkOverlay()}
      </div>
    );
  }

  function describePosition(value: PositionState) {
    return value.kind === 'corner' ? positionLabel(value.corner) : '自定义位置';
  }

  const previewCaption = (() => {
    const parts: string[] = [];
    if (logos.length > 0) parts.push(`Logo ${describePosition(activePosition)}`);
    if (previewText) parts.push(`文字 ${describePosition(activeTextPosition)}`);
    if (parts.length === 0) return `${orientationLabel}预览`;
    return `${orientationLabel}预览 · ${parts.join(' · ')} · 可拖动`;
  })();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() =>
            router.push(isActivity ? '/nicaiyixiahh/photo-activities' : '/nicaiyixiahh/competitions')
          }
        >
          返回{isActivity ? '活动图片' : '赛事管理'}
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          水印设置
        </Typography.Title>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        保存后只影响之后上传的照片,已上传的照片不会重新生成水印。
      </Typography.Text>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'flex-start',
          marginTop: 16,
        }}
      >
        <Card
          title="效果预览"
          extra={
            <Segmented
              size="small"
              value={orientation}
              onChange={(value) => setOrientation(value as Orientation)}
              options={ORIENTATION_OPTIONS}
            />
          }
          style={{ flex: '1 1 380px', minWidth: 300 }}
        >
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            {renderPreviewPhoto()}
          </div>
          <Typography.Text
            type="secondary"
            style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 12 }}
          >
            {previewCaption}
          </Typography.Text>
        </Card>

        <Card title="水印配置" style={{ flex: '1 1 460px', minWidth: 320 }} loading={loading}>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
            大小、位置都按当前预览的横图 / 竖图分别保存；拖动预览中的 Logo 和文字调整位置。
          </Typography.Text>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <Typography.Text strong>Logo</Typography.Text>
              <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                {logos.length}/{MAX_LOGOS} · 第 1 个为主 Logo
              </Typography.Text>
            </div>
            <Upload
              accept="image/png"
              showUploadList={false}
              beforeUpload={(file) => {
                void uploadLogo(file as File);
                return false;
              }}
            >
              <Button
                size="small"
                icon={<UploadOutlined />}
                loading={uploading}
                disabled={logos.length >= MAX_LOGOS}
              >
                添加 Logo
              </Button>
            </Upload>
          </div>
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 2, fontSize: 12 }}>
            仅支持透明背景 PNG(&lt; 5MB)
          </Typography.Text>

          <div style={{ marginTop: 12 }}>
            {logos.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="还没有 Logo"
                style={{ margin: '16px 0' }}
              />
            ) : (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {logos.map((logo, index) => (
                  <div
                    key={logo.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 8px',
                      border: '1px solid #f0f0f0',
                      borderRadius: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 52,
                        height: 40,
                        background:
                          'repeating-conic-gradient(#e9edf5 0% 25%, #fff 0% 50%) 50% / 12px 12px',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flex: 'none',
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
                      <Typography.Text strong style={{ fontSize: 13 }}>
                        {index === 0 ? `${isActivity ? '活动' : '赛事'}主 Logo` : `赞助商 Logo ${index}`}
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        ellipsis
                        style={{ display: 'block', fontSize: 12 }}
                      >
                        {logo.filename ?? logo.path.split('/').pop()}
                      </Typography.Text>
                    </div>
                    <Space size={4}>
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
                      <Popconfirm
                        title="删除这个 Logo？"
                        okText="删除"
                        cancelText="取消"
                        onConfirm={() => deleteLogo(logo)}
                      >
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                        />
                      </Popconfirm>
                    </Space>
                  </div>
                ))}
              </Space>
            )}
          </div>

          {logos.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <Typography.Text>Logo 大小</Typography.Text>
                  <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    {orientationLabel}
                  </Typography.Text>
                </div>
                <Typography.Text type="secondary">{activeLogoPercent}%</Typography.Text>
              </div>
              <Slider
                min={MIN_LOGO_PERCENT}
                max={MAX_LOGO_PERCENT}
                value={activeLogoPercent}
                onChange={changePercent}
                tooltip={{ formatter: (value) => `${value}%` }}
              />

              {logos.length > 1 && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 8,
                    }}
                  >
                    <div>
                      <Typography.Text>Logo 间距</Typography.Text>
                      <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                        {orientationLabel}
                      </Typography.Text>
                    </div>
                    <Typography.Text type="secondary">{activeLogoGap}%</Typography.Text>
                  </div>
                  <Slider
                    min={MIN_LOGO_GAP}
                    max={MAX_LOGO_GAP}
                    value={activeLogoGap}
                    onChange={changeGap}
                    tooltip={{ formatter: (value) => `${value}%` }}
                  />
                </>
              )}
            </div>
          )}

          <Divider style={{ margin: '20px 0 16px' }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <Typography.Text strong>文字水印</Typography.Text>
              <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                可选
              </Typography.Text>
            </div>
            <Switch checked={textEnabled} onChange={toggleText} />
          </div>

          {textEnabled && (
            <div style={{ marginTop: 12 }}>
              <Input
                value={text}
                onChange={(event) => changeText(event.target.value)}
                placeholder="例如:第十届校园羽毛球赛"
                maxLength={MAX_TEXT_LENGTH}
                allowClear
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  flexWrap: 'wrap',
                  marginTop: 12,
                }}
              >
                <Space size={8}>
                  <Typography.Text style={{ fontSize: 13 }}>颜色</Typography.Text>
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(textColor) ? textColor : '#FFFFFF'}
                    onChange={(event) => changeTextColor(event.target.value.toUpperCase())}
                    style={{
                      width: 40,
                      height: 28,
                      border: '1px solid #d9d9d9',
                      borderRadius: 4,
                      padding: 0,
                      cursor: 'pointer',
                    }}
                    aria-label="文字颜色"
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {textColor}
                  </Typography.Text>
                </Space>
                <Space size={8}>
                  <Typography.Text style={{ fontSize: 13 }}>字体</Typography.Text>
                  <Segmented
                    size="small"
                    value={textFont}
                    onChange={(value) => changeTextFont(value as TextFontType)}
                    options={FONT_SEGMENT_OPTIONS}
                  />
                </Space>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <Typography.Text>文字大小</Typography.Text>
                    <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                      {orientationLabel}
                    </Typography.Text>
                  </div>
                  <Typography.Text type="secondary">{activeTextSize}%</Typography.Text>
                </div>
                <Slider
                  min={MIN_TEXT_SIZE}
                  max={MAX_TEXT_SIZE}
                  value={activeTextSize}
                  onChange={changeTextSize}
                  tooltip={{ formatter: (value) => `${value}%` }}
                />
              </div>
            </div>
          )}
        </Card>
      </div>

      <div
        style={{
          position: 'sticky',
          bottom: 12,
          zIndex: 10,
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            background: '#fff',
            border: '1px solid #f0f0f0',
            borderRadius: 999,
            boxShadow: '0 6px 18px rgba(15, 23, 42, 0.12)',
          }}
        >
          {dirty && (
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              有未保存的修改
            </Typography.Text>
          )}
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={!dirty}
            onClick={save}
          >
            保存设置
          </Button>
        </div>
      </div>
    </div>
  );
}
