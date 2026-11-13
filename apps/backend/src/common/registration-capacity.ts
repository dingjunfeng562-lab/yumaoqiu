import { ConflictException } from '@nestjs/common';
import { EventType, Prisma, PrismaClient, RegistrationStatus } from '@prisma/client';
import { eventDisplayLabel } from './entrant';

type Db = PrismaClient | Prisma.TransactionClient;

const DOUBLES_TYPES = new Set<EventType>([EventType.MENS_DOUBLES, EventType.WOMENS_DOUBLES, EventType.MIXED_DOUBLES]);

/** 名额单位：单打按人，双打按队（一对算一个名额）。 */
export function entryUnit(type: EventType) {
  return DOUBLES_TYPES.has(type) ? '队' : '人';
}

/** 剩余名额；没设上限时为 null。后台超额添加后已报数可能超过上限，剩余按 0 算。 */
export function remainingSlots(limit: number | null | undefined, used: number | undefined) {
  return limit == null ? null : Math.max(0, limit - (used ?? 0));
}

/**
 * 各项目已占名额：已通过的参赛记录（含后台录入的），加上待审核报名里还没有参赛记录的项目。
 * 单打一人、双打一队算一个；驳回、移除的不占名额。
 */
export async function eventEntryCounts(db: Db, eventIds: string[]) {
  const ids = [...new Set(eventIds.filter(Boolean))];
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));
  if (!ids.length) return counts;
  const add = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  const [approved, pendingItems] = await Promise.all([
    db.registration.findMany({
      where: { eventId: { in: ids }, status: RegistrationStatus.APPROVED },
      select: { eventId: true },
    }),
    db.competitionRegistrationEventItem.findMany({
      where: { eventId: { in: ids }, competitionRegistration: { status: RegistrationStatus.PENDING } },
      select: { eventId: true, competitionRegistrationId: true },
    }),
  ]);
  for (const row of approved) add(row.eventId);
  if (pendingItems.length) {
    // 已通过的选手追加项目、需要线下核验时，报名表会回到待审核；原来那几项已有参赛记录，不能重复算。
    const covered = await db.registration.findMany({
      where: {
        competitionRegistrationId: { in: [...new Set(pendingItems.map((item) => item.competitionRegistrationId))] },
        eventId: { in: ids },
        status: RegistrationStatus.APPROVED,
      },
      select: { competitionRegistrationId: true, eventId: true },
    });
    const done = new Set(covered.map((row) => `${row.competitionRegistrationId}:${row.eventId}`));
    for (const item of pendingItems) {
      if (!done.has(`${item.competitionRegistrationId}:${item.eventId}`)) add(item.eventId);
    }
  }
  return counts;
}

/**
 * 各组别已报人数：一人一份报名表（报几个项目都算 1 人，待审核和已通过都算），
 * 加上后台直接录入、没有报名表的选手（同一人在本组几个项目里只算一次）。双打搭档不另外算。
 */
export async function groupEntrantCounts(db: Db, groupIds: string[]) {
  const ids = [...new Set(groupIds.filter(Boolean))];
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));
  if (!ids.length) return counts;
  const [applications, adminEntries] = await Promise.all([
    db.competitionRegistration.findMany({
      where: { groupId: { in: ids }, status: { in: [RegistrationStatus.PENDING, RegistrationStatus.APPROVED] } },
      select: { groupId: true },
    }),
    db.registration.findMany({
      where: { competitionRegistrationId: null, status: RegistrationStatus.APPROVED, event: { groupId: { in: ids } } },
      select: { player1Id: true, event: { select: { groupId: true } } },
    }),
  ]);
  for (const row of applications) {
    if (row.groupId) counts.set(row.groupId, (counts.get(row.groupId) ?? 0) + 1);
  }
  const seen = new Set<string>();
  for (const row of adminEntries) {
    const groupId = row.event.groupId;
    const key = `${groupId}:${row.player1Id}`;
    if (!groupId || seen.has(key)) continue;
    seen.add(key);
    counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }
  return counts;
}

type CapacityEvent = { id: string; type: EventType; groupLabel?: string | null; maxEntries?: number | null };
type CapacityGroup = { id: string; name: string; maxEntrants?: number | null };

/**
 * 扫码报名提交时检查名额，满了返回 409。只在设了上限时才查库。
 * 调用方要先锁住赛事（和报名提交同一把锁），两个人同时抢最后一个名额时只会进一个。
 * 后台添加、导入、审核通过不走这里，不受名额限制。
 * - events：这次新占名额的项目（已通过的选手追加项目时只传新加的项目）；
 * - newPerson：这次是否多出一个报名人（已通过的选手追加项目不再占组别人数）。
 */
export async function ensureRegistrationCapacity(
  db: Db,
  input: { group?: CapacityGroup | null; newPerson: boolean; events: CapacityEvent[] },
) {
  const group = input.group;
  if (input.newPerson && group && group.maxEntrants != null) {
    const used = (await groupEntrantCounts(db, [group.id])).get(group.id) ?? 0;
    if (used >= group.maxEntrants) {
      throw new ConflictException(`「${group.name}」报名人数已满（${used}/${group.maxEntrants} 人）`);
    }
  }
  const capped = input.events.filter((event) => event.maxEntries != null);
  if (!capped.length) return;
  const counts = await eventEntryCounts(db, capped.map((event) => event.id));
  const full = capped.filter((event) => (counts.get(event.id) ?? 0) >= (event.maxEntries ?? 0));
  if (!full.length) return;
  const detail = full
    .map((event) => `「${eventDisplayLabel(event)}」名额已满（${counts.get(event.id) ?? 0}/${event.maxEntries} ${entryUnit(event.type)}）`)
    .join('；');
  throw new ConflictException(input.events.length > 1 ? `${detail}，请去掉已满的项目后再提交` : detail);
}
