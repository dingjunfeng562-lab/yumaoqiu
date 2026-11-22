import { createHash } from 'crypto';
import { inflateSync } from 'zlib';

/**
 * 从 PDF 里取出页面图片（扫描件、拍照转 PDF 的常见形态），不依赖任何 PDF 渲染库。
 * 支持 DCTDecode（JPEG）和未使用预测器的 8 位 FlateDecode（原始 RGB/灰度）图像。
 * 文字版 PDF 没有内嵌图片，返回空数组，由调用方决定是否改用服务商的原生 PDF 输入。
 */
export type PdfPageImage = {
  data: Buffer;
  width: number;
  height: number;
  /** true 表示 data 是解压后的原始像素，需配合 width/height/channels 转成图片。 */
  raw?: boolean;
  channels?: 1 | 2 | 3 | 4;
};

export function extractPdfImages(
  buffer: Buffer,
  options: { max?: number; minWidth?: number; minHeight?: number } = {},
): PdfPageImage[] {
  const max = options.max ?? 6;
  const minWidth = options.minWidth ?? 300;
  const minHeight = options.minHeight ?? 300;
  const text = buffer.toString('latin1');
  const results: PdfPageImage[] = [];
  const seen = new Set<string>();

  const dictPattern = /\/Subtype\s*\/Image/g;
  let match: RegExpExecArray | null;
  while ((match = dictPattern.exec(text))) {
    const dictStart = text.lastIndexOf('<<', match.index);
    const streamMatch = /stream\r?\n/.exec(text.slice(match.index, match.index + 6000));
    if (dictStart < 0 || !streamMatch) continue;
    const streamStart = match.index + streamMatch.index + streamMatch[0].length;
    const dict = text.slice(dictStart, match.index + streamMatch.index);

    const width = Number(/\/Width\s+(\d+)/.exec(dict)?.[1] ?? 0);
    const height = Number(/\/Height\s+(\d+)/.exec(dict)?.[1] ?? 0);
    if (!width || !height || width < minWidth || height < minHeight) continue;

    const lengthMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let end: number;
    if (lengthMatch && Number(lengthMatch[1]) > 0 && streamStart + Number(lengthMatch[1]) <= buffer.length) {
      end = streamStart + Number(lengthMatch[1]);
    } else {
      const endAt = text.indexOf('endstream', streamStart);
      if (endAt < 0) continue;
      end = endAt;
      while (end > streamStart && (buffer[end - 1] === 0x0a || buffer[end - 1] === 0x0d)) end -= 1;
    }
    if (end <= streamStart) continue;

    const filter = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(dict)?.[1] ?? '';

    if (filter.includes('DCTDecode')) {
      let data = buffer.subarray(streamStart, end);
      const soi = data.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
      const eoi = data.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (soi < 0 || eoi <= soi) continue;
      data = data.subarray(soi, eoi + 2);
      const size = jpegSize(data);
      if (!size || size.width < minWidth || size.height < minHeight) continue;
      const hash = digest(data);
      if (seen.has(hash)) continue;
      seen.add(hash);
      results.push({ data, width: size.width, height: size.height });
      continue;
    }

    if (filter.includes('FlateDecode') && !/\/DecodeParms/.test(dict)) {
      const bits = Number(/\/BitsPerComponent\s+(\d+)/.exec(dict)?.[1] ?? 0);
      const color = /\/ColorSpace\s*\/(DeviceRGB|DeviceGray|DeviceCMYK)/.exec(dict)?.[1];
      if (bits !== 8 || !color) continue;
      const channels: 1 | 3 | 4 = color === 'DeviceRGB' ? 3 : color === 'DeviceGray' ? 1 : 4;
      const expected = width * height * channels;
      if (expected > 200_000_000) continue;
      let raw: Buffer;
      try {
        raw = inflateSync(buffer.subarray(streamStart, end));
      } catch {
        continue;
      }
      if (raw.length < expected) continue;
      const data = raw.subarray(0, expected);
      const hash = digest(data);
      if (seen.has(hash)) continue;
      seen.add(hash);
      results.push({ data, width, height, raw: true, channels });
    }
  }

  // 超过上限时优先保留大图（整页扫描），再按在文件里出现的顺序返回（通常就是页序）。
  return results
    .map((image, index) => ({ image, index }))
    .sort((a, b) => b.image.width * b.image.height - a.image.width * a.image.height)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map(({ image }) => image);
}

function digest(data: Buffer) {
  return createHash('sha1').update(data).digest('hex');
}

/** 读取 JPEG 的 SOF 尺寸；解析失败返回 null。 */
export function jpegSize(data: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = data[offset + 1];
    while (marker === 0xff) {
      offset += 1;
      marker = data[offset + 1];
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}
