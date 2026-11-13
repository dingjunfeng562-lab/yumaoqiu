'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';

type Point = { x: number; y: number };
type Stroke = Point[];

export type SignaturePadHandle = {
  clear: () => void;
  isEmpty: () => boolean;
  /**
   * 导出签名：裁掉四周空白、按需缩小后的透明底 PNG data URL；笔迹太短时返回 null。
   * 单张控制在约 40K 字符以内，两张签名加起来才放得进后端 100KB 的请求体。
   */
  toDataUrl: () => string | null;
};

type SignaturePadProps = {
  height?: number;
  placeholder?: string;
  /** 每画完一笔或清除后回调，参数为当前是否还算空白。 */
  onChange?: (empty: boolean) => void;
};

const LINE_WIDTH = 3.2;
/** 总笔迹长度（CSS 像素）少于这个值当作没签。 */
const MIN_INK_LENGTH = 40;
const EXPORT_MAX_WIDTH = 640;
const EXPORT_MAX_HEIGHT = 260;
const EXPORT_MIN_WIDTH = 160;
const EXPORT_MIN_HEIGHT = 64;
const EXPORT_PADDING = 12;
const MAX_DATA_URL_LENGTH = 40000;

function inkLength(strokes: Stroke[]) {
  let total = 0;
  for (const stroke of strokes) {
    if (stroke.length === 1) total += LINE_WIDTH;
    for (let index = 1; index < stroke.length; index += 1) {
      total += Math.hypot(stroke[index].x - stroke[index - 1].x, stroke[index].y - stroke[index - 1].y);
    }
  }
  return total;
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (!stroke.length) return;
  if (stroke.length === 1) {
    ctx.beginPath();
    ctx.arc(stroke[0].x, stroke[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(stroke[0].x, stroke[0].y);
  for (let index = 1; index < stroke.length; index += 1) ctx.lineTo(stroke[index].x, stroke[index].y);
  ctx.stroke();
}

function applyPen(ctx: CanvasRenderingContext2D, width: number) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';
  ctx.fillStyle = '#0f172a';
  ctx.lineWidth = width;
}

/** 手写签名板：手指、触控笔、鼠标都能签（Pointer Events），触摸时不会滚动页面。 */
const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  { height = 240, placeholder = '请在框内签名', onChange },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activePointerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const syncPlaceholder = useCallback(() => {
    if (placeholderRef.current) {
      placeholderRef.current.style.opacity = strokesRef.current.length ? '0' : '1';
    }
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    applyPen(ctx, LINE_WIDTH);
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
    syncPlaceholder();
  }, [syncPlaceholder]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, wrap.clientWidth);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [height, redraw]);

  const notify = useCallback(() => {
    onChangeRef.current?.(inkLength(strokesRef.current) < MIN_INK_LENGTH);
  }, []);

  useImperativeHandle(ref, () => ({
    clear() {
      strokesRef.current = [];
      redraw();
      notify();
    },
    isEmpty() {
      return inkLength(strokesRef.current) < MIN_INK_LENGTH;
    },
    toDataUrl() {
      const strokes = strokesRef.current.filter((stroke) => stroke.length);
      if (inkLength(strokes) < MIN_INK_LENGTH) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const stroke of strokes) {
        for (const point of stroke) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
      const boxWidth = Math.max(1, maxX - minX + LINE_WIDTH);
      const boxHeight = Math.max(1, maxY - minY + LINE_WIDTH);
      let scale = Math.min(
        1,
        (EXPORT_MAX_WIDTH - EXPORT_PADDING * 2) / boxWidth,
        (EXPORT_MAX_HEIGHT - EXPORT_PADDING * 2) / boxHeight,
      );
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const width = Math.max(EXPORT_MIN_WIDTH, Math.ceil(boxWidth * scale + EXPORT_PADDING * 2));
        const heightPx = Math.max(EXPORT_MIN_HEIGHT, Math.ceil(boxHeight * scale + EXPORT_PADDING * 2));
        const offsetX = (width - boxWidth * scale) / 2;
        const offsetY = (heightPx - boxHeight * scale) / 2;
        const output = document.createElement('canvas');
        output.width = width;
        output.height = heightPx;
        const ctx = output.getContext('2d');
        if (!ctx) return null;
        ctx.setTransform(scale, 0, 0, scale, offsetX - (minX - LINE_WIDTH / 2) * scale, offsetY - (minY - LINE_WIDTH / 2) * scale);
        applyPen(ctx, LINE_WIDTH);
        for (const stroke of strokes) drawStroke(ctx, stroke);
        const url = output.toDataURL('image/png');
        if (url.length <= MAX_DATA_URL_LENGTH) return url;
        scale *= 0.75;
      }
      return null;
    },
  }), [notify, redraw]);

  function pointFrom(event: { clientX: number; clientY: number }): Point {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    strokesRef.current.push([pointFrom(event)]);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawStroke(ctx, strokesRef.current[strokesRef.current.length - 1]);
    syncPlaceholder();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    const ctx = canvasRef.current?.getContext('2d');
    if (!stroke || !ctx) return;
    const native = event.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const samples = native.getCoalescedEvents?.() ?? [];
    const points = (samples.length ? samples : [native]).map((sample) => pointFrom(sample));
    for (const point of points) {
      const previous = stroke[stroke.length - 1];
      stroke.push(point);
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    notify();
  }

  return (
    <div
      ref={wrapRef}
      className="relative w-full select-none overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-white"
      style={{ height }}
    >
      <div
        ref={placeholderRef}
        className="pointer-events-none absolute inset-0 flex items-center justify-center text-base font-semibold text-slate-300 transition-opacity"
      >
        {placeholder}
      </div>
      <div className="pointer-events-none absolute bottom-6 left-6 right-6 border-b border-slate-200" />
      <canvas
        ref={canvasRef}
        className="relative block cursor-crosshair"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
      />
    </div>
  );
});

export default SignaturePad;
