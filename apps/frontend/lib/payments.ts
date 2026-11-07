const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const API_ORIGIN = API_BASE.replace(/\/api\/?$/, '');

export type PaymentStatus = 'UNPAID' | 'PAID' | 'WAIVED';
export type PlayerPaymentStatus = PaymentStatus | 'NOT_REQUIRED' | 'PENDING_REVIEW' | 'REJECTED';
export type EntrantType = 'SCHOOL' | 'SOCIAL';

export const ENTRANT_LABELS: Record<EntrantType, string> = { SCHOOL: '学生组', SOCIAL: '第三方' };

export const PAYMENT_STATUS_META: Record<PlayerPaymentStatus, { label: string; color: string }> = {
  UNPAID: { label: '待缴费', color: 'orange' },
  PAID: { label: '缴费成功', color: 'green' },
  WAIVED: { label: '免缴', color: 'blue' },
  NOT_REQUIRED: { label: '无需缴费', color: 'default' },
  PENDING_REVIEW: { label: '待审核，通过后缴费', color: 'default' },
  REJECTED: { label: '报名已驳回', color: 'red' },
};

export type PaymentItemView = {
  id: string;
  kind: 'EVENT' | 'TEAM';
  itemName: string;
  name: string;
  amount: number;
  status: PlayerPaymentStatus;
  paidAt: string | null;
  note: string | null;
};

export type PaymentGroupView = {
  groupId?: string;
  competitionId: string;
  competitionName: string;
  entrantType: EntrantType;
  groupLabel: string;
  required: boolean;
  instructions: string | null;
  qrImageUrl: string | null;
  totalDue: number;
  totalPaid: number;
  items: PaymentItemView[];
};

/** 金额以分存储，展示为元。 */
export function yuan(fen: number | null | undefined) {
  const value = (fen ?? 0) / 100;
  return `¥${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

export function toFen(value: number | null | undefined) {
  return Math.round((value ?? 0) * 100);
}

export function uploadUrl(value?: string | null) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith('/api/') ? `${API_ORIGIN}${value}` : value;
}
