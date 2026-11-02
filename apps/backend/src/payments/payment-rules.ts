import { EntrantType, EventType, PaymentStatus, Prisma, PrismaClient, RegistrationStatus } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export type FeeSetting = {
  enabled: boolean;
  singlesFee: number;
  doublesFee: number;
  teamFee: number;
};

export type FeeKind = 'SINGLES' | 'DOUBLES' | 'TEAM';

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  [PaymentStatus.UNPAID]: '未缴费',
  [PaymentStatus.PAID]: '已缴费',
  [PaymentStatus.WAIVED]: '免缴',
};

const DOUBLES_TYPES = new Set<EventType>([
  EventType.MENS_DOUBLES,
  EventType.WOMENS_DOUBLES,
  EventType.MIXED_DOUBLES,
]);

export function feeKindForEvent(type: EventType): FeeKind {
  return DOUBLES_TYPES.has(type) ? 'DOUBLES' : 'SINGLES';
}

/** 应缴金额（分）；组别未开启收费时为 0。双打按对、团体赛按队。 */
export function feeAmount(setting: FeeSetting | null | undefined, kind: FeeKind): number {
  if (!setting?.enabled) return 0;
  if (kind === 'TEAM') return setting.teamFee;
  return kind === 'DOUBLES' ? setting.doublesFee : setting.singlesFee;
}

/** 联系方式比对前去掉空白、横线和 +86 前缀，避免录入格式不同导致查不到。 */
export function normalizeContact(value: string | null | undefined): string {
  return (value ?? '').replace(/[\s\-()（）]/g, '').replace(/^(\+?86)(?=1\d{10}$)/, '');
}

export function formatYuan(fen: number): string {
  return (fen / 100).toFixed(fen % 100 === 0 ? 0 : 2);
}

export function unpaidMessage(subject: string, names: string[]): string {
  const shown = names.slice(0, 10).join('、');
  const more = names.length > 10 ? ` 等 ${names.length} 个` : '';
  return `以下${subject}未缴费：${shown}${more}。请先在「缴费管理」确认缴费或设为免缴，再进行抽签编排。`;
}

async function enabledSetting(db: Db, tournamentId: string, entrantType: EntrantType) {
  const setting = await db.tournamentPaymentSetting.findUnique({
    where: { tournamentId_entrantType: { tournamentId, entrantType } },
  });
  return setting?.enabled ? setting : null;
}

/** 单项中已通过审核但未缴费的报名。组别未收费或该类项目金额为 0 时不拦截。 */
export async function unpaidEventEntrants(
  db: Db,
  event: { id: string; tournamentId: string; entrantType: EntrantType; type: EventType },
) {
  const setting = await enabledSetting(db, event.tournamentId, event.entrantType);
  if (feeAmount(setting, feeKindForEvent(event.type)) <= 0) return [];
  const rows = await db.registration.findMany({
    where: { eventId: event.id, status: RegistrationStatus.APPROVED, paymentStatus: PaymentStatus.UNPAID },
    select: {
      id: true,
      name: true,
      player1: { select: { name: true } },
      player2: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({ id: row.id, name: registrationDisplayName(row) }));
}

/** 团体赛中未缴费的队伍。 */
export async function unpaidTeams(
  db: Db,
  competition: { id: string; tournamentId: string; entrantType: EntrantType },
) {
  const setting = await enabledSetting(db, competition.tournamentId, competition.entrantType);
  if (feeAmount(setting, 'TEAM') <= 0) return [];
  return db.team.findMany({
    where: { teamCompetitionId: competition.id, paymentStatus: PaymentStatus.UNPAID },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
}

export function registrationDisplayName(row: {
  name?: string | null;
  player1?: { name: string } | null;
  player2?: { name: string } | null;
}): string {
  if (row.player1) return row.player2 ? `${row.player1.name} / ${row.player2.name}` : row.player1.name;
  return row.name ?? '';
}
