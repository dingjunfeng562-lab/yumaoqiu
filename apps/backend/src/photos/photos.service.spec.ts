import { Role } from '@prisma/client';
import { PhotosService } from './photos.service';

function buildService() {
  const prisma = {
    tournament: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    photoActivity: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: { findMany: jest.fn() },
  };
  const service = new PhotosService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

const root = { id: 'root-1', role: Role.ROOT };
const admin = { id: 'admin-1', role: Role.ADMIN };

describe('PhotosService 上传授权二维码', () => {
  it('赛事已有授权二维码时始终可以再次查看，不受审核状态影响', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findUnique.mockResolvedValue({
      photoUploadToken: 'existing-token',
      approvalStatus: 'PENDING',
    });

    const result = await service.createTournamentUploadAccess('t1');

    expect(result).toEqual({ token: 'existing-token', path: '/photographer/authorize/existing-token' });
    expect(prisma.tournament.update).not.toHaveBeenCalled();
  });

  it('赛事没有授权二维码且未通过审核时拒绝生成', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findUnique.mockResolvedValue({
      photoUploadToken: null,
      approvalStatus: 'REJECTED',
    });

    await expect(service.createTournamentUploadAccess('t1')).rejects.toThrow(
      '赛事审核通过后才能生成上传授权二维码',
    );
    expect(prisma.tournament.update).not.toHaveBeenCalled();
  });

  it('活动已有授权二维码时始终可以再次查看，不受审核状态影响', async () => {
    const { service, prisma } = buildService();
    prisma.photoActivity.findUnique.mockResolvedValue({
      photoUploadToken: 'activity-token',
      approvalStatus: 'REJECTED',
    });

    const result = await service.createActivityUploadAccess('a1');

    expect(result).toEqual({ token: 'activity-token', path: '/photographer/authorize/activity-token' });
    expect(prisma.photoActivity.update).not.toHaveBeenCalled();
  });

  it('活动没有授权二维码且未通过审核时拒绝生成', async () => {
    const { service, prisma } = buildService();
    prisma.photoActivity.findUnique.mockResolvedValue({
      photoUploadToken: null,
      approvalStatus: 'PENDING',
    });

    await expect(service.createActivityUploadAccess('a1')).rejects.toThrow(
      '活动审核通过后才能生成上传授权二维码',
    );
    expect(prisma.photoActivity.update).not.toHaveBeenCalled();
  });
});

describe('PhotosService 活动图片统一列表', () => {
  const tournamentRow = {
    id: 't1',
    name: '2026 春季赛',
    coverImageUrl: '/api/uploads/covers/a.webp',
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2026-04-02T00:00:00.000Z'),
    approvalStatus: 'APPROVED',
    rejectReason: null,
    isArchived: true,
    photoAccessToken: 't-access',
    photoUploadToken: null,
    submittedById: 'u1',
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    _count: { photos: 3 },
  };
  const activityRow = {
    id: 'a1',
    title: '校园开放日',
    coverImageUrl: null,
    dateMode: 'RANGE',
    startAt: new Date('2026-05-01T00:00:00.000Z'),
    endAt: new Date('2026-05-02T00:00:00.000Z'),
    approvalStatus: 'PENDING',
    rejectReason: '封面不合规',
    photoAccessToken: null,
    photoUploadToken: 'a-upload',
    submittedById: 'u1',
    createdAt: new Date('2026-03-05T00:00:00.000Z'),
    _count: { photos: 0 },
  };

  it('把赛事和活动归一成同一结构，并按创建时间倒序', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findMany.mockResolvedValue([tournamentRow]);
    prisma.photoActivity.findMany.mockResolvedValue([activityRow]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', username: '赛事管理员' }]);

    const targets = await service.listPhotoTargets(root);

    expect(targets.map((item) => item.targetType)).toEqual(['ACTIVITY', 'TOURNAMENT']);
    expect(targets[0]).toMatchObject({
      id: 'a1',
      title: '校园开放日',
      dateMode: 'RANGE',
      approvalStatus: 'PENDING',
      rejectReason: '封面不合规',
      photoCount: 0,
      photoUploadAccessEnabled: true,
      photoAccessEnabled: false,
      submittedBy: { id: 'u1', username: '赛事管理员' },
    });
    expect(targets[1]).toMatchObject({
      id: 't1',
      title: '2026 春季赛',
      dateMode: null,
      isArchived: true,
      photoCount: 3,
      photoAccessEnabled: true,
    });
  });

  it('管理员只看到自己提交的赛事和活动，与赛事管理范围一致', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findMany.mockResolvedValue([]);
    prisma.photoActivity.findMany.mockResolvedValue([]);

    await service.listPhotoTargets(admin);

    expect(prisma.tournament.findMany.mock.calls[0][0].where).toEqual({ submittedById: 'admin-1' });
    expect(prisma.photoActivity.findMany.mock.calls[0][0].where).toEqual({ submittedById: 'admin-1' });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('查不到或无权访问的对象返回不存在', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findMany.mockResolvedValue([tournamentRow]);
    prisma.photoActivity.findMany.mockResolvedValue([activityRow]);
    prisma.user.findMany.mockResolvedValue([]);

    await expect(service.getPhotoTarget(root, 'TOURNAMENT', 'missing')).rejects.toThrow('赛事不存在或不属于你');
    await expect(service.getPhotoTarget(root, 'UNKNOWN', 't1')).rejects.toThrow('图片对象类型不正确');
  });
});
