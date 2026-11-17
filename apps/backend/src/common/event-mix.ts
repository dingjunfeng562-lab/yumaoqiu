import { ConflictException } from '@nestjs/common';
import { EventType, Prisma, PrismaClient } from '@prisma/client';
import { eventDisplayLabel, eventTypeLabel } from './entrant';

/**
 * 混编：同一赛事里同一类的单项（单打类：男单、女单；双打类：男双、女双、混双）合在一起打。
 *
 * - 并入的单项 Event.mixHostId 指向主项目；报名、资格、名额、缴费、审核仍按原单项和原组别。
 * - 抽签、种子、赛程、记分、名次都在主项目里统一进行，用主项目的赛制和计分规则；
 *   并入单项自己没有签表和场次。
 * - 只能在抽签前设置或取消（见 EventsService.setMix）。
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type MixCategory = 'SINGLES' | 'DOUBLES';

const SINGLES_TYPES: string[] = [EventType.MENS_SINGLES, EventType.WOMENS_SINGLES];

export const MIX_CATEGORY_LABELS: Record<MixCategory, string> = { SINGLES: '单打', DOUBLES: '双打' };

const TYPE_ABBR: Record<string, string> = {
  MENS_SINGLES: '男单',
  WOMENS_SINGLES: '女单',
  MENS_DOUBLES: '男双',
  WOMENS_DOUBLES: '女双',
  MIXED_DOUBLES: '混双',
};

const TYPE_ORDER: string[] = ['MENS_SINGLES', 'WOMENS_SINGLES', 'MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES'];

/** 单打类 / 双打类：只有同一类的单项能编在一起。 */
export function mixCategory(type: EventType | string): MixCategory {
  return SINGLES_TYPES.includes(type) ? 'SINGLES' : 'DOUBLES';
}

export type MixEventLike = {
  id?: string;
  type: EventType | string;
  groupLabel?: string | null;
};

/** 并入项目的顺序：按项目（男单、女单、男双、女双、混双），同项目按组别名。 */
function memberSort(a: MixEventLike, b: MixEventLike) {
  return TYPE_ORDER.indexOf(String(a.type)) - TYPE_ORDER.indexOf(String(b.type))
    || (a.groupLabel ?? '').localeCompare(b.groupLabel ?? '', 'zh-CN');
}

/**
 * 混编项目的展示名。第一个是主项目，排在最前；并入项目按 memberSort 排在后面，
 * 这样单项管理、抽签、公开页、导出算出来的名称都一样：
 * - 都是同一种项目：混编（高一组+高二高三组） · 男子单打
 * - 有不同项目：混编单打（高一组男单、高一组女单）
 */
export function mixLabel(events: MixEventLike[]): string {
  const [host, ...members] = events;
  const sorted = [host, ...[...members].sort(memberSort)];
  const types = [...new Set(sorted.map((event) => String(event.type)))];
  if (types.length === 1) {
    const groups = [...new Set(sorted.map((event) => event.groupLabel?.trim()).filter(Boolean))];
    return `混编（${groups.join('+')}） · ${eventTypeLabel(types[0] as EventType)}`;
  }
  const parts = sorted.map((event) => `${event.groupLabel?.trim() ?? ''}${TYPE_ABBR[String(event.type)] ?? event.type}`);
  return `混编${MIX_CATEGORY_LABELS[mixCategory(types[0])]}（${parts.join('、')}）`;
}

/** 选手的原项目，排名里「原项目」列用：高一组 · 女子单打。 */
export function mixOriginLabel(event: MixEventLike): string {
  return eventDisplayLabel({ type: event.type as EventType, groupLabel: event.groupLabel });
}

/** 主项目的展示名：有并入项目时是混编名，否则是普通的「组别 · 项目」。 */
export function hostDisplayLabel(event: MixEventLike & { mixMembers?: MixEventLike[] | null }): string {
  return event.mixMembers?.length ? mixLabel([event, ...event.mixMembers]) : mixOriginLabel(event);
}

/** 抽签、种子、名次用的报名范围：主项目 + 并入它的单项。普通单项就是它自己。 */
export async function mixEventIds(db: Db, eventId: string): Promise<string[]> {
  const members = await db.event.findMany({ where: { mixHostId: eventId }, select: { id: true } });
  return [eventId, ...members.map((member) => member.id)];
}

/** 并入混编的单项不能自己抽签、排名；提示到主项目操作。 */
export async function assertNotMixMember(
  db: Db,
  event: { mixHostId?: string | null },
  action = '抽签编排',
) {
  if (!event.mixHostId) return;
  const host = await db.event.findUnique({
    where: { id: event.mixHostId },
    select: { type: true, groupLabel: true, mixMembers: { select: { type: true, groupLabel: true } } },
  });
  const label = host ? hostDisplayLabel(host) : '主项目';
  throw new ConflictException(`该单项已并入「${label}」，请到主项目进行${action}`);
}

type WithMixMembers = {
  type: EventType | string;
  groupLabel?: string | null;
  registrations: object[];
  mixMembers?: Array<{ type: EventType | string; groupLabel?: string | null; registrations: object[] }> | null;
};

/** 报名行的类型（从单项的 registrations 推出来）。 */
type RegistrationOf<E> = E extends { registrations: Array<infer R> } ? R : never;

/** 合并后的单项：registrations 里每条可能带 mixOrigin（原项目）。 */
export type MixMerged<E> = Omit<E, 'registrations'> & {
  registrations: Array<RegistrationOf<E> & { mixOrigin?: string }>;
};

/**
 * 把并入项目的报名合进主项目（查询时 include 了 mixMembers.registrations）。
 * 只有混编主项目会给每条报名标上 mixOrigin（原项目），普通单项原样返回。
 */
export function mergeMixRegistrations<E extends WithMixMembers>(event: E): MixMerged<E> {
  const members = event.mixMembers ?? [];
  if (!members.length) return event as unknown as MixMerged<E>;
  const tag = (owner: MixEventLike, rows: object[]) =>
    rows.map((row) => ({ ...row, mixOrigin: mixOriginLabel(owner) }));
  return {
    ...event,
    registrations: [
      ...tag(event, event.registrations),
      ...members.flatMap((member) => tag(member, member.registrations)),
    ],
  } as unknown as MixMerged<E>;
}
