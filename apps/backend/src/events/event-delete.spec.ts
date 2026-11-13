import { MatchStatus, PaymentStatus, RegistrationStatus } from '@prisma/client';
import { collectEventDeleteImpact } from './event-delete';

const E = 'event-e';

/** 只实现 collectEventDeleteImpact 用到的查询；报名表的 eventItems / registrations 已按「不含本项目」过滤好。 */
function fakeDb() {
  const registrations = [
    // 只报了这一项、已缴费
    { id: 'r1', status: RegistrationStatus.APPROVED, paymentStatus: PaymentStatus.PAID, paidAmount: 5000, competitionRegistrationId: 'A', player1Id: 'p1', player2Id: null },
    // 兼项：还有别的已通过项目
    { id: 'r2', status: RegistrationStatus.APPROVED, paymentStatus: PaymentStatus.UNPAID, paidAmount: null, competitionRegistrationId: 'B', player1Id: 'p2', player2Id: 'p3' },
    // 后台录入（没有报名表）、已缴费
    { id: 'r3', status: RegistrationStatus.APPROVED, paymentStatus: PaymentStatus.PAID, paidAmount: 3000, competitionRegistrationId: null, player1Id: 'p5', player2Id: 'p6' },
    // 以前被移除的旧记录：不算参赛记录，也不算缴费
    { id: 'r4', status: RegistrationStatus.REMOVED, paymentStatus: PaymentStatus.PAID, paidAmount: 9900, competitionRegistrationId: 'B', player1Id: 'p2', player2Id: null },
  ];
  const items = ['A', 'B', 'C', 'D', 'R'].map((competitionRegistrationId) => ({ competitionRegistrationId }));
  const applications = [
    { id: 'A', status: RegistrationStatus.APPROVED, eventItems: [], registrations: [] },
    { id: 'B', status: RegistrationStatus.APPROVED, eventItems: [{ id: 'iB2' }], registrations: [{ id: 'rB2' }] },
    { id: 'C', status: RegistrationStatus.PENDING, eventItems: [], registrations: [] },
    { id: 'D', status: RegistrationStatus.PENDING, eventItems: [{ id: 'iD2' }], registrations: [] },
    { id: 'R', status: RegistrationStatus.REJECTED, eventItems: [], registrations: [] },
  ];
  const matches = [
    { status: MatchStatus.LIVE, side1Id: 'x', side2Id: 'y' },
    { status: MatchStatus.COMPLETED, side1Id: 'x', side2Id: 'y' },
    // 轮空：只有一方，不算已开赛
    { status: MatchStatus.COMPLETED, side1Id: 'x', side2Id: null },
    { status: MatchStatus.PENDING, side1Id: null, side2Id: null },
  ];
  return {
    registration: { findMany: jest.fn().mockResolvedValue(registrations) },
    competitionRegistrationEventItem: { findMany: jest.fn().mockResolvedValue(items) },
    match: { findMany: jest.fn().mockResolvedValue(matches) },
    competitionRegistration: { findMany: jest.fn().mockResolvedValue(applications) },
    player: { count: jest.fn().mockResolvedValue(4) },
  };
}

describe('删除单项的影响', () => {
  it('只报了这一项的整份报名表删除，兼项的只去掉这一项', async () => {
    const impact = await collectEventDeleteImpact(fakeDb() as never, E);
    // A 已通过、别处没有已通过的报名；C 待审核、R 已驳回，都没有别的项目了。
    expect(impact.removedApplicationIds).toEqual(['A', 'C', 'R']);
    expect(impact.summary.removedApplications).toBe(3);
    // B 还有别的已通过项目，D 待审核但还报了别的项目。
    expect(impact.summary.keptApplications).toBe(2);
    expect(impact.summary.pendingApplications).toBe(2);
  });

  it('统计已通过的参赛记录、已缴费金额和比赛；轮空不算已开赛', async () => {
    const impact = await collectEventDeleteImpact(fakeDb() as never, E);
    expect(impact.summary).toMatchObject({
      entries: 3,
      paidCount: 2,
      paidAmount: 8000,
      matches: 4,
      startedMatches: 2,
      liveMatches: 1,
      players: 4,
    });
  });

  it('选手档案：线上报名生成的不再被引用就删，后台录入的只删临时档案', async () => {
    const db = fakeDb();
    const impact = await collectEventDeleteImpact(db as never, E);
    expect(impact.ownedPlayerIds).toEqual(['p1', 'p2', 'p3']);
    expect(impact.adminPlayerIds).toEqual(['p5', 'p6']);
    const [owned, admin] = db.player.count.mock.calls[0][0].where.OR;
    expect(owned.id.in).toEqual(['p1', 'p2', 'p3']);
    expect(owned.isTemporary).toBeUndefined();
    expect(admin).toMatchObject({ id: { in: ['p5', 'p6'] }, isTemporary: true });
    // 只在这个项目里出现、也不在团体赛里的才算。
    expect(owned.registrationsAsP1).toEqual({ every: { eventId: E } });
    expect(owned.teamMembers).toEqual({ none: {} });
  });

  it('没有任何报名时不查报名表和选手档案', async () => {
    const db = {
      registration: { findMany: jest.fn().mockResolvedValue([]) },
      competitionRegistrationEventItem: { findMany: jest.fn().mockResolvedValue([]) },
      match: { findMany: jest.fn().mockResolvedValue([]) },
      competitionRegistration: { findMany: jest.fn() },
      player: { count: jest.fn() },
    };
    const impact = await collectEventDeleteImpact(db as never, E);
    expect(impact.summary).toMatchObject({ entries: 0, removedApplications: 0, keptApplications: 0, players: 0, matches: 0 });
    expect(db.competitionRegistration.findMany).not.toHaveBeenCalled();
    expect(db.player.count).not.toHaveBeenCalled();
  });
});
