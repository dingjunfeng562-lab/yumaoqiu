import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EntrantType, EventType, PaymentStatus } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { AdminPaymentsController } from './admin-payments.controller';
import { feeAmount, feeKindForEvent, normalizeContact, unpaidEventEntrants, unpaidTeams } from './payment-rules';
import { PaymentsService, paymentItemStatus } from './payments.service';

const setting = { enabled: true, singlesFee: 3000, doublesFee: 6000, teamFee: 20000 };

describe('payment fee rules', () => {
  it('charges singles per entry, doubles per pair and teams per team', () => {
    expect(feeAmount(setting, feeKindForEvent(EventType.MENS_SINGLES))).toBe(3000);
    expect(feeAmount(setting, feeKindForEvent(EventType.MIXED_DOUBLES))).toBe(6000);
    expect(feeAmount(setting, 'TEAM')).toBe(20000);
    expect(feeAmount({ ...setting, enabled: false }, 'TEAM')).toBe(0);
    expect(feeAmount(null, 'SINGLES')).toBe(0);
  });

  it('normalizes contact formats before comparing', () => {
    expect(normalizeContact(' 138-0013 8000 ')).toBe('13800138000');
    expect(normalizeContact('+86 13800138000')).toBe('13800138000');
    expect(normalizeContact('8613800138000')).toBe('13800138000');
    expect(normalizeContact('010-6666 8888')).toBe('01066668888');
  });

  it('maps player-facing status', () => {
    expect(paymentItemStatus(3000, { pending: true })).toBe('PENDING_REVIEW');
    expect(paymentItemStatus(0, { paymentStatus: PaymentStatus.UNPAID })).toBe('NOT_REQUIRED');
    expect(paymentItemStatus(3000, { paymentStatus: PaymentStatus.UNPAID })).toBe(PaymentStatus.UNPAID);
    expect(paymentItemStatus(0, { paymentStatus: PaymentStatus.WAIVED })).toBe(PaymentStatus.WAIVED);
  });
});

describe('draw payment gate', () => {
  const event = { id: 'e1', tournamentId: 't1', entrantType: EntrantType.SCHOOL, type: EventType.MENS_DOUBLES };

  it('does not block when the group does not charge', async () => {
    const db = {
      tournamentPaymentSetting: { findUnique: jest.fn().mockResolvedValue({ ...setting, enabled: false }) },
      registration: { findMany: jest.fn() },
    };
    expect(await unpaidEventEntrants(db as never, event)).toEqual([]);
    expect(db.registration.findMany).not.toHaveBeenCalled();
  });

  it('does not block when this kind of event is free', async () => {
    const db = {
      tournamentPaymentSetting: { findUnique: jest.fn().mockResolvedValue({ ...setting, doublesFee: 0 }) },
      registration: { findMany: jest.fn() },
    };
    expect(await unpaidEventEntrants(db as never, event)).toEqual([]);
  });

  it('lists approved unpaid entries by player names', async () => {
    const db = {
      tournamentPaymentSetting: { findUnique: jest.fn().mockResolvedValue(setting) },
      registration: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r1', name: null, player1: { name: '张三' }, player2: { name: '李四' } },
        ]),
      },
    };
    expect(await unpaidEventEntrants(db as never, event)).toEqual([{ id: 'r1', name: '张三 / 李四' }]);
    expect(db.registration.findMany.mock.calls[0][0].where).toEqual({
      eventId: 'e1', status: 'APPROVED', paymentStatus: 'UNPAID',
    });
  });

  it('lists unpaid teams only when team fee is charged', async () => {
    const teams = [{ id: 'team1', name: '一队' }];
    const db = {
      tournamentPaymentSetting: { findUnique: jest.fn().mockResolvedValue(setting) },
      team: { findMany: jest.fn().mockResolvedValue(teams) },
    };
    expect(await unpaidTeams(db as never, { id: 'tc', tournamentId: 't1', entrantType: EntrantType.SOCIAL })).toEqual(teams);
    db.tournamentPaymentSetting.findUnique.mockResolvedValue({ ...setting, teamFee: 0 });
    expect(await unpaidTeams(db as never, { id: 'tc', tournamentId: 't1', entrantType: EntrantType.SOCIAL })).toEqual([]);
  });
});

describe('admin payment scope', () => {
  const prisma = {
    tournament: { findFirst: jest.fn(async ({ where }) => (where.id === 'owned' ? { id: 'owned' } : null)) },
    registration: {
      findUnique: jest.fn(async ({ where }) => ({ event: { tournamentId: where.id === 'own-reg' ? 'owned' : 'other' } })),
    },
    team: { findUnique: jest.fn() },
  };
  const guard = new RolesGuard(new Reflector(), prisma as never);
  function context(action: string, params: Record<string, string>, body: unknown = {}, permissions = ['PAYMENTS']) {
    return {
      getClass: () => AdminPaymentsController,
      getHandler: () => (AdminPaymentsController.prototype as any)[action],
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'admin', role: 'ADMIN', permissions }, params, query: {}, body }),
      }),
    } as ExecutionContext;
  }

  it('lets an admin manage payments of their own competition', async () => {
    expect(await guard.canActivate(context('overview', { competitionId: 'owned' }))).toBe(true);
    expect(await guard.canActivate(context('updateStatus', { competitionId: 'owned' }, {
      status: 'PAID', entries: [{ registrationId: 'own-reg' }],
    }))).toBe(true);
  });

  it("hides other admins' competitions and registrations", async () => {
    await expect(guard.canActivate(context('overview', { competitionId: 'other' }))).rejects.toBeInstanceOf(NotFoundException);
    await expect(guard.canActivate(context('updateStatus', { competitionId: 'owned' }, {
      status: 'PAID', entries: [{ registrationId: 'foreign-reg' }],
    }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires the PAYMENTS permission', async () => {
    expect(await guard.canActivate(context('overview', { competitionId: 'owned' }, {}, ['PLAYERS']))).toBe(false);
  });
});

describe('public payment lookup', () => {
  it('matches exact name with normalized contact across sources', async () => {
    const prisma = {
      player: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', contact: '138 0013 8000' },
          { id: 'p2', contact: '13900000000' },
        ]),
      },
      registration: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'r1', paymentStatus: 'PAID', paidAmount: 3000, paidAt: new Date('2026-11-01'),
          player1: { name: '张三' }, player2: null,
          event: { type: 'MENS_SINGLES', groupLabel: '学生组', entrantType: 'SCHOOL', tournament: { id: 't1', name: '秋季赛' } },
        }]),
      },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      competitionRegistration: { findMany: jest.fn().mockResolvedValue([]) },
      tournamentPaymentSetting: {
        findMany: jest.fn().mockResolvedValue([{ tournamentId: 't1', entrantType: 'SCHOOL', ...setting, instructions: '转账备注姓名', qrImageUrl: null }]),
      },
    };
    const service = new PaymentsService(prisma as never);
    const result = await service.lookup(' 张三 ', '13800138000');

    const where = prisma.registration.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ player1Id: { in: ['p1'] } }, { player2Id: { in: ['p1'] } }]);
    expect(where.event).toEqual({ tournament: { isPublished: true } });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      competitionName: '秋季赛', groupLabel: '学生组', required: true, totalPaid: 3000, totalDue: 0,
    });
    expect(result.groups[0].items[0]).toMatchObject({ name: '张三', itemName: '学生组 · 男子单打', status: 'PAID', amount: 3000 });
  });

  it('rejects incomplete input', async () => {
    const service = new PaymentsService({} as never);
    await expect(service.lookup('张三', '138')).rejects.toThrow('请输入姓名和完整的联系方式');
  });
});

describe('rejected registrations', () => {
  function lookupPrisma(pending: unknown[], registrations: unknown[] = []) {
    return {
      player: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', contact: '13800138000' }]) },
      registration: { findMany: jest.fn().mockResolvedValue(registrations) },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      competitionRegistration: { findMany: jest.fn().mockResolvedValue(pending) },
      tournamentPaymentSetting: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }
  const rejected = {
    id: 'cr1', competitionId: 't1', status: 'REJECTED', rejectReason: '单位填写有误', name: '王五', contact: '138 0013 8000',
    competition: { id: 't1', name: '秋季赛' },
    eventItems: [{ id: 'i1', partnerName: null, event: { type: 'MENS_SINGLES', groupLabel: '社会组', entrantType: 'SOCIAL' } }],
  };

  it('shows a rejected registration with its reason in the public lookup', async () => {
    const prisma = lookupPrisma([rejected]);
    const result = await new PaymentsService(prisma as never).lookup('王五', '13800138000');
    expect(prisma.competitionRegistration.findMany.mock.calls[0][0].where.status).toEqual({ in: ['PENDING', 'REJECTED'] });
    expect(result.groups[0].items[0]).toMatchObject({ status: 'REJECTED', note: '单位填写有误', amount: 0 });
  });

  it('hides the old rejection once the person has registered again', async () => {
    const resubmitted = { ...rejected, id: 'cr2', status: 'PENDING', rejectReason: null };
    const result = await new PaymentsService(lookupPrisma([resubmitted, rejected]) as never).lookup('王五', '13800138000');
    expect(result.groups[0].items.map((item) => item.status)).toEqual(['NOT_REQUIRED']);
  });
});
