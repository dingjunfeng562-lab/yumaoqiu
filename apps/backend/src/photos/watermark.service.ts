import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

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
  private readonly LOGO_HEIGHT_RATIO = 0.08;
  private readonly EDGE_MARGIN = 24;
  private readonly GAP = 16;
  private readonly OPACITY = 0.85;
  private readonly THUMB_WIDTH = 500;

  /** Horizontal strip of resized logos joined by "×" separators. */
  private async buildWatermark(logos: Buffer[], imageHeight: number): Promise<Buffer> {
    const logoH = Math.max(1, Math.floor(imageHeight * this.LOGO_HEIGHT_RATIO));

    const resizedLogos = await Promise.all(
      logos.map((buf) => sharp(buf).resize(null, logoH, { fit: 'inside' }).png().toBuffer()),
    );

    if (resizedLogos.length === 1) {
      return resizedLogos[0];
    }

    const separator = Buffer.from(
      `<svg width="${Math.floor(logoH * 0.6)}" height="${logoH}" xmlns="http://www.w3.org/2000/svg">` +
        `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" ` +
        `font-size="${Math.floor(logoH * 0.7)}" fill="white" font-family="sans-serif">×</text>` +
        `</svg>`,
    );
    const sepBuf = await sharp(separator).png().toBuffer();

    const elements: Buffer[] = [];
    resizedLogos.forEach((logo, i) => {
      elements.push(logo);
      if (i < resizedLogos.length - 1) elements.push(sepBuf);
    });

    const metas = await Promise.all(elements.map((e) => sharp(e).metadata()));
    const totalWidth = metas.reduce(
      (sum, m, i) => sum + (m.width || 0) + (i > 0 ? this.GAP : 0),
      0,
    );

    let offsetX = 0;
    const inputs = elements.map((buf, i) => {
      const item = { input: buf, left: offsetX, top: 0 };
      offsetX += (metas[i].width || 0) + this.GAP;
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
  async applyWatermark(imageBuffer: Buffer, logos: Buffer[]): Promise<Buffer> {
    if (logos.length === 0) {
      return sharp(imageBuffer).jpeg({ quality: 95 }).toBuffer();
    }

    const meta = await sharp(imageBuffer).metadata();
    const imgW = meta.width || 1000;
    const imgH = meta.height || 1000;

    const watermark = await this.buildWatermark(logos, imgH);
    const wmMeta = await sharp(watermark).metadata();
    const wmW = wmMeta.width || 0;

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
          left: Math.max(0, imgW - wmW - this.EDGE_MARGIN),
          top: this.EDGE_MARGIN,
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
