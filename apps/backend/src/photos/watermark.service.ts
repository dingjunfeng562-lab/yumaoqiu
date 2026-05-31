import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

export type WatermarkPosition = 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';
export const WATERMARK_POSITIONS: WatermarkPosition[] = [
  'TOP_LEFT',
  'TOP_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_RIGHT',
];

/**
 * Builds and applies the per-tournament logo watermark to uploaded photos.
 *
 * Layout (per spec):
 *  - logos scaled to 8% of the image height
 *  - multiple logos joined by a white "×" separator, 16px gaps
 *  - composited in the top-right corner, 24px from the top/right edges
 *  - overall 85% opacity, output as JPEG quality 95
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
  static readonly DEFAULT_POSITION: WatermarkPosition = 'TOP_RIGHT';
  private readonly EDGE_MARGIN = 24;
  private readonly OPACITY = 0.85;
  private readonly THUMB_WIDTH = 500;

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

  /** Horizontal strip of resized logos placed side by side with a gap. */
  private async buildWatermark(
    logos: Buffer[],
    imageHeight: number,
    heightPercent: number,
    gapPercent: number,
  ): Promise<Buffer> {
    const logoH = Math.max(1, Math.floor((imageHeight * heightPercent) / 100));

    const resizedLogos = await Promise.all(
      logos.map((buf) => sharp(buf).resize(null, logoH, { fit: 'inside' }).png().toBuffer()),
    );

    if (resizedLogos.length === 1) {
      return resizedLogos[0];
    }

    const gapPx = Math.round((logoH * gapPercent) / 100);
    const metas = await Promise.all(resizedLogos.map((e) => sharp(e).metadata()));
    const totalWidth = metas.reduce(
      (sum, m, i) => sum + (m.width || 0) + (i > 0 ? gapPx : 0),
      0,
    );

    let offsetX = 0;
    const inputs = resizedLogos.map((buf, i) => {
      const item = { input: buf, left: offsetX, top: 0 };
      offsetX += (metas[i].width || 0) + gapPx;
      return item;
    });

    return sharp({
      create: {
        width: Math.max(1, totalWidth),
        height: logoH,
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
   * simply re-encoded so every photo lives under the public `watermark/` path.
   */
  /** Resolve corner position to absolute (left, top) on the source image. */
  private resolveCornerOffset(
    position: WatermarkPosition,
    imgW: number,
    imgH: number,
    wmW: number,
    wmH: number,
  ): { left: number; top: number } {
    const isRight = position === 'TOP_RIGHT' || position === 'BOTTOM_RIGHT';
    const isBottom = position === 'BOTTOM_LEFT' || position === 'BOTTOM_RIGHT';
    const left = isRight
      ? Math.max(0, imgW - wmW - this.EDGE_MARGIN)
      : this.EDGE_MARGIN;
    const top = isBottom
      ? Math.max(0, imgH - wmH - this.EDGE_MARGIN)
      : this.EDGE_MARGIN;
    return { left, top };
  }

  async applyWatermark(
    imageBuffer: Buffer,
    logos: Buffer[],
    logoHeightPercent?: number,
    logoGapPercent?: number,
    position?: WatermarkPosition,
  ): Promise<Buffer> {
    if (logos.length === 0) {
      return sharp(imageBuffer).jpeg({ quality: 95 }).toBuffer();
    }

    const meta = await sharp(imageBuffer).metadata();
    const imgW = meta.width || 1000;
    const imgH = meta.height || 1000;

    const watermark = await this.buildWatermark(
      logos,
      imgH,
      this.clampPercent(logoHeightPercent),
      this.clampGap(logoGapPercent),
    );
    const wmMeta = await sharp(watermark).metadata();
    const wmW = wmMeta.width || 0;
    const wmH = wmMeta.height || 0;
    const pos = WATERMARK_POSITIONS.includes(position as WatermarkPosition)
      ? (position as WatermarkPosition)
      : WatermarkService.DEFAULT_POSITION;
    const { left, top } = this.resolveCornerOffset(pos, imgW, imgH, wmW, wmH);

    // Multiply the whole strip's alpha by OPACITY via a tiled dest-in blend.
    const transparentWm = await sharp(watermark)
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

    return sharp(imageBuffer)
      .composite([
        {
          input: transparentWm,
          left,
          top,
          blend: 'over',
        },
      ])
      .jpeg({ quality: 95 })
      .toBuffer();
  }

  /** 500px-wide thumbnail of an already-watermarked JPEG. */
  async generateThumbnail(watermarkedBuffer: Buffer): Promise<Buffer> {
    return sharp(watermarkedBuffer)
      .resize(this.THUMB_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  }

  /** Dimensions of an image buffer. */
  async dimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
    const meta = await sharp(buffer).metadata();
    return { width: meta.width || 0, height: meta.height || 0 };
  }
}
