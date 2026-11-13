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

/** 后台缴费明细里排序和导出用到的字段。 */
export type PaymentRowLike = { paymentStatus: PaymentStatus; amountDue: number };

/** 缴费管理表格的排序档位：未缴费（需缴）→ 已缴费 → 免缴 → 无需缴费。 */
export function paymentSortRank(row: PaymentRowLike) {
  if (row.paymentStatus === 'UNPAID') return row.amountDue > 0 ? 0 : 3;
  return row.paymentStatus === 'PAID' ? 1 : 2;
}

/** 未缴费的排在前面；同一档位保持接口返回的顺序（项目、报名先后）。 */
export function sortPaymentRows<T extends PaymentRowLike>(rows: T[]): T[] {
  return [...rows].sort((a, b) => paymentSortRank(a) - paymentSortRank(b));
}

/** 未缴费名单：要缴费但还没缴的。 */
export function isUnpaidDue(row: PaymentRowLike) {
  return row.paymentStatus === 'UNPAID' && row.amountDue > 0;
}

/** 已缴费名单：已缴费和免缴的，也就是已经结清的。 */
export function isSettled(row: PaymentRowLike) {
  return row.paymentStatus === 'PAID' || row.paymentStatus === 'WAIVED';
}

export type PaymentListKind = 'UNPAID' | 'SETTLED';

export type PaymentListRow = PaymentRowLike & {
  groupId?: string | null;
  itemId: string;
  itemName: string;
  name: string;
  members?: string;
  affiliation: string;
  contact: string;
  paidAmount: number | null;
  paidAt: string | null;
  confirmedByName: string | null;
  paymentNote: string | null;
};

/**
 * 导出用的未缴费 / 已缴费名单：整个赛事全部组别，不受页面筛选影响。按组别、项目排序，同一项目里保持报名先后，
 * 最后一行是合计。不收费的（显示「无需」的）两份都不进，两份加起来就是各组统计里「需缴费」的总数。
 * 缴费按项目收，兼项的人每个项目一行；一项已缴、一项未缴时两份名单各出现一次。金额以元导出，便于在 Excel 里求和。
 */
export function paymentListSheet<T extends PaymentListRow>(
  rows: T[],
  kind: PaymentListKind,
  options: {
    groupOrder: string[];
    itemOrder: string[];
    groupName: (row: T) => string;
    formatTime: (value: string) => string;
  },
): Array<Record<string, string | number>> {
  const position = (list: string[], value: string | null | undefined) => {
    const index = value ? list.indexOf(value) : -1;
    return index < 0 ? list.length : index;
  };
  const picked = rows
    .filter(kind === 'UNPAID' ? isUnpaidDue : isSettled)
    .sort((a, b) =>
      position(options.groupOrder, a.groupId) - position(options.groupOrder, b.groupId)
      || position(options.itemOrder, a.itemId) - position(options.itemOrder, b.itemId));
  if (!picked.length) return [];
  const blank = { 项目: '', 参赛方: '', 队员: '', 单位: '', 联系方式: '' };
  const base = (row: T, index: number) => ({
    序号: index + 1,
    组别: options.groupName(row),
    项目: row.itemName,
    参赛方: row.name,
    队员: row.members ?? '',
    单位: row.affiliation,
    联系方式: row.contact,
  });
  if (kind === 'UNPAID') {
    const total = picked.reduce((sum, row) => sum + row.amountDue, 0);
    return [
      ...picked.map((row, index) => ({ ...base(row, index), 应缴金额: row.amountDue / 100, 备注: row.paymentNote ?? '' })),
      { 序号: '合计', 组别: `${picked.length} 项`, ...blank, 应缴金额: total / 100, 备注: '' },
    ];
  }
  const paid = (row: T) => (row.paymentStatus === 'PAID' ? row.paidAmount ?? 0 : 0);
  const total = picked.reduce((sum, row) => sum + paid(row), 0);
  return [
    ...picked.map((row, index) => ({
      ...base(row, index),
      状态: row.paymentStatus === 'WAIVED' ? '免缴' : '已缴费',
      实缴金额: paid(row) / 100,
      确认时间: row.paidAt ? options.formatTime(row.paidAt) : '',
      确认人: row.confirmedByName ?? '',
      备注: row.paymentNote ?? '',
    })),
    { 序号: '合计', 组别: `${picked.length} 项`, ...blank, 状态: '', 实缴金额: total / 100, 确认时间: '', 确认人: '', 备注: '' },
  ];
}
