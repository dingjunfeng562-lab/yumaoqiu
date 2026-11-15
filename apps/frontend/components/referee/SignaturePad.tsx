'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/** 归一化坐标（0..1）：画布尺寸变化时笔迹不丢也不被裁掉。 */
type Point = { x: number; y: number };
/** painted = 已经画到画布上的点数，用来做增量绘制。 */
type Stroke = { points: Point[]; painted: number };

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
  /** 固定高度；fill 为 true 时忽略，改成吃满父容器剩余空间。 */
  height?: number;
  /** 撑满父容器（flex-1）：签字层用它把屏幕剩下的高度全给签字板。 */
  fill?: boolean;
  placeholder?: string;
  /** 每画完一笔或清除后回调，参数为当前是否还算空白。 */
  onChange?: (empty: boolean) => void;
  className?: string;
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
/** 两个采样点之间不到半个像素就合并，低端机不必为抖动买单。 */
const MIN_SAMPLE_DISTANCE = 0.5;

function inkLength(strokes: Stroke[], width: number, height: number) {
  let total = 0;
  for (const stroke of strokes) {
    const points = stroke.points;
    if (points.length === 1) total += LINE_WIDTH;
    for (let index = 1; index < points.length; index += 1) {
      total += Math.hypot(
        (points[index].x - points[index - 1].x) * width,
        (points[index].y - points[index - 1].y) * height,
      );
    }
  }
  return total;
}

function applyPen(ctx: CanvasRenderingContext2D) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';
  ctx.fillStyle = '#0f172a';
  ctx.lineWidth = LINE_WIDTH;
}

/** 把还没上屏的点补画出来（每帧一次，避免每个 touchmove 都重排）。 */
function paintPending(ctx: CanvasRenderingContext2D, strokes: Stroke[], width: number, height: number) {
  for (const stroke of strokes) {
    const points = stroke.points;
    if (!points.length || stroke.painted >= points.length) continue;
    if (stroke.painted === 0) {
      ctx.beginPath();
      ctx.arc(points[0].x * width, points[0].y * height, LINE_WIDTH / 2, 0, Math.PI * 2);
      ctx.fill();
      stroke.painted = 1;
    }
    for (let index = stroke.painted; index < points.length; index += 1) {
      ctx.beginPath();
      ctx.moveTo(points[index - 1].x * width, points[index - 1].y * height);
      ctx.lineTo(points[index].x * width, points[index].y * height);
      ctx.stroke();
    }
    stroke.painted = points.length;
  }
}

function repaint(ctx: CanvasRenderingContext2D, strokes: Stroke[], width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  applyPen(ctx);
  for (const stroke of strokes) stroke.painted = 0;
  paintPending(ctx, strokes, width, height);
}

/**
 * 累加祖先的 CSS 旋转角度（吸附到 90°）。
 * 横屏兜底时整个记分台被 rotate(90deg)，此时 getBoundingClientRect() 给的是外接矩形，
 * 宽高互换，按视口轴取点会把笔迹画歪、画到画布外面去。
 */
function rotationOf(element: HTMLElement | null) {
  let angle = 0;
  let node: HTMLElement | null = element;
  while (node) {
    const transform = getComputedStyle(node).transform;
    if (transform && transform !== 'none') {
      const match = /^matrix\(([^)]+)\)$/.exec(transform);
      if (match) {
        const [a, b] = match[1].split(',').map(Number);
        if (Number.isFinite(a) && Number.isFinite(b)) angle += (Math.atan2(b, a) * 180) / Math.PI;
      }
    }
    node = node.parentElement;
  }
  return Math.round(angle / 90) * 90;
}

/** 屏幕坐标 → 签字板本地坐标（归一化），按旋转角度换轴。 */
function mapToPad(
  event: { clientX: number; clientY: number },
  rect: DOMRect,
  rotation: number,
  width: number,
  height: number,
): Point {
  let x = event.clientX - rect.left;
  let y = event.clientY - rect.top;
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 90) {
    x = event.clientY - rect.top;
    y = rect.right - event.clientX;
  } else if (normalized === 180) {
    x = rect.right - event.clientX;
    y = rect.bottom - event.clientY;
  } else if (normalized === 270) {
    x = rect.bottom - event.clientY;
    y = event.clientX - rect.left;
  }
  return { x: width > 0 ? x / width : 0, y: height > 0 ? y / height : 0 };
}

/** 手写签名板：手指、触控笔、鼠标都能签（Pointer Events），触摸时不会滚动页面。 */
const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  { height = 240, fill = false, placeholder = '请在框内签名', onChange, className = '' },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activePointerRef = useRef<number | null>(null);
  const rotationRef = useRef(0);
  const rectRef = useRef<DOMRect | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const frameRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const syncPlaceholder = useCallback(() => {
    if (placeholderRef.current) {
      placeholderRef.current.style.opacity = strokesRef.current.some((stroke) => stroke.points.length) ? '0' : '1';
    }
  }, []);

  const notify = useCallback(() => {
    const { width, height: boxHeight } = sizeRef.current;
    onChangeRef.current?.(inkLength(strokesRef.current, width, boxHeight) < MIN_INK_LENGTH);
  }, []);

  const paint = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { width, height: boxHeight } = sizeRef.current;
    if (!canvas || !ctx || !width || !boxHeight) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintPending(ctx, strokesRef.current, width, boxHeight);
    syncPlaceholder();
  }, [syncPlaceholder]);

  const schedulePaint = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(paint);
  }, [paint]);

  /**
   * 重设画布尺寸。改 canvas.width 会清空画布，但笔迹是归一化存的，
   * 所以地址栏收起、横竖切换时重画一遍即可，不会丢笔、也不会被裁掉一截。
   */
  const resize = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const width = Math.max(1, wrap.clientWidth);
    const boxHeight = Math.max(1, fill ? wrap.clientHeight : height);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(boxHeight * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${boxHeight}px`;
    sizeRef.current = { width, height: boxHeight };
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      repaint(ctx, strokesRef.current, width, boxHeight);
    }
    syncPlaceholder();
  }, [fill, height, syncPlaceholder]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [resize]);

  // 部分微信/国产内核不完全遵守 touch-action，这里再兜一层，避免签字时页面跟着滚。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stopScroll = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    const stopMenu = (event: Event) => event.preventDefault();
    canvas.addEventListener('touchmove', stopScroll, { passive: false });
    canvas.addEventListener('contextmenu', stopMenu);
    return () => {
      canvas.removeEventListener('touchmove', stopScroll);
      canvas.removeEventListener('contextmenu', stopMenu);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    clear() {
      strokesRef.current = [];
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const { width, height: boxHeight } = sizeRef.current;
      if (canvas && ctx && width && boxHeight) {
        const ratio = window.devicePixelRatio || 1;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        repaint(ctx, strokesRef.current, width, boxHeight);
      }
      syncPlaceholder();
      notify();
    },
    isEmpty() {
      const { width, height: boxHeight } = sizeRef.current;
      return inkLength(strokesRef.current, width, boxHeight) < MIN_INK_LENGTH;
    },
    toDataUrl() {
      const { width: canvasWidth, height: canvasHeight } = sizeRef.current;
      if (!canvasWidth || !canvasHeight) return null;
      const strokes = strokesRef.current.filter((stroke) => stroke.points.length);
      if (inkLength(strokes, canvasWidth, canvasHeight) < MIN_INK_LENGTH) return null;
      // 归一化 → 当前 CSS 像素
      const lines = strokes.map((stroke) =>
        stroke.points.map((point) => ({ x: point.x * canvasWidth, y: point.y * canvasHeight })),
      );
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const line of lines) {
        for (const point of line) {
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
        const outWidth = Math.max(EXPORT_MIN_WIDTH, Math.ceil(boxWidth * scale + EXPORT_PADDING * 2));
        const outHeight = Math.max(EXPORT_MIN_HEIGHT, Math.ceil(boxHeight * scale + EXPORT_PADDING * 2));
        const offsetX = (outWidth - boxWidth * scale) / 2;
        const offsetY = (outHeight - boxHeight * scale) / 2;
        const output = document.createElement('canvas');
        output.width = outWidth;
        output.height = outHeight;
        const ctx = output.getContext('2d');
        if (!ctx) return null;
        ctx.setTransform(
          scale,
          0,
          0,
          scale,
          offsetX - (minX - LINE_WIDTH / 2) * scale,
          offsetY - (minY - LINE_WIDTH / 2) * scale,
        );
        applyPen(ctx);
        for (const line of lines) {
          if (line.length === 1) {
            ctx.beginPath();
            ctx.arc(line[0].x, line[0].y, LINE_WIDTH / 2, 0, Math.PI * 2);
            ctx.fill();
            continue;
          }
          ctx.beginPath();
          ctx.moveTo(line[0].x, line[0].y);
          for (let index = 1; index < line.length; index += 1) ctx.lineTo(line[index].x, line[index].y);
          ctx.stroke();
        }
        const url = output.toDataURL('image/png');
        if (url.length <= MAX_DATA_URL_LENGTH) return url;
        scale *= 0.75;
      }
      return null;
    },
  }), [notify, syncPlaceholder]);

  function beginStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const canvas = canvasRef.current;
    const { width, height: boxHeight } = sizeRef.current;
    if (!canvas || !width || !boxHeight) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 老内核不支持 pointer capture，退化成只能在板内滑动。
    }
    rotationRef.current = rotationOf(canvas);
    rectRef.current = canvas.getBoundingClientRect();
    activePointerRef.current = event.pointerId;
    strokesRef.current.push({
      points: [mapToPad(event, rectRef.current, rotationRef.current, width, boxHeight)],
      painted: 0,
    });
    schedulePaint();
  }

  function extendStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    const rect = rectRef.current;
    const { width, height: boxHeight } = sizeRef.current;
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    if (!rect || !stroke) return;
    event.preventDefault();
    const native = event.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    let samples: PointerEvent[] = [];
    try {
      samples = native.getCoalescedEvents?.() ?? [];
    } catch {
      samples = [];
    }
    const previous = stroke.points[stroke.points.length - 1];
    for (const sample of samples.length ? samples : [native]) {
      const point = mapToPad(sample, rect, rotationRef.current, width, boxHeight);
      if (
        Math.abs(point.x - previous.x) * width < MIN_SAMPLE_DISTANCE
        && Math.abs(point.y - previous.y) * height < MIN_SAMPLE_DISTANCE
      ) {
        continue;
      }
      stroke.points.push(point);
    }
    schedulePaint();
  }

  function endStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    rectRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // 已经释放过了。
      }
    }
    notify();
  }

  return (
    <div
      ref={wrapRef}
      className={`relative w-full select-none overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-white ${
        fill ? 'min-h-0 flex-1' : ''
      } ${className}`}
      style={fill ? { overscrollBehavior: 'none' } : { height, overscrollBehavior: 'none' }}
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
        className="absolute inset-0 block cursor-crosshair"
        style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
        onPointerDown={beginStroke}
        onPointerMove={extendStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onLostPointerCapture={endStroke}
      />
    </div>
  );
});

export default SignaturePad;
