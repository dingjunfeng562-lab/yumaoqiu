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
    photo: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findMany: jest.fn() },
  };
  const service = new PhotosService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

const root = { id: 'root-1', role: Role.ROOT };
const admin = { id: 'admin-1', role: Role.ADMIN };

describe('PhotosService 审核门禁', () => {
  it('审核通过的对象可以正常使用图片功能', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findUnique.mockResolvedValue({ approvalStatus: 'APPROVED', rejectReason: null });

    await expect(service.assertImageTargetUsable({ type: 'TOURNAMENT', id: 't1' })).resolves.toBeUndefined();
  });

  it('待审核对象提示「等待上级管理员同意」', async () => {
    const { service, prisma } = buildService();
    prisma.photoActivity.findUnique.mockResolvedValue({ approvalStatus: 'PENDING', rejectReason: null });

    await expect(service.assertImageTargetUsable({ type: 'ACTIVITY', id: 'a1' })).rejects.toThrow(
      '该活动图片正在等待上级管理员同意，相关图片功能暂不可用',
    );
  });

  it('驳回对象提示审核未通过并带上原因', async () => {
    const { service, prisma } = buildService();
    prisma.photoActivity.findUnique.mockResolvedValue({ approvalStatus: 'REJECTED', rejectReason: '封面不合规' });

    await expect(service.assertImageTargetUsable({ type: 'ACTIVITY', id: 'a1' })).rejects.toThrow(
      '该活动图片审核未通过：封面不合规',
    );
  });

  it('对象不存在时返回不存在', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findUnique.mockResolvedValue(null);

    await expect(service.assertImageTargetUsable({ type: 'TOURNAMENT', id: 'missing' })).rejects.toThrow(
      '赛事不存在',
    );
  });

  it('赛事待审时上传接口直接拒绝，不进入图片处理', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findUnique
      .mockResolvedValueOnce({ id: 't1' })
      .mockResolvedValue({ approvalStatus: 'PENDING', rejectReason: null });

    await expect(
      service.uploadPhotos('t1', 'MATCH', [
        { buffer: Buffer.from('x'), mimetype: 'image/jpeg', originalname: 'a.jpg', size: 1 },
      ], 'u1'),
    ).rejects.toThrow('该赛事图片正在等待上级管理员同意');
    expect(prisma.photo.findMany).not.toHaveBeenCalled();
  });

  it('待审对象下的图片不允许删除', async () => {
    const { service, prisma } = buildService();
    prisma.photo.findUnique.mockResolvedValue({
      id: 'p1',
      deletedAt: null,
      tournamentId: null,
      activityId: 'a1',
      originalPath: '',
      fullPath: '',
      thumbnailPath: '',
    });
    prisma.photoActivity.findUnique.mockResolvedValue({ approvalStatus: 'PENDING', rejectReason: null });

    await expect(service.deletePhoto('p1', root)).rejects.toThrow('等待上级管理员同意');
    expect(prisma.photo.update).not.toHaveBeenCalled();
  });
});

describe('PhotosService 上传授权二维码', () => {
  it('赛事已有二维码但当前待审时也拒绝使用', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findUnique.mockResolvedValue({
      photoUploadToken: 'existing-token',
      approvalStatus: 'PENDING',
      rejectReason: null,
    });

    await expect(service.createTournamentUploadAccess('t1')).rejects.toThrow(
      '该赛事图片正在等待上级管理员同意，相关图片功能暂不可用',
    );
    expect(prisma.tournament.update).not.toHaveBeenCalled();
  });

  it('赛事驳回时提示审核未通过并带上原因', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findUnique.mockResolvedValue({
      photoUploadToken: null,
      approvalStatus: 'REJECTED',
      rejectReason: '资料不全',
    });

    await expect(service.createTournamentUploadAccess('t1')).rejects.toThrow(
      '该赛事图片审核未通过：资料不全',
    );
    expect(prisma.tournament.update).not.toHaveBeenCalled();
  });

  it('赛事审核通过后首次生成二维码', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findUnique.mockResolvedValue({
      photoUploadToken: null,
      approvalStatus: 'APPROVED',
      rejectReason: null,
    });
    prisma.tournament.update.mockResolvedValue({});

    const result = await service.createTournamentUploadAccess('t1');

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(result.path).toBe(`/photographer/authorize/${result.token}`);
    expect(prisma.tournament.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { photoUploadToken: result.token },
    });
  });

  it('活动已有二维码但当前待审时也拒绝使用', async () => {
    const { service, prisma } = buildService();
    prisma.photoActivity.findUnique.mockResolvedValue({
      photoUploadToken: 'activity-token',
      approvalStatus: 'PENDING',
      rejectReason: null,
    });

    await expect(service.createActivityUploadAccess('a1')).rejects.toThrow(
      '该活动图片正在等待上级管理员同意，相关图片功能暂不可用',
    );
    expect(prisma.photoActivity.update).not.toHaveBeenCalled();
  });

  it('活动审核通过后首次生成二维码', async () => {
    const { service, prisma } = buildService();
    prisma.photoActivity.findUnique.mockResolvedValue({
      photoUploadToken: null,
      approvalStatus: 'APPROVED',
      rejectReason: null,
    });
    prisma.photoActivity.update.mockResolvedValue({});

    const result = await service.createActivityUploadAccess('a1');

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(result.path).toBe(`/photographer/authorize/${result.token}`);
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
