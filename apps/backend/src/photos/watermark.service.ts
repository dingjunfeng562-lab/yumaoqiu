import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

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
  position?: WatermarkPosition | null;
};

/**
 * Builds and applies the per-tournament logo watermark to uploaded photos.
 *
 * Layout (per spec):
 *  - logos scaled to 8% of the image height
 *  - multiple logos joined by a white "×" separator, 16px gaps
 *  - composited in the top-right corner, 24px from the top/right edges
 *  - overall 85% opacity
 *
 * 输出不做压缩：未配置 logo 时原文件字节原样直出；合成 logo 时必须重编码一次
 * （像素已改变），JPEG 走质量 100 + 4:4:4 无色度抽样，PNG 输入保持无损 PNG 输出，
 * 分辨率始终不变。
 */
@Injectable()
export class WatermarkService {
  /** Default Logo height as a percentage of the image height. */
  static readonly DEFAULT_LOGO_HEIGHT_PERCENT = 8;
  static readonly MIN_LOGO_HEIGHT_PERCENT = 2;
  static readonly MAX_LOGO_HEIGHT_PERCENT = 80;
  /** Gap between logos, expressed as a percentage of the logo height. */
  static readonly DEFAULT_LOGO_GAP_PERCENT = 20;
  static readonly MIN_LOGO_GAP_PERCENT = 0;
  static readonly MAX_LOGO_GAP_PERCENT = 200;
  /** Text watermark height as a percentage of the image height. */
  static readonly DEFAULT_TEXT_SIZE_PERCENT = 6;
  static readonly MIN_TEXT_SIZE_PERCENT = 2;
  static readonly MAX_TEXT_SIZE_PERCENT = 80;
  static readonly DEFAULT_TEXT_COLOR = '#FFFFFF';
  static readonly MAX_TEXT_LENGTH = 100;
  static readonly DEFAULT_TEXT_FONT_FAMILY =
    "'Noto Sans CJK SC','Noto Sans SC','Source Han Sans SC','Microsoft YaHei','SimHei','PingFang SC','WenQuanYi Micro Hei','WenQuanYi Zen Hei',sans-serif";
  static readonly DEFAULT_POSITION: WatermarkPosition = 'TOP_RIGHT';
  private readonly EDGE_MARGIN = 24;
  private readonly OPACITY = 0.85;
  private readonly THUMB_WIDTH = 400;
  private readonly TEXT_FONT_FAMILY =
    process.env.WATERMARK_FONT_FAMILY?.trim() || WatermarkService.DEFAULT_TEXT_FONT_FAMILY;

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
   * Drawn via SVG (sharp uses librsvg/fontconfig); a CJK font must be installed
   * on the host for Chinese text to render — otherwise it falls back to boxes.
   * Returns null when the text is empty or rendering fails.
   */
  private async renderText(
    content: string,
    heightPx: number,
    color?: string | null,
  ): Promise<{ buffer: Buffer; width: number; height: number } | null> {
    const text = content.trim().slice(0, WatermarkService.MAX_TEXT_LENGTH);
    if (!text) return null;
    const fontSize = Math.max(1, heightPx);
    const fill = this.sanitizeColor(color);
    // Generous canvas; CJK glyphs ~1em wide, latin narrower — over-allocate then trim.
    const canvasW = Math.ceil(text.length * fontSize * 1.4) + fontSize * 2;
    const canvasH = Math.ceil(fontSize * 1.6);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">` +
      `<text x="${Math.round(fontSize * 0.2)}" y="${Math.round(canvasH / 2)}" ` +
      `font-family="${this.escapeXml(this.TEXT_FONT_FAMILY)}" ` +
      `font-size="${fontSize}" font-weight="bold" fill="${fill}" ` +
      `dominant-baseline="central" text-anchor="start">${this.escapeXml(text)}</text>` +
      `</svg>`;
    try {
      const base = await sharp(Buffer.from(svg)).png().toBuffer();
      let buffer = base;
      try {
        buffer = await sharp(base).trim().toBuffer(); // crop transparent margins to the glyph box
      } catch {
        /* uniform/blank canvas (e.g. missing font) → keep untrimmed */
      }
      const meta = await sharp(buffer).metadata();
      return { buffer, width: meta.width || 0, height: meta.height || fontSize };
    } catch {
      return null;
    }
  }

  /**
   * Horizontal strip of resized logos + optional text element, placed side by
   * side with a gap and vertically centered. Returns null when nothing to draw.
   */
  private async buildWatermark(
    logos: Buffer[],
    imageHeight: number,
    heightPercent: number,
    gapPercent: number,
    text?: { content: string; color?: string | null; heightPercent: number },
  ): Promise<Buffer | null> {
    const logoH = Math.max(1, Math.floor((imageHeight * heightPercent) / 100));

    const elements: Array<{ buffer: Buffer; width: number; height: number }> = [];
    for (const buf of logos) {
      const resized = await sharp(buf).resize(null, logoH, { fit: 'inside' }).png().toBuffer();
      const meta = await sharp(resized).metadata();
      elements.push({ buffer: resized, width: meta.width || 0, height: meta.height || logoH });
    }
    if (text?.content?.trim()) {
      const textH = Math.max(1, Math.floor((imageHeight * text.heightPercent) / 100));
      const rendered = await this.renderText(text.content, textH, text.color);
      if (rendered) elements.push(rendered);
    }

    if (elements.length === 0) return null;
    if (elements.length === 1) return elements[0].buffer;

    // Gap is a percentage of the logo height (or the first element's height when
    // there are no logos, e.g. text-only watermark with several elements).
    const refH = logos.length ? logoH : elements[0].height;
    const gapPx = Math.round((refH * gapPercent) / 100);
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

  private normalizePosition(position?: WatermarkPosition | null): WatermarkPosition {
    return WATERMARK_POSITIONS.includes(position as WatermarkPosition)
      ? (position as WatermarkPosition)
      : WatermarkService.DEFAULT_POSITION;
  }

  private async buildOverlay(
    watermark: Buffer,
    imgW: number,
    imgH: number,
    position: WatermarkPosition,
  ): Promise<sharp.OverlayOptions | null> {
    const fittedWatermark = await this.fitWatermarkToImage(watermark, imgW, imgH);
    if (!fittedWatermark) return null;

    const { left, top } = this.resolveCornerOffset(
      position,
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
    position?: WatermarkPosition,
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
    // Use post-orientation dimensions so the logo lands in the visually-correct
    // corner and is sized against the displayed height.
    const { width: imgW, height: imgH } = this.orientedSize(meta);
    const safeW = imgW || 1000;
    const safeH = imgH || 1000;

    const pos = this.normalizePosition(position);
    const textPos = this.normalizePosition(text?.position);
    const clampedText =
      hasText
        ? {
            content: text!.content!.trim(),
            color: text!.color ?? undefined,
            heightPercent: this.clampTextSize(text!.heightPercent),
          }
        : undefined;
    const overlays: sharp.OverlayOptions[] = [];

    const combinedText = clampedText && textPos === pos ? clampedText : undefined;
    const logoWatermark = await this.buildWatermark(
      logos,
      safeH,
      this.clampPercent(logoHeightPercent),
      this.clampGap(logoGapPercent),
      combinedText,
    );
    // If every requested overlay fails to render, keep the original bytes.
    if (logoWatermark) {
      const overlay = await this.buildOverlay(logoWatermark, safeW, safeH, pos);
      if (overlay) overlays.push(overlay);
    }

    if (clampedText && textPos !== pos) {
      const textH = Math.max(1, Math.floor((safeH * clampedText.heightPercent) / 100));
      const renderedText = await this.renderText(clampedText.content, textH, clampedText.color);
      if (renderedText) {
        const overlay = await this.buildOverlay(renderedText.buffer, safeW, safeH, textPos);
        if (overlay) overlays.push(overlay);
      }
    }

    if (overlays.length === 0) return passthrough();

    // Auto-orient first so the composite coordinates match the visual image
    // (`.rotate()` bakes the EXIF orientation into pixels), then composite the
    // watermark at full resolution. 合成必须重编码：JPEG 用质量 100 + 4:4:4
    // 无色度抽样（视觉无损），PNG 保持无损输出，分辨率不变。
    const pipeline = sharp(imageBuffer, this.INPUT_OPTS)
      .rotate()
      .composite(overlays);
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
