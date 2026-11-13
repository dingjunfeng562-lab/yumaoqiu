import { MatchStatus, PaymentStatus, Prisma, PrismaClient, RegistrationStatus } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/**
 * 删除单项会波及的数据。删除前的确认框和真正删除共用这一份统计，两边说的一致。
 * 报名表的去留和参赛选手页、缴费管理的「删除报名」一致：
 * - 已通过的报名表：别的项目里不再有已通过的报名，就整份删除；
 * - 待审核、已驳回的报名表：没有别的项目了，就整份删除；
 * - 兼项（还报了别的项目）的只去掉这一项，其他项目、报名表和缴费都不动。
 * 选手档案：线上报名生成的（有报名表）不再被引用就删；后台录入的只删临时档案，选手库里的正式选手保留。
 */
export async function collectEventDeleteImpact(db: Db, eventId: string) {
  const [registrations, items, matches] = await Promise.all([
    db.registration.findMany({
      where: { eventId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        paidAmount: true,
        competitionRegistrationId: true,
        player1Id: true,
        player2Id: true,
      },
    }),
    db.competitionRegistrationEventItem.findMany({
      where: { eventId },
      select: { competitionRegistrationId: true },
    }),
    db.match.findMany({
      where: { eventId },
      select: { status: true, side1Id: true, side2Id: true },
    }),
  ]);

  const applicationIds = uniqueIds([
    ...registrations.map((row) => row.competitionRegistrationId),
    ...items.map((item) => item.competitionRegistrationId),
  ]);
  const applications = applicationIds.length
    ? await db.competitionRegistration.findMany({
        where: { id: { in: applicationIds } },
        select: {
          id: true,
          status: true,
          eventItems: { where: { eventId: { not: eventId } }, select: { id: true } },
          registrations: {
            where: { eventId: { not: eventId }, status: RegistrationStatus.APPROVED },
            select: { id: true },
          },
        },
      })
    : [];
  const removedApplicationIds = applications
    .filter(
      (application) =>
        !application.registrations.length &&
        (application.status === RegistrationStatus.APPROVED || !application.eventItems.length),
    )
    .map((application) => application.id);

  const ownedPlayerIds = uniqueIds(
    registrations.filter((row) => row.competitionRegistrationId).flatMap((row) => [row.player1Id, row.player2Id]),
  );
  const adminPlayerIds = uniqueIds(
    registrations.filter((row) => !row.competitionRegistrationId).flatMap((row) => [row.player1Id, row.player2Id]),
  );
  // 只在这个项目里出现、也不在团体赛里的档案，删完报名后就没人用了。
  const onlyHere = {
    registrationsAsP1: { every: { eventId } },
    registrationsAsP2: { every: { eventId } },
    teamMembers: { none: {} },
    teamLineupsAsP1: { none: {} },
    teamLineupsAsP2: { none: {} },
  };
  const players =
    ownedPlayerIds.length || adminPlayerIds.length
      ? await db.player.count({
          where: {
            OR: [
              { id: { in: ownedPlayerIds }, ...onlyHere },
              { id: { in: adminPlayerIds }, isTemporary: true, ...onlyHere },
            ],
          },
        })
      : 0;

  const approved = registrations.filter((row) => row.status === RegistrationStatus.APPROVED);
  const paid = approved.filter((row) => row.paymentStatus === PaymentStatus.PAID);
  // 和删除报名的口径一致：已开始或已结束（轮空不算）。
  const started = matches.filter(
    (match) =>
      match.status === MatchStatus.LIVE ||
      (match.status === MatchStatus.COMPLETED && Boolean(match.side1Id) && Boolean(match.side2Id)),
  );

  return {
    removedApplicationIds,
    ownedPlayerIds,
    adminPlayerIds,
    summary: {
      /** 已通过的参赛记录条数（单打一人、双打一队算一条）。 */
      entries: approved.length,
      /** 其中已缴费的条数和金额（分），需要线下退款。 */
      paidCount: paid.length,
      paidAmount: paid.reduce((sum, row) => sum + (row.paidAmount ?? 0), 0),
      /** 涉及的待审核报名份数（这一项一并去掉）。 */
      pendingApplications: applications.filter((application) => application.status === RegistrationStatus.PENDING).length,
      /** 只报了这一项、整份报名表删除的人数。 */
      removedApplications: removedApplicationIds.length,
      /** 兼项的人数：只去掉这一项，其他项目、报名表和缴费不动。 */
      keptApplications: applications.length - removedApplicationIds.length,
      /** 一并删除的选手档案个数。 */
      players,
      matches: matches.length,
      startedMatches: started.length,
      liveMatches: matches.filter((match) => match.status === MatchStatus.LIVE).length,
    },
  };
}
