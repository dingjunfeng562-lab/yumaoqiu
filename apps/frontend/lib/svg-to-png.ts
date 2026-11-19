/**
 * 把后端画好的 SVG（如对阵图）在浏览器里转成 PNG 并下载。
 * 默认 2 倍清晰度；图特别大时自动降低倍数，避免超出浏览器画布上限（单边 16384 像素）。
 */
const MAX_SIDE = 16000;
const MAX_PIXELS = 80_000_000;

export function pngScale(width: number, height: number) {
  return Math.min(2, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_PIXELS / (width * height)));
}

export async function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
  const scale = pngScale(width, height);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('对阵图渲染失败，请换用 Chrome 或 Edge 浏览器重试'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持生成图片');
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('生成图片失败，请重试'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
