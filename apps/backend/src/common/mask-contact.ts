/**
 * 公开页面展示的联系方式打码：选手自己认得出，外人拿不到完整号码。
 * 手机号 13812345678 → 138****5678；其他写法按长度保留首尾少量字符；「无」「-」等占位视为未填。
 */
export function maskContact(value: string | null | undefined): string {
  const text = (value ?? '').replace(/\s+/g, '');
  if (!text || /^(无|没有|暂无|-+|\/|null|undefined)$/i.test(text)) return '';
  const chars = [...text];
  if (/^1\d{10}$/.test(text)) return `${text.slice(0, 3)}****${text.slice(-4)}`;
  if (chars.length >= 11) return `${chars.slice(0, 3).join('')}****${chars.slice(-4).join('')}`;
  if (chars.length >= 7) return `${chars.slice(0, 2).join('')}****${chars.slice(-2).join('')}`;
  if (chars.length >= 3) return `${chars[0]}****${chars[chars.length - 1]}`;
  return '****';
}
