import sharp from 'sharp';
import { extractPdfImages, jpegSize } from './pdf-images';

describe('PDF 报名表图片提取', () => {
  async function jpeg(width = 800, height = 600) {
    return sharp({ create: { width, height, channels: 3, background: '#eeeeee' } }).jpeg().toBuffer();
  }

  function pdfWithJpeg(data: Buffer) {
    return Buffer.concat([
      Buffer.from('%PDF-1.4\n5 0 obj\n<< /Type /XObject /Subtype /Image /Width 800 /Height 600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + data.length + ' >>\nstream\n', 'latin1'),
      data,
      Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
    ]);
  }

  it('提取扫描件里内嵌的 JPEG 页面', async () => {
    const data = await jpeg();
    const images = extractPdfImages(pdfWithJpeg(data));
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ width: 800, height: 600 });
    expect(images[0].data.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('过滤掉小图标和重复图片', async () => {
    const tiny = await jpeg(60, 60);
    const images = extractPdfImages(pdfWithJpeg(tiny));
    expect(images).toHaveLength(0);
  });

  it('文字版 PDF 没有内嵌图片时返回空数组', () => {
    const textPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'latin1');
    expect(extractPdfImages(textPdf)).toEqual([]);
  });

  it('超过上限时保留大图，并按在文件里出现的顺序返回', async () => {
    const sizes = [[800, 1000], [400, 400], [900, 1200]] as const;
    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
    for (const [width, height] of sizes) {
      const data = await jpeg(width, height);
      parts.push(
        Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /Filter /DCTDecode /Length ${data.length} >>\nstream\n`, 'latin1'),
        data,
        Buffer.from('\nendstream\n', 'latin1'),
      );
    }
    const images = extractPdfImages(Buffer.concat(parts), { max: 2 });
    expect(images.map((image) => [image.width, image.height])).toEqual([[800, 1000], [900, 1200]]);
  });

  it('jpegSize 能读出 SOF 尺寸', async () => {
    expect(jpegSize(await jpeg(320, 240))).toEqual({ width: 320, height: 240 });
    expect(jpegSize(Buffer.from('not a jpeg'))).toBeNull();
  });
});
