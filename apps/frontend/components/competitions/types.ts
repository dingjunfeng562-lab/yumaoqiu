// GET /api/competitions 列表里每个赛事的字段（前台用到的部分）。
export type PublicCompetition = {
  id: string;
  title: string;
  coverImage?: string | null;
  startDate: string;
  endDate: string;
  location?: string | null;
  events?: string[];
  projects?: string[];
  /** REGISTRATION_NOT_STARTED | REGISTRATION_OPEN | REGISTRATION_CLOSED | ONGOING | FINISHED */
  status?: string;
  statusLabel?: string;
  registrationStatus?: string;
  registrationStartTime?: string | null;
  registrationEndTime?: string | null;
  needsRegistrationReview?: boolean;
  registeredCount?: number;
  /** 赛事主页被打开的次数 */
  viewCount?: number;
};

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, '');

export function normalizeCover(url?: string | null) {
  if (!url) return '/generated/competition-cover-1.png';
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('/api/')) return `${API_ORIGIN}${url}`;
  if (url.startsWith('/')) return url;
  return '/generated/competition-cover-1.png';
}

// 固定按北京时间显示，服务端渲染（容器可能是 UTC）和浏览器结果一致，避免水合不一致。
const TIME_ZONE = 'Asia/Shanghai';

export function formatDate(value?: string | null) {
  if (!value) return '待定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TIME_ZONE });
}

/** 2026/11/08 08:30；没有时间返回「待定」 */
export function formatDateTime(value?: string | null) {
  if (!value) return '待定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TIME_ZONE,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}

/** 11-08 08:30 */
export function formatMonthDayTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TIME_ZONE,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** 08:30 */
export function formatClock(value?: string | null) {
  const full = formatMonthDayTime(value);
  return full ? full.slice(6) : null;
}
