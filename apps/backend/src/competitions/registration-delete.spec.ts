import { NotFoundException } from '@nestjs/common';
import {
  EntrantType,
  EventType,
  PaymentStatus,
  RegistrationStatus,
  Role,
} from '@prisma/client';
import { CompetitionsService } from './competitions.service';

const actor = { id: 'admin-1', role: Role.ADMIN, username: '赛事管理员' };

function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reg-1',
    eventId: 'event-ms',
    competitionRegistrationId: 'app-1',
    player1Id: 'p1',
    player2Id: null,
    paymentStatus: PaymentStatus.PAID,
    paidAmount: 5000,
    name: '张三',
    event: {
      id: 'event-ms',
      tournamentId: 't1',
      type: EventType.MENS_SINGLES,
      groupLabel: '学生组',
      entrantType: EntrantType.SCHOOL,
    },
    player1: { name: '张三' },
    player2: null,
    ...overrides,
  };
}

/** 删除报名时用到的事务方法；签表状态默认「还没抽签」。 */
function buildTx(options: {
  registrations: unknown[];
  application?: unknown;
  events?: unknown[];
}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    registration: {
      findMany: jest.fn().mockResolvedValue(options.registrations),
      deleteMany: jest
        .fn()
        .mockResolvedValue({ count: options.registrations.length }),
    },
    event: {
      findMany: jest.fn().mockResolvedValue(
        options.events ?? [
          {
            id: 'event-ms',
            type: EventType.MENS_SINGLES,
            groupLabel: '学生组',
            drawLocked: false,
            drawPublished: false,
            drawGeneratedAt: null,
            _count: { matches: 0, drawBrackets: 0 },
          },
        ],
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    match: { findMany: jest.fn().mockResolvedValue([]) },
    paymentLog: { create: jest.fn().mockResolvedValue({}) },
    competitionRegistration: {
      findUnique: jest.fn().mockResolvedValue(options.application ?? null),
      delete: jest.fn().mockResolvedValue({}),
    },
    competitionRegistrationEventItem: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    player: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
}

const service = new CompetitionsService(
  {} as never,
  { send: jest.fn() } as never,
);

describe('删除单项报名的联动', () => {
  it('只删这一项：报名表里还有别的项目时只删对应项目，并记一条删除记录', async () => {
    const tx = buildTx({
      registrations: [registration()],
      application: {
        id: 'app-1',
        eventItems: [
          { id: 'item-ms', eventId: 'event-ms' },
          { id: 'item-md', eventId: 'event-md' },
        ],
        registrations: [{ eventId: 'event-md' }],
      },
    });

    const result = await service.deleteEventRegistrationsInTx(
      tx as never,
      't1',
      ['reg-1'],
      actor,
      '未按时缴费',
    );

    expect(result).toEqual({ deleted: 1, redrawEvents: [] });
    expect(tx.paymentLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'DELETE',
      registrationId: 'reg-1',
      targetName: '张三',
      fromStatus: PaymentStatus.PAID,
      toStatus: PaymentStatus.PAID,
      amount: 5000,
      note: '未按时缴费',
      operatorName: '赛事管理员',
    });
    expect(tx.registration.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['reg-1'] } },
    });
    expect(tx.competitionRegistrationEventItem.deleteMany).toHaveBeenCalledWith(
      { where: { id: { in: ['item-ms'] } } },
    );
    expect(tx.competitionRegistration.delete).not.toHaveBeenCalled();
    // 线上报名生成的选手档案：不限制临时标记。
    expect(tx.player.deleteMany.mock.calls[0][0].where.id).toEqual({
      in: ['p1'],
    });
    expect(
      tx.player.deleteMany.mock.calls[0][0].where.isTemporary,
    ).toBeUndefined();
  });

  it('删到最后一项时整份报名表删除', async () => {
    const tx = buildTx({
      registrations: [registration()],
      application: {
        id: 'app-1',
        eventItems: [{ id: 'item-ms', eventId: 'event-ms' }],
        registrations: [],
      },
    });

    await service.deleteEventRegistrationsInTx(
      tx as never,
      't1',
      ['reg-1'],
      actor,
    );

    expect(tx.competitionRegistration.delete).toHaveBeenCalledWith({
      where: { id: 'app-1' },
    });
    expect(
      tx.competitionRegistrationEventItem.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('以前改项目时报名表没跟着改：删一条不再对应任何报名的项目', async () => {
    const tx = buildTx({
      registrations: [registration()],
      application: {
        id: 'app-1',
        eventItems: [
          { id: 'item-old', eventId: 'event-ws' },
          { id: 'item-md', eventId: 'event-md' },
        ],
        registrations: [{ eventId: 'event-md' }],
      },
    });

    await service.deleteEventRegistrationsInTx(
      tx as never,
      't1',
      ['reg-1'],
      actor,
    );

    expect(tx.competitionRegistrationEventItem.deleteMany).toHaveBeenCalledWith(
      { where: { id: { in: ['item-old'] } } },
    );
  });

  it('后台录入的报名只清理临时档案', async () => {
    const tx = buildTx({
      registrations: [
        registration({ competitionRegistrationId: null, player2Id: 'p2' }),
      ],
    });

    await service.deleteEventRegistrationsInTx(
      tx as never,
      't1',
      ['reg-1'],
      actor,
    );

    expect(tx.competitionRegistration.findUnique).not.toHaveBeenCalled();
    const adminCall = tx.player.deleteMany.mock.calls.find(
      (call) => call[0].where.isTemporary === true,
    );
    expect(adminCall?.[0].where.id).toEqual({ in: ['p1', 'p2'] });
  });

  it('已抽签未冻结的项目可以删，删完标记需要重新抽签', async () => {
    const tx = buildTx({
      registrations: [registration()],
      application: { id: 'app-1', eventItems: [], registrations: [] },
      events: [
        {
          id: 'event-ms',
          type: EventType.MENS_SINGLES,
          groupLabel: '学生组',
          drawLocked: false,
          drawPublished: false,
          drawGeneratedAt: new Date(),
          _count: { matches: 4, drawBrackets: 1 },
        },
      ],
    });

    const result = await service.deleteEventRegistrationsInTx(
      tx as never,
      't1',
      ['reg-1'],
      actor,
    );

    expect(result.redrawEvents).toEqual([
      { id: 'event-ms', label: '学生组 · 男子单打' },
    ]);
    expect(tx.event.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['event-ms'] } },
      data: { drawStale: true },
    });
  });

  it('签表已发布时整批不删', async () => {
    const tx = buildTx({
      registrations: [registration()],
      events: [
        {
          id: 'event-ms',
          type: EventType.MENS_SINGLES,
          groupLabel: '学生组',
          drawLocked: true,
          drawPublished: true,
          drawGeneratedAt: new Date(),
          _count: { matches: 4, drawBrackets: 1 },
        },
      ],
    });

    await expect(
      service.deleteEventRegistrationsInTx(tx as never, 't1', ['reg-1'], actor),
    ).rejects.toThrow(/签表已冻结或已发布/);
    expect(tx.paymentLog.create).not.toHaveBeenCalled();
    expect(tx.registration.deleteMany).not.toHaveBeenCalled();
  });

  it('不属于该赛事的报名不能删', async () => {
    const tx = buildTx({
      registrations: [
        registration({
          event: { ...registration().event, tournamentId: 'other' },
        }),
      ],
    });

    await expect(
      service.deleteEventRegistrationsInTx(tx as never, 't1', ['reg-1'], actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.registration.deleteMany).not.toHaveBeenCalled();
  });

  it('只有管理员可以删除', async () => {
    await expect(
      service.deleteAdminRegistrations('t1', ['reg-1'], {
        id: 'r1',
        role: Role.REFEREE,
      }),
    ).rejects.toThrow('只有管理员可以删除报名');
  });
});

describe('参赛选手查询的报名状态', () => {
  it('编辑时只读取已通过的报名', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue({
        ...registration(),
        status: RegistrationStatus.REMOVED,
      });
    const svc = new CompetitionsService(
      { registration: { findUnique } } as never,
      { send: jest.fn() } as never,
    );
    await expect(svc.getAdminPlayer('t1', 'reg-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
