import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

export type WatermarkPosition = 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';
export const WATERMARK_POSITIONS: WatermarkPosition[] = [
  'TOP_LEFT',
  'TOP_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_RIGHT',
];
type TextWatermarkOptions = {
  content?: string | null;
  color?: string | null;
  heightPercent?: number | null;
  position?: string | null;
  font?: string | null;
};

/**
 * Watermark placement. Corners keep the legacy edge-margin behaviour; free
 * positions are the watermark block's center as percentages of the image.
 */
type WatermarkAnchor =
  | { kind: 'corner'; corner: WatermarkPosition }
  | { kind: 'free'; x: number; y: number };

export type TextFontType = 'HEITI' | 'SONGTI' | 'KAITI';
export const TEXT_FONT_OPTIONS: TextFontType[] = ['HEITI', 'SONGTI', 'KAITI'];
export const TEXT_FONT_LABELS: Record<TextFontType, string> = {
  HEITI: '黑体',
  SONGTI: '宋体',
  KAITI: '楷体',
};

/**
 * Builds and applies the per-tournament logo watermark to uploaded photos.
 *
 * Layout:
 *  - logo/text size is a percentage of the image's shorter edge (height for
 *    landscape, width for portrait), so both orientations look consistent
 *  - multiple elements are joined by the configured gap
 *  - composited at a legacy corner (24px edge margin) or a free center position
 *  - overall 85% opacity
 *
 * 输出不做压缩：未配置 logo 时原文件字节原样直出；合成 logo 时必须重编码一次
 * （像素已改变），JPEG 走质量 100 + 4:4:4 无色度抽样，PNG 输入保持无损 PNG 输出，
 * 分辨率始终不变。
 */
@Injectable()
export class WatermarkService {
  /** Default Logo height as a percentage of the image's shorter edge. */
  static readonly DEFAULT_LOGO_HEIGHT_PERCENT = 8;
  static readonly MIN_LOGO_HEIGHT_PERCENT = 2;
  static readonly MAX_LOGO_HEIGHT_PERCENT = 80;
  /** Gap between logos, expressed as a percentage of the logo height. */
  static readonly DEFAULT_LOGO_GAP_PERCENT = 20;
  static readonly MIN_LOGO_GAP_PERCENT = 0;
  static readonly MAX_LOGO_GAP_PERCENT = 200;
  /** Text watermark height as a percentage of the image's shorter edge. */
  static readonly DEFAULT_TEXT_SIZE_PERCENT = 6;
  static readonly MIN_TEXT_SIZE_PERCENT = 2;
  static readonly MAX_TEXT_SIZE_PERCENT = 80;
  static readonly DEFAULT_TEXT_COLOR = '#FFFFFF';
  static readonly MAX_TEXT_LENGTH = 100;
  static readonly DEFAULT_TEXT_FONT: TextFontType = 'HEITI';
  static readonly DEFAULT_TEXT_FONT_FAMILY =
    "'Noto Sans CJK SC','Noto Sans SC','Source Han Sans SC','Microsoft YaHei','SimHei','PingFang SC','WenQuanYi Micro Hei','WenQuanYi Zen Hei',sans-serif";
  static readonly DEFAULT_POSITION: WatermarkPosition = 'TOP_RIGHT';
  private readonly EDGE_MARGIN = 24;
  private readonly OPACITY = 0.85;
  private readonly THUMB_WIDTH = 400;
  private readonly TEXT_FONT_FAMILY =
    process.env.WATERMARK_FONT_FAMILY?.trim() || WatermarkService.DEFAULT_TEXT_FONT_FAMILY;

  private readonly FONT_MAP: Record<TextFontType, { file: string; family: string; weight: 'normal' | 'bold' }> = {
    HEITI: { file: 'NotoSansSC-Bold.otf', family: 'Noto Sans CJK SC Bold', weight: 'bold' },
    SONGTI: { file: 'NotoSerifSC-Regular.otf', family: 'Noto Serif CJK SC', weight: 'normal' },
    KAITI: { file: 'LXGWWenKai-Regular.ttf', family: 'LXGW WenKai', weight: 'normal' },
  };

  constructor() {
    // Register bundled CJK fonts so Chinese text renders correctly on all platforms.
    const fontsDir = join(process.cwd(), 'assets', 'fonts');
    for (const key of TEXT_FONT_OPTIONS) {
      try {
        const fontPath = join(fontsDir, this.FONT_MAP[key].file);
        if (existsSync(fontPath)) {
          GlobalFonts.registerFromPath(fontPath, this.FONT_MAP[key].family);
        }
      } catch {
        /* font registration is best-effort; fall back to system fonts */
      }
    }
  }

  private resolveFontFamily(font?: string | null): string {
    const key = (font as TextFontType) || 'HEITI';
    if (key && this.FONT_MAP[key]) {
      return `"${this.FONT_MAP[key].family}", sans-serif`;
    }
    return `"${this.FONT_MAP.HEITI.family}", sans-serif`;
  }

  private isBoldFont(font?: string | null): boolean {
    const key = (font as TextFontType) || 'HEITI';
    return this.FONT_MAP[key]?.weight === 'bold';
  }

  /**
   * Decode options shared by every pipeline that reads an uploaded photo.
   * - `limitInputPixels`: lifted well past sharp's ~268MP default so any
   *   resolution (large DSLR / phone panoramas) can be processed.
   * - `failOn: 'none'`: tolerate truncated / slightly malformed files instead
   *   of throwing, so one odd photo in a batch still uploads.
   */
  private readonly INPUT_OPTS = { failOn: 'none' as const, limitInputPixels: 1_000_000_000 };

  /**
   * Visual width/height after EXIF auto-orientation. `sharp.metadata()` reports
   * the raw stored pixels, so for orientation tags 5-8 (90°/270° rotations) the
   * stored width/height are swapped relative to how the image actually displays.
   */
  private orientedSize(meta: sharp.Metadata): { width: number; height: number } {
    const swap = (meta.orientation ?? 0) >= 5;
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    return swap ? { width: h, height: w } : { width: w, height: h };
  }

  /** Clamp the logo-height percent into the supported range. */
  private clampPercent(percent?: number | null): number {
    const value = percent ?? WatermarkService.DEFAULT_LOGO_HEIGHT_PERCENT;
    return Math.min(
      WatermarkService.MAX_LOGO_HEIGHT_PERCENT,
      Math.max(WatermarkService.MIN_LOGO_HEIGHT_PERCENT, Math.round(value)),
    );
  }

  /** Clamp the logo-gap percent into the supported range. */
  private clampGap(percent?: number | null): number {
    const value = percent ?? WatermarkService.DEFAULT_LOGO_GAP_PERCENT;
    return Math.min(
      WatermarkService.MAX_LOGO_GAP_PERCENT,
      Math.max(WatermarkService.MIN_LOGO_GAP_PERCENT, Math.round(value)),
    );
  }

  /** Clamp the text-size percent into the supported range. */
  private clampTextSize(percent?: number | null): number {
    const value = percent ?? WatermarkService.DEFAULT_TEXT_SIZE_PERCENT;
    return Math.min(
      WatermarkService.MAX_TEXT_SIZE_PERCENT,
      Math.max(WatermarkService.MIN_TEXT_SIZE_PERCENT, Math.round(value)),
    );
  }

  /** Accept #RGB / #RRGGBB hex only; fall back to white. */
  private sanitizeColor(color?: string | null): string {
    const v = (color ?? '').trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : WatermarkService.DEFAULT_TEXT_COLOR;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Render a text watermark element to a tightly-cropped PNG of ~heightPx tall.
   * Uses @napi-rs/canvas with a bundled CJK font so Chinese text renders
   * correctly on all platforms (Windows/Linux/macOS).
   * Returns null when the text is empty or rendering fails.
   */
  private async renderText(
    content: string,
    heightPx: number,
    color?: string | null,
    font?: string | null,
  ): Promise<{ buffer: Buffer; width: number; height: number } | null> {
    const text = content.trim().slice(0, WatermarkService.MAX_TEXT_LENGTH);
    if (!text) return null;
    const fontSize = Math.max(1, heightPx);
    const fill = this.sanitizeColor(color);
    const fontFamily = this.resolveFontFamily(font);
    const isBold = this.isBoldFont(font);

    try {
      const measureCanvas = createCanvas(1, 1);
      const mctx = measureCanvas.getContext('2d');
      mctx.font = `${isBold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
      const metrics = mctx.measureText(text);
      const textWidth = Math.ceil(metrics.width) + Math.ceil(fontSize * 0.4);
      const textHeight = Math.ceil(fontSize * 1.4);

      const canvas = createCanvas(textWidth, textHeight);
      const ctx = canvas.getContext('2d');
      ctx.font = `${isBold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
      ctx.fillStyle = fill;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(text, Math.ceil(fontSize * 0.2), textHeight / 2);

      const pngBuffer = canvas.toBuffer('image/png');

      // Trim transparent margins using sharp
      try {
        const trimmed = await sharp(pngBuffer).trim().toBuffer();
        const meta = await sharp(trimmed).metadata();
        return { buffer: trimmed, width: meta.width || 0, height: meta.height || fontSize };
      } catch {
        const meta = await sharp(pngBuffer).metadata();
        return { buffer: pngBuffer, width: meta.width || 0, height: meta.height || fontSize };
      }
    } catch {
      return null;
    }
  }

  /**
   * Horizontal strip of resized logos, placed side by side with a gap and
   * vertically centered. Sizes are relative to the image's shorter edge, so
   * portrait and landscape photos get the same visual watermark scale.
   */
  private async buildLogos(
    logos: Buffer[],
    baseSize: number,
    heightPercent: number,
    gapPercent: number,
  ): Promise<Buffer | null> {
    const logoH = Math.max(1, Math.floor((baseSize * heightPercent) / 100));

    const elements: Array<{ buffer: Buffer; width: number; height: number }> = [];
    for (const buf of logos) {
      const resized = await sharp(buf).resize(null, logoH, { fit: 'inside' }).png().toBuffer();
      const meta = await sharp(resized).metadata();
      elements.push({ buffer: resized, width: meta.width || 0, height: meta.height || logoH });
    }

    if (elements.length === 0) return null;
    if (elements.length === 1) return elements[0].buffer;

    // Gap is a percentage of the logo height.
    const gapPx = Math.round((logoH * gapPercent) / 100);
    const stripH = Math.max(...elements.map((e) => e.height));
    const totalWidth = elements.reduce(
      (sum, e, i) => sum + e.width + (i > 0 ? gapPx : 0),
      0,
    );

    let offsetX = 0;
    const inputs = elements.map((e) => {
      const item = { input: e.buffer, left: offsetX, top: Math.round((stripH - e.height) / 2) };
      offsetX += e.width + gapPx;
      return item;
    });

    return sharp({
      create: {
        width: Math.max(1, totalWidth),
        height: Math.max(1, stripH),
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(inputs)
      .png()
      .toBuffer();
  }

  /**
   * Produce the watermarked JPEG. When no logos are configured the original is
   * simply re-encoded so every photo lives under the public `full/` path.
   */
  /** Resolve corner position to absolute (left, top) on the source image. */
  private async fitWatermarkToImage(
    watermark: Buffer,
    imgW: number,
    imgH: number,
  ): Promise<{ buffer: Buffer; width: number; height: number } | null> {
    const meta = await sharp(watermark).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (width <= 0 || height <= 0) return null;

    const maxW = Math.max(1, imgW > this.EDGE_MARGIN * 2 ? imgW - this.EDGE_MARGIN * 2 : imgW);
    const maxH = Math.max(1, imgH > this.EDGE_MARGIN * 2 ? imgH - this.EDGE_MARGIN * 2 : imgH);
    if (width <= maxW && height <= maxH) return { buffer: watermark, width, height };

    const buffer = await sharp(watermark)
      .resize({ width: maxW, height: maxH, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    const fittedMeta = await sharp(buffer).metadata();
    const fittedW = fittedMeta.width || 0;
    const fittedH = fittedMeta.height || 0;
    if (fittedW <= 0 || fittedH <= 0) return null;
    return { buffer, width: fittedW, height: fittedH };
  }

  private resolveCornerOffset(
    position: WatermarkPosition,
    imgW: number,
    imgH: number,
    wmW: number,
    wmH: number,
  ): { left: number; top: number } {
    const isRight = position === 'TOP_RIGHT' || position === 'BOTTOM_RIGHT';
    const isBottom = position === 'BOTTOM_LEFT' || position === 'BOTTOM_RIGHT';
    const marginX = Math.min(this.EDGE_MARGIN, Math.max(0, Math.floor((imgW - wmW) / 2)));
    const marginY = Math.min(this.EDGE_MARGIN, Math.max(0, Math.floor((imgH - wmH) / 2)));
    const left = isRight ? Math.max(0, imgW - wmW - marginX) : marginX;
    const top = isBottom ? Math.max(0, imgH - wmH - marginY) : marginY;
    return { left, top };
  }

  private resolveFreeOffset(
    xPercent: number,
    yPercent: number,
    imgW: number,
    imgH: number,
    wmW: number,
    wmH: number,
  ): { left: number; top: number } {
    const left = Math.round((xPercent / 100) * imgW - wmW / 2);
    const top = Math.round((yPercent / 100) * imgH - wmH / 2);
    return {
      left: Math.min(Math.max(0, left), Math.max(0, imgW - wmW)),
      top: Math.min(Math.max(0, top), Math.max(0, imgH - wmH)),
    };
  }

  /**
   * Accept either a legacy corner name or a free "x,y" center (0–100).
   * Anything else falls back to the default corner.
   */
  private parseAnchor(position?: string | null): WatermarkAnchor {
    const value = (position ?? '').trim();
    if (WATERMARK_POSITIONS.includes(value as WatermarkPosition)) {
      return { kind: 'corner', corner: value as WatermarkPosition };
    }
    const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value);
    if (match) {
      const clamp = (n: number) => Math.min(100, Math.max(0, n));
      return { kind: 'free', x: clamp(Number(match[1])), y: clamp(Number(match[2])) };
    }
    return { kind: 'corner', corner: WatermarkService.DEFAULT_POSITION };
  }

  private async buildOverlay(
    watermark: Buffer,
    imgW: number,
    imgH: number,
    anchor: WatermarkAnchor,
  ): Promise<sharp.OverlayOptions | null> {
    const fittedWatermark = await this.fitWatermarkToImage(watermark, imgW, imgH);
    if (!fittedWatermark) return null;

    const { left, top } =
      anchor.kind === 'corner'
        ? this.resolveCornerOffset(
            anchor.corner,
            imgW,
            imgH,
            fittedWatermark.width,
            fittedWatermark.height,
          )
        : this.resolveFreeOffset(
            anchor.x,
            anchor.y,
            imgW,
            imgH,
            fittedWatermark.width,
            fittedWatermark.height,
          );

    const transparentWm = await sharp(fittedWatermark.buffer)
      .composite([
        {
          input: Buffer.from([255, 255, 255, Math.floor(this.OPACITY * 255)]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();

    return {
      input: transparentWm,
      left,
      top,
      blend: 'over',
    };
  }

  async applyWatermark(
    imageBuffer: Buffer,
    logos: Buffer[],
    logoHeightPercent?: number,
    logoGapPercent?: number,
    position?: string,
    text?: TextWatermarkOptions,
  ): Promise<{ buffer: Buffer; ext: '.jpg' | '.png' }> {
    const meta = await sharp(imageBuffer, this.INPUT_OPTS).metadata();
    const ext: '.jpg' | '.png' = meta.format === 'png' ? '.png' : '.jpg';

    const hasText = Boolean(text?.content && text.content.trim());

    // 未配置 logo 也未配置文字水印：原文件字节原样直出，零重编码、零压缩。
    // EXIF 方向标签保留，浏览器与相册会按标签正确显示方向。
    const passthrough = async () => {
      if (meta.format && meta.format !== 'jpeg' && meta.format !== 'png') {
        const buffer = await sharp(imageBuffer, this.INPUT_OPTS)
          .rotate()
          .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
          .toBuffer();
        return { buffer, ext: '.jpg' as const };
      }
      return { buffer: imageBuffer, ext };
    };
    if (logos.length === 0 && !hasText) {
      return passthrough();
    }
    // Use post-orientation dimensions so the watermark lands in the
    // visually-correct place and is sized against the displayed image.
    const { width: imgW, height: imgH } = this.orientedSize(meta);
    const safeW = imgW || 1000;
    const safeH = imgH || 1000;
    // Size the watermark from the shorter edge: height for landscape photos,
    // width for portrait photos. Sizing portrait watermarks by their (much
    // taller) height makes them look far too large next to the same setting on
    // a landscape photo.
    const baseSize = Math.min(safeW, safeH);

    const logoAnchor = this.parseAnchor(position);
    const textAnchor = this.parseAnchor(text?.position);
    const clampedText =
      hasText
        ? {
            content: text!.content!.trim(),
            color: text!.color ?? undefined,
            heightPercent: this.clampTextSize(text!.heightPercent),
            font: text!.font ?? undefined,
          }
        : undefined;

    const overlays: sharp.OverlayOptions[] = [];

    if (logos.length > 0) {
      const logoStrip = await this.buildLogos(
        logos,
        baseSize,
        this.clampPercent(logoHeightPercent),
        this.clampGap(logoGapPercent),
      );
      if (logoStrip) {
        const overlay = await this.buildOverlay(logoStrip, safeW, safeH, logoAnchor);
        if (overlay) overlays.push(overlay);
      }
    }

    if (clampedText) {
      const textH = Math.max(1, Math.floor((baseSize * clampedText.heightPercent) / 100));
      const renderedText = await this.renderText(
        clampedText.content,
        textH,
        clampedText.color,
        clampedText.font,
      );
      if (renderedText) {
        const overlay = await this.buildOverlay(renderedText.buffer, safeW, safeH, textAnchor);
        if (overlay) overlays.push(overlay);
      }
    }

    // If no overlay could be rendered, keep the original bytes.
    if (overlays.length === 0) return passthrough();

    // Auto-orient first so the composite coordinates match the visual image
    // (`.rotate()` bakes the EXIF orientation into pixels), then composite the
    // watermark at full resolution. 合成必须重编码：JPEG 用质量 100 + 4:4:4
    // 无色度抽样（视觉无损），PNG 保持无损输出，分辨率不变。
    const pipeline = sharp(imageBuffer, this.INPUT_OPTS).rotate().composite(overlays);
    const buffer =
      ext === '.png'
        ? await pipeline.png().toBuffer()
        : await pipeline.jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
    return { buffer, ext };
  }

  /**
   * 400px-wide thumbnail of the public full variant. `fit: 'inside'` keeps
   * the aspect ratio, so landscape stays landscape and portrait stays portrait.
   * `.rotate()` bakes EXIF orientation: the no-logo passthrough keeps the
   * original EXIF tag, so the thumb pipeline must orient pixels itself.
   */
  async generateThumbnail(watermarkedBuffer: Buffer): Promise<Buffer> {
    return sharp(watermarkedBuffer, this.INPUT_OPTS)
      .rotate()
      .resize(this.THUMB_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  }

  /** Visual (post EXIF auto-orientation) dimensions of an image buffer. */
  async dimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
    const meta = await sharp(buffer, this.INPUT_OPTS).metadata();
    return this.orientedSize(meta);
  }

  async imageInfo(buffer: Buffer): Promise<{ width: number; height: number; format?: string }> {
    const meta = await sharp(buffer, this.INPUT_OPTS).metadata();
    return { ...this.orientedSize(meta), format: meta.format };
  }
}
