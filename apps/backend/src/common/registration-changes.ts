import { ConflictException, ForbiddenException } from '@nestjs/common';
import { MatchStatus, Prisma, PrismaClient, Role } from '@prisma/client';
import { eventDisplayLabel } from './entrant';

type Db = PrismaClient | Prisma.TransactionClient;

/** 删除或调整报名的操作人。管理员的赛事范围由 RolesGuard 按路由和请求体校验。 */
export type ChangeActor = { id: string; role: Role; username?: string | null };

/** 改完需要重新抽签的单项。 */
export type RedrawEvent = { id: string; label: string };

/** 删除报名、修改报名信息和组别只开放给管理员和超级管理员。 */
export function requireAdminActor(
  actor: { role?: Role } | undefined,
  action: string,
): asserts actor is ChangeActor {
  if (!actor || (actor.role !== Role.ADMIN && actor.role !== Role.ROOT)) {
    throw new ForbiddenException(`只有管理员可以${action}`);
  }
}

export function formatDeadline(value: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

/** 过了赛事设置的报名信息修改截止时间，就不能再改报名信息和组别；删除不受影响。 */
export function ensureRegistrationEditable(
  tournament: { registrationEditDeadline?: Date | null },
  now = new Date(),
) {
  const deadline = tournament.registrationEditDeadline;
  if (deadline && now.getTime() > deadline.getTime()) {
    throw new ConflictException(
      `已过报名信息修改截止时间（${formatDeadline(deadline)}），不能再修改报名信息和组别；如需修改，请先在缴费管理中调整截止时间`,
    );
  }
}

/** 按固定顺序锁住单项，和记分、抽签的加锁顺序一致（先 Event 后 Match），避免死锁。 */
export async function lockEvents(
  tx: Prisma.TransactionClient,
  eventIds: string[],
) {
  for (const id of [...new Set(eventIds)].sort()) {
    await tx.$queryRaw`SELECT id FROM Event WHERE id = ${id} FOR UPDATE`;
  }
}

/**
 * 报名变动（删除、调走、调入）对签表的影响：
 * - 签表已冻结或已发布、或已有比赛开始或结束（轮空除外）：不允许，返回原因；
 * - 已生成签表或对阵：允许，但改完必须重新抽签；
 * - 还没抽签：不受影响。
 * 有任何一个项目不允许时整体拒绝，避免批量操作只做了一半。
 */
export async function checkEventsForEntrantChange(
  db: Db,
  eventIds: string[],
  verb: string,
): Promise<RedrawEvent[]> {
  const ids = [...new Set(eventIds)];
  if (!ids.length) return [];
  const [events, startedMatches] = await Promise.all([
    db.event.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        type: true,
        groupLabel: true,
        drawLocked: true,
        drawPublished: true,
        drawGeneratedAt: true,
        _count: {
          select: {
            matches: true,
            drawBrackets: { where: { isCurrent: true } },
          },
        },
      },
    }),
    db.match.findMany({
      where: {
        eventId: { in: ids },
        OR: [
          { status: MatchStatus.LIVE },
          {
            status: MatchStatus.COMPLETED,
            side1Id: { not: null },
            side2Id: { not: null },
          },
        ],
      },
      select: { eventId: true },
      distinct: ['eventId'],
    }),
  ]);
  const started = new Set(startedMatches.map((match) => match.eventId));
  const blockers: string[] = [];
  const redraw: RedrawEvent[] = [];
  for (const event of events) {
    const label = eventDisplayLabel(event);
    if (event.drawLocked || event.drawPublished) {
      blockers.push(`${label}签表已冻结或已发布，请先在抽签编排中取消发布`);
    } else if (started.has(event.id)) {
      blockers.push(`${label}已有比赛开始或结束`);
    } else if (
      event.drawGeneratedAt ||
      event._count.drawBrackets > 0 ||
      event._count.matches > 0
    ) {
      redraw.push({ id: event.id, label });
    }
  }
  if (blockers.length) {
    throw new ConflictException(`不能${verb}：${blockers.join('；')}`);
  }
  return redraw;
}

/** 标记签表需要重新抽签；重新抽签或清空签表时复位。 */
export async function markEventsStale(db: Db, events: RedrawEvent[]) {
  if (!events.length) return;
  await db.event.updateMany({
    where: { id: { in: events.map((event) => event.id) } },
    data: { drawStale: true },
  });
}

/**
 * 删除报名后清理不再被引用的选手档案。
 * - registrationOwned：线上报名审核通过时为这条报名单独生成的档案，无论标记如何都可删除；
 * - 其余只删临时录入的档案，选手库里的正式选手（从选手库选入）一律保留。
 * 仍被其他报名、团体赛队员或出场名单引用的档案不会删除。
 */
export async function deleteOrphanPlayers(
  db: Db,
  playerIds: Array<string | null | undefined>,
  options: { registrationOwned: boolean },
) {
  const ids = [...new Set(playerIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return 0;
  const result = await db.player.deleteMany({
    where: {
      id: { in: ids },
      ...(options.registrationOwned ? {} : { isTemporary: true }),
      registrationsAsP1: { none: {} },
      registrationsAsP2: { none: {} },
      teamMembers: { none: {} },
      teamLineupsAsP1: { none: {} },
      teamLineupsAsP2: { none: {} },
    },
  });
  return result.count;
}
