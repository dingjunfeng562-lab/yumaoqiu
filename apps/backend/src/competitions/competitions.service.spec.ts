import { EntrantType, EventType, Gender, RegistrationStatus, TournamentStatus } from '@prisma/client';
import { CompetitionsService } from './competitions.service';

const competitionId = 'comp-1';
const eventId = 'event-1';

function approvedEntry(id: string, competitionRegistrationId: string | null) {
  return {
    id,
    eventId,
    competitionRegistrationId,
    status: RegistrationStatus.APPROVED,
    createdAt: new Date('2026-10-06T00:00:00.000Z'),
  };
}

function buildTournament() {
  return {
    id: competitionId,
    name: '2026 羽动云赛',
    subtitle: null,
    coverImageUrl: null,
    location: '体育馆',
    projectText: null,
    description: null,
    rules: null,
    registrationNotice: null,
    startDate: new Date('2026-11-01T00:00:00.000Z'),
    endDate: new Date('2026-11-02T00:00:00.000Z'),
    registrationStartDate: new Date('2026-10-01T00:00:00.000Z'),
    registrationEndDate: new Date('2026-10-20T00:00:00.000Z'),
    status: TournamentStatus.REGISTRATION_OPEN,
    maxRegistrationEvents: 2,
    allowCrossEventRegistration: true,
    needsRegistrationReview: true,
    allowSchoolRegistration: true,
    registrationFieldRules: null,
    registrationCode: 'SCHOOL01',
    schoolRegistrationCode: 'SCHOOL01',
    schoolRegistrationCodeEnabled: true,
    registrationCodeEnabled: true,
    isArchived: false,
    isPublished: true,
    approvalStatus: 'APPROVED',
    rejectReason: null,
    photoAccessToken: null,
    submittedById: 'admin-1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    events: [
      {
        id: eventId,
        tournamentId: competitionId,
        type: EventType.MENS_SINGLES,
        groupLabel: null,
        entrantType: EntrantType.SCHOOL,
        registrations: [
          // 线上报名审核通过后生成的参赛记录
          approvedEntry('reg-online', 'cr-1'),
          // 管理员批量导入 / Excel 导入直接落库的参赛记录
          approvedEntry('reg-import-1', null),
          approvedEntry('reg-import-2', null),
          { ...approvedEntry('reg-import-removed', null), status: RegistrationStatus.REMOVED },
        ],
      },
    ],
    competitionRegistrations: [
      {
        id: 'cr-1',
        competitionId,
        userId: 'user-1',
        entrantType: EntrantType.SCHOOL,
        studentId: '2024001',
        college: '计算机学院',
        majorGrade: '2024 级',
        guestEmail: null,
        name: '张三',
        gender: Gender.MALE,
        school: '第一大学',
        className: '计算机学院 2024 级',
        contact: '13800000000',
        remark: null,
        status: RegistrationStatus.APPROVED,
        rejectReason: null,
        reviewedAt: new Date('2026-10-07T00:00:00.000Z'),
        reviewedById: 'admin-1',
        createdAt: new Date('2026-10-05T00:00:00.000Z'),
        user: { id: 'user-1', email: 'player@example.com' },
        eventItems: [
          {
            id: 'item-1',
            eventId,
            event: { id: eventId, type: EventType.MENS_SINGLES, groupLabel: null },
          },
        ],
      },
    ],
  };
}

function buildImportedEntry(id: string, createdAt: string) {
  return {
    id,
    eventId,
    competitionRegistrationId: null,
    player1Id: `${id}-player`,
    player2Id: null,
    name: '李四',
    teamName: null,
    entrantType: EntrantType.SCHOOL,
    studentId: '2024002',
    college: '外国语学院',
    majorGrade: '2023 级',
    className: '外国语学院 2023 级',
    phone: '13900000000',
    gender: Gender.FEMALE,
    eventName: '男子单打',
    partnerStudentId: null,
    partnerSchool: null,
    partnerCollege: null,
    partnerMajorGrade: null,
    partnerClassName: null,
    partnerPhone: null,
    remark: null,
    status: RegistrationStatus.APPROVED,
    reviewedAt: new Date('2026-10-08T00:00:00.000Z'),
    reviewedBy: 'admin-1',
    rejectReason: null,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    event: { id: eventId, tournamentId: competitionId, type: EventType.MENS_SINGLES, groupLabel: null },
    player1: {
      id: `${id}-player`,
      name: '李四',
      gender: Gender.FEMALE,
      affiliation: '第一大学',
      contact: '13900000000',
      isTemporary: true,
      notes: null,
    },
    player2: null,
    competitionRegistration: null,
  };
}

function buildService() {
  const tournament = buildTournament();
  const prisma = {
    tournament: {
      findMany: jest.fn().mockResolvedValue([tournament]),
      findFirst: jest.fn().mockResolvedValue(tournament),
    },
    competitionRegistration: {
      findMany: jest.fn().mockResolvedValue(tournament.competitionRegistrations),
    },
    registration: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          buildImportedEntry('reg-import-2', '2026-10-09T02:00:00.000Z'),
          buildImportedEntry('reg-import-1', '2026-10-09T01:00:00.000Z'),
        ]),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'admin-1', username: '赛事管理员', email: 'admin@example.com', role: 'ADMIN' },
      ]),
    },
  };
  const service = new CompetitionsService(prisma as never, { send: jest.fn() } as never);
  return { service, prisma };
}

describe('CompetitionsService 报名统计', () => {
  it('管理员导入的已通过报名计入赛事管理的「通过」和前台已通过人数', async () => {
    const { service } = buildService();

    const [competition] = await service.listAdminCompetitions();

    expect(competition.counts).toEqual({
      // 1 条线上报名 + 2 条管理员导入；被移除的导入记录既不在列表里也不计数
      all: 3,
      pending: 0,
      approved: 3,
      rejected: 0,
      removed: 0,
    });
    expect(competition.registeredCount).toBe(3);
    expect(competition.publisher).toMatchObject({ id: 'admin-1', username: '赛事管理员' });
  });

  it('筛选已通过时，报名审核列表合并管理员导入的报名并标注来源', async () => {
    const { service, prisma } = buildService();

    const rows = await service.listAdminRegistrations(competitionId, 'approved');

    expect(prisma.registration.findMany).toHaveBeenCalled();
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.source === 'ADMIN')).toHaveLength(2);
    const imported = rows.find((row) => row.source === 'ADMIN');
    expect(imported).toMatchObject({
      name: '李四',
      entrantTypeLabel: '学生组',
      statusLabel: '已通过',
      eventSummary: '男子单打',
    });
  });

  it('筛选待审核时不查询管理员导入记录', async () => {
    const { service, prisma } = buildService();
    prisma.competitionRegistration.findMany.mockResolvedValueOnce([]);

    const rows = await service.listAdminRegistrations(competitionId, 'pending');

    expect(prisma.registration.findMany).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });
});

describe('CompetitionsService 驳回后重新报名', () => {
  it('does not treat rejected registrations as duplicates', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new CompetitionsService({ competitionRegistration: { findFirst } } as never, { send: jest.fn() } as never);
    await (service as any).ensureNoDuplicateRegistration('t1', 'SOCIAL', { studentId: null, name: '王五', contact: '13800138000' });
    expect(findFirst.mock.calls[0][0].where.status).toEqual({ notIn: ['REMOVED', 'REJECTED'] });
  });
});

describe('CompetitionsService 赛事图片二维码', () => {
  function buildPhotoAccessService(state: { photoAccessToken: string | null; approvalStatus: string }) {
    const prisma = {
      tournament: {
        findFirst: jest.fn().mockResolvedValue(buildTournament()),
        // 第一次查当前 token / 审核状态；已通过且首次生成时再查一次结果
        findUnique: jest.fn()
          .mockResolvedValueOnce({ name: '2026 羽动云赛', ...state })
          .mockResolvedValueOnce({ name: '2026 羽动云赛', photoAccessToken: 'generated-token' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new CompetitionsService(prisma as never, { send: jest.fn() } as never);
    return { service, prisma };
  }

  it('已有二维码的赛事即使当前不是已通过状态，也能继续查看原二维码', async () => {
    const { service, prisma } = buildPhotoAccessService({
      photoAccessToken: 'existing-token',
      approvalStatus: 'PENDING',
    });

    const result = await service.getOrCreatePhotoAccess(competitionId);

    expect(result).toMatchObject({
      accessToken: 'existing-token',
      path: '/tupiannicai/existing-token',
    });
    expect(prisma.tournament.updateMany).not.toHaveBeenCalled();
  });

  it('没有二维码且未通过审核时拒绝生成', async () => {
    const { service, prisma } = buildPhotoAccessService({
      photoAccessToken: null,
      approvalStatus: 'REJECTED',
    });

    await expect(service.getOrCreatePhotoAccess(competitionId)).rejects.toThrow(
      '赛事审核通过后才能生成图片二维码',
    );
    expect(prisma.tournament.updateMany).not.toHaveBeenCalled();
  });

  it('审核通过后首次生成二维码并落库', async () => {
    const { service, prisma } = buildPhotoAccessService({
      photoAccessToken: null,
      approvalStatus: 'APPROVED',
    });

    const result = await service.getOrCreatePhotoAccess(competitionId);

    expect(result.accessToken).toBe('generated-token');
    expect(result.path).toBe('/tupiannicai/generated-token');
    const [updateArgs] = prisma.tournament.updateMany.mock.calls[0];
    expect(updateArgs.where).toEqual({ id: competitionId, photoAccessToken: null });
    expect(updateArgs.data.photoAccessToken).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('CompetitionsService.recordView', () => {
  it('adds one view to a public tournament with a single raw UPDATE (does not touch updatedAt)', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const service = new CompetitionsService({ $executeRaw: executeRaw } as never, { send: jest.fn() } as never);

    await expect(service.recordView('tournament-1')).resolves.toEqual({ counted: true });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, id] = executeRaw.mock.calls[0] as [TemplateStringsArray, string];
    const sql = strings.join('?').replace(/\s+/g, ' ');
    expect(sql).toContain('SET `viewCount` = `viewCount` + 1');
    expect(sql).toContain('`isPublished` = true AND `isArchived` = false AND `approvalStatus` = \'APPROVED\'');
    expect(sql).not.toContain('updatedAt');
    expect(id).toBe('tournament-1');
  });

  it('reports not counted when the tournament is missing or not public', async () => {
    const service = new CompetitionsService({ $executeRaw: jest.fn().mockResolvedValue(0) } as never, { send: jest.fn() } as never);
    await expect(service.recordView('hidden')).resolves.toEqual({ counted: false });
  });
});
