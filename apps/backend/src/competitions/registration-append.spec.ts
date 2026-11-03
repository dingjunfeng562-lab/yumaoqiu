import { ConflictException } from '@nestjs/common';
import {
  EntrantType,
  EventType,
  Gender,
  Prisma,
  RegistrationStatus,
  Role,
  TournamentStatus,
} from '@prisma/client';
import { CompetitionsService } from './competitions.service';

const T = 't-1';
const MS = 'ev-ms';
const MD = 'ev-md';
const XD = 'ev-xd';

function event(id: string, type: EventType) {
  return {
    id,
    tournamentId: T,
    type,
    groupLabel: null,
    entrantType: EntrantType.SCHOOL,
  };
}

const EVENTS: Record<string, ReturnType<typeof event>> = {
  [MS]: event(MS, EventType.MENS_SINGLES),
  [MD]: event(MD, EventType.MENS_DOUBLES),
  [XD]: event(XD, EventType.MIXED_DOUBLES),
};

function tournament(overrides: Record<string, unknown> = {}) {
  return {
    id: T,
    name: '冀南测试赛',
    status: TournamentStatus.REGISTRATION_OPEN,
    registrationStartDate: new Date('2026-10-01T00:00:00Z'),
    registrationEndDate: new Date('2026-11-13T00:00:00Z'),
    startDate: new Date('2026-11-15T00:00:00Z'),
    endDate: new Date('2026-11-16T00:00:00Z'),
    maxRegistrationEvents: 2,
    allowCrossEventRegistration: true,
    needsRegistrationReview: false,
    allowSchoolRegistration: true,
    allowSocialRegistration: true,
    registrationFieldRules: null,
    registrationCodeEnabled: true,
    schoolRegistrationCode: 'SCHOOL01',
    schoolRegistrationCodeEnabled: true,
    socialRegistrationCode: 'SOCIAL01',
    socialRegistrationCodeEnabled: true,
    isArchived: false,
    isPublished: true,
    events: Object.values(EVENTS).map((item) => ({
      ...item,
      registrations: [],
    })),
    competitionRegistrations: [],
    ...overrides,
  };
}

function item(
  id: string,
  eventId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    competitionRegistrationId: 'cr-guest',
    eventId,
    event: EVENTS[eventId],
    partnerName: null,
    partnerGender: null,
    partnerStudentId: null,
    partnerSchool: null,
    partnerCollege: null,
    partnerMajorGrade: null,
    partnerClassName: null,
    partnerContact: null,
    teamName: null,
    createdAt: new Date('2026-11-02T00:00:00Z'),
    ...extra,
  };
}

/** 第一次扫码报了男单、已通过的游客报名。 */
function guestRegistration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cr-guest',
    competitionId: T,
    userId: null,
    user: null,
    entrantType: EntrantType.SCHOOL,
    studentId: '2024001',
    college: '信息学院',
    majorGrade: null,
    guestToken: 'guest-token-1',
    guestEmail: null,
    name: '张三',
    gender: Gender.MALE,
    school: '河北工程大学',
    className: '信息学院',
    contact: '13800138000',
    remark: null,
    status: RegistrationStatus.APPROVED,
    rejectReason: null,
    reviewedAt: new Date('2026-11-02T00:00:00Z'),
    reviewedById: null,
    createdAt: new Date('2026-11-02T00:00:00Z'),
    updatedAt: new Date('2026-11-02T00:00:00Z'),
    eventItems: [item('item-ms', MS)],
    ...overrides,
  };
}

const doublesItem = {
  eventId: MD,
  partnerName: '李四',
  partnerGender: 'MALE' as const,
  partnerStudentId: '2024002',
  partnerSchool: '河北工程大学',
  partnerClassName: '信息学院',
  partnerContact: '13900139000',
  teamName: '极速搭档',
};

/** 第二次扫码：只选男双，手机号写法和第一次不同（带横线）。 */
function dto(overrides: Record<string, unknown> = {}) {
  return {
    entrantType: 'SCHOOL' as const,
    registrationCode: 'SCHOOL01',
    studentId: '2024001',
    college: '信息学院',
    name: '张三',
    gender: 'MALE' as const,
    school: '河北工程大学',
    contact: '138-0013-8000',
    items: [doublesItem],
    ...overrides,
  };
}

function setup(
  options: {
    guests?: unknown[];
    own?: unknown;
    duplicate?: unknown;
    tournament?: Record<string, unknown>;
  } = {},
) {
  let playerSeq = 0;
  const tx = {
    competitionRegistration: {
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, any>;
        }) => {
          const base = [...(options.guests ?? []), options.own].find(
            (row) => (row as { id?: string } | undefined)?.id === where.id,
          ) as ReturnType<typeof guestRegistration>;
          const { eventItems, ...scalars } = data;
          const created = (eventItems?.create ?? []).map(
            (row: { eventId: string }, index: number) =>
              item(`new-item-${index}`, row.eventId, {
                ...row,
                competitionRegistrationId: base.id,
              }),
          );
          return {
            ...base,
            ...scalars,
            eventItems: [...base.eventItems, ...created],
          };
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
        const { eventItems, ...scalars } = data;
        return {
          ...guestRegistration(),
          id: 'cr-new',
          ...scalars,
          eventItems: eventItems.create.map(
            (row: { eventId: string }, index: number) =>
              item(`created-item-${index}`, row.eventId, {
                ...row,
                competitionRegistrationId: 'cr-new',
              }),
          ),
        };
      }),
    },
    competitionRegistrationEventItem: { deleteMany: jest.fn() },
    registration: {
      updateMany: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
    },
    player: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `player-${++playerSeq}`,
        ...data,
      })),
    },
  };
  const prisma = {
    tournament: {
      findFirst: jest.fn().mockResolvedValue(tournament(options.tournament)),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        role: Role.PLAYER,
        permissions: null,
      }),
    },
    competitionRegistration: {
      findUnique: jest.fn().mockResolvedValue(options.own ?? null),
      findMany: jest.fn().mockResolvedValue(options.guests ?? []),
      findFirst: jest.fn().mockResolvedValue(options.duplicate ?? null),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const emailService = {
    sendRegistrationNotification: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CompetitionsService(
    prisma as never,
    emailService as never,
  );
  return { service, prisma, tx };
}

describe('游客兼项：同一赛事姓名 + 联系方式相同即追加到原报名', () => {
  it('已报男单的游客再报男双：追加到原报名，不新建报名、不改本人信息，返回原报名编号', async () => {
    const { service, prisma, tx } = setup({ guests: [guestRegistration()] });

    const result = await service.publicRegister(
      T,
      dto({ school: '河北工程大学（新写法）' }),
    );

    expect(
      prisma.competitionRegistration.findMany.mock.calls[0][0].where,
    ).toEqual({
      competitionId: T,
      userId: null,
      name: '张三',
      status: { in: [RegistrationStatus.APPROVED, RegistrationStatus.PENDING] },
    });
    // 查重时排除这份报名本身
    expect(
      prisma.competitionRegistration.findFirst.mock.calls[0][0].where.id,
    ).toEqual({ not: 'cr-guest' });
    expect(tx.competitionRegistration.create).not.toHaveBeenCalled();
    const update = tx.competitionRegistration.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'cr-guest' });
    expect(update.data).not.toHaveProperty('school');
    expect(update.data).not.toHaveProperty('name');
    expect(update.data).not.toHaveProperty('contact');
    expect(update.data.eventItems.create).toEqual([
      expect.objectContaining({
        eventId: MD,
        partnerName: '李四',
        teamName: '极速搭档',
      }),
    ]);
    // 只为新项目生成参赛记录，男单那条不动
    expect(tx.registration.create).toHaveBeenCalledTimes(1);
    expect(tx.registration.create.mock.calls[0][0].data).toMatchObject({
      competitionRegistrationId: 'cr-guest',
      eventId: MD,
      name: '张三 / 李四',
      phone: '13800138000',
      status: RegistrationStatus.APPROVED,
    });
    expect(tx.player.create.mock.calls[0][0].data).toMatchObject({
      name: '张三',
      affiliation: '河北工程大学',
    });
    expect(result).toMatchObject({
      appended: true,
      guestToken: 'guest-token-1',
      message: '已追加报名项目。',
    });
    expect(result.registration.items.map((row) => row.eventId)).toEqual([
      MS,
      MD,
    ]);
  });

  it('把已报的男单和新的男双一起再提交：只追加男双', async () => {
    const { service, tx } = setup({ guests: [guestRegistration()] });

    await service.publicRegister(
      T,
      dto({ items: [{ eventId: MS }, doublesItem] }),
    );

    expect(
      tx.competitionRegistration.update.mock.calls[0][0].data.eventItems.create,
    ).toEqual([expect.objectContaining({ eventId: MD })]);
    expect(tx.registration.create).toHaveBeenCalledTimes(1);
  });

  it('只提交已报过的项目：提示选择新项目', async () => {
    const { service, prisma } = setup({ guests: [guestRegistration()] });

    await expect(
      service.publicRegister(T, dto({ items: [{ eventId: MS }] }) as never),
    ).rejects.toThrow('你已报名男子单打，请选择新的报名项目');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('超过兼项上限：说明已报项目和上限', async () => {
    const { service, prisma } = setup({
      guests: [
        guestRegistration({
          eventItems: [item('item-ms', MS), item('item-md', MD)],
        }),
      ],
    });

    await expect(
      service.publicRegister(
        T,
        dto({
          items: [
            {
              eventId: XD,
              partnerName: '王五',
              partnerGender: 'FEMALE',
              partnerStudentId: '2024003',
              partnerContact: '13700137000',
            },
          ],
        }) as never,
      ),
    ).rejects.toThrow(
      '本赛事每人最多报名 2 个项目，你已报名男子单打、男子双打，不能再追加',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('待审核的游客报名：不能追加，提示审核通过后再提交', async () => {
    const { service, prisma } = setup({
      guests: [guestRegistration({ status: RegistrationStatus.PENDING })],
    });

    await expect(service.publicRegister(T, dto() as never)).rejects.toThrow(
      '你已提交报名，正在等待审核；审核通过后可再次提交，追加新的项目',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('只有学号对上、联系方式不同：不追加，仍按重复报名拦下并提示怎么兼项', async () => {
    const { service, prisma } = setup({
      guests: [guestRegistration()],
      duplicate: {
        id: 'cr-guest',
        entrantType: EntrantType.SCHOOL,
        userId: null,
      },
    });

    const error = await service
      .publicRegister(T, dto({ contact: '13700000000' }) as never)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toContain(
      '请填写与第一次报名时相同的姓名和联系方式',
    );
    expect(
      prisma.competitionRegistration.findFirst.mock.calls[0][0].where,
    ).not.toHaveProperty('id');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('对上的是账号报名：提示登录该账号后追加', async () => {
    const { service } = setup({
      duplicate: {
        id: 'cr-user',
        entrantType: EntrantType.SCHOOL,
        userId: 'user-9',
      },
    });

    await expect(service.publicRegister(T, dto() as never)).rejects.toThrow(
      '请登录该账号后提交',
    );
  });

  it('性别与第一次报名不一致：不追加', async () => {
    const { service, prisma } = setup({ guests: [guestRegistration()] });

    await expect(
      service.publicRegister(
        T,
        dto({
          gender: 'FEMALE',
          items: [
            {
              eventId: XD,
              partnerName: '王五',
              partnerGender: 'MALE',
              partnerStudentId: '2024003',
              partnerContact: '13700137000',
            },
          ],
        }) as never,
      ),
    ).rejects.toThrow('性别与第一次报名时不一致（第一次报名填写的是男）');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('没有报过名的游客：照常新建报名并生成新的报名编号', async () => {
    const { service, tx } = setup();

    const result = await service.publicRegister(T, dto());

    expect(tx.competitionRegistration.update).not.toHaveBeenCalled();
    const created = tx.competitionRegistration.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      competitionId: T,
      userId: null,
      name: '张三',
      contact: '138-0013-8000',
    });
    expect(typeof created.guestToken).toBe('string');
    expect(result).toMatchObject({
      appended: false,
      guestToken: created.guestToken,
    });
  });

  it('连点两次追加撞上唯一约束：返回明确提示而不是 500', async () => {
    const { service, tx } = setup({ guests: [guestRegistration()] });
    tx.competitionRegistration.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.publicRegister(T, dto() as never)).rejects.toThrow(
      '该项目已报名，请勿重复提交',
    );
  });

  it('登录用户没有自己的报名、但以前用游客身份报过：同样追加到那份游客报名', async () => {
    const { service, tx } = setup({ guests: [guestRegistration()] });

    const result = await service.submitRegistration(T, 'user-1', dto());

    expect(tx.competitionRegistration.update.mock.calls[0][0].where).toEqual({
      id: 'cr-guest',
    });
    expect(
      tx.competitionRegistration.update.mock.calls[0][0].data,
    ).not.toHaveProperty('name');
    expect(result).toMatchObject({
      appended: true,
      guestToken: 'guest-token-1',
    });
  });

  it('登录用户追加自己的报名：保持原逻辑，按本次提交更新本人信息', async () => {
    const own = guestRegistration({
      id: 'cr-own',
      userId: 'user-1',
      guestToken: null,
    });
    const { service, prisma, tx } = setup({ own });

    const result = await service.submitRegistration(
      T,
      'user-1',
      dto({ school: '河北工程大学（新写法）' }),
    );

    expect(prisma.competitionRegistration.findMany).not.toHaveBeenCalled();
    expect(
      tx.competitionRegistration.update.mock.calls[0][0].data,
    ).toMatchObject({
      school: '河北工程大学（新写法）',
      name: '张三',
    });
    expect(result).toMatchObject({ appended: true, guestToken: null });
  });
});
