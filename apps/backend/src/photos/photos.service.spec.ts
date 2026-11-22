import { Role } from '@prisma/client';
import { AdminPhotosController } from './admin-photos.controller';
import { PhotosService } from './photos.service';
import { ROLES_KEY } from '../auth/roles.guard';

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
    photoManagementRequest: { findMany: jest.fn() },
    photo: { findMany: jest.fn(), updateMany: jest.fn() },
    photoOperationLog: { create: jest.fn() },
  };
  const service = new PhotosService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

const root = { id: 'root-1', role: Role.ROOT };
const admin = { id: 'admin-1', role: Role.ADMIN };

describe('PhotosService 删除整届赛事图片', () => {
  it('只允许超级管理员调用整届删除，即使管理员已有该赛事的图片管理权限', async () => {
    const { service, prisma } = buildService();
    const approvedAdmin = { ...admin, photoManagementRequests: [{ targetType: 'TOURNAMENT' as const, targetId: 't1' }] };
    expect(Reflect.getMetadata(ROLES_KEY, AdminPhotosController.prototype.deleteTournamentPhotos)).toEqual([Role.ROOT]);
    await expect(service.deleteTournamentPhotos('t1', '赛事', approvedAdmin))
      .rejects.toThrow('仅超级管理员可以删除整届赛事图片');
    expect(prisma.tournament.findUnique).not.toHaveBeenCalled();
    expect(prisma.photo.updateMany).not.toHaveBeenCalled();
  });

  it('超级管理员确认完整赛事名后可以清空赛事相册', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findUnique.mockResolvedValue({ name: '赛事' });
    prisma.photo.findMany.mockResolvedValue([]);
    await expect(service.deleteTournamentPhotos('t1', '错误名称', root)).rejects.toThrow('赛事名称不匹配');
    await expect(service.deleteTournamentPhotos('t1', '赛事', root)).resolves.toEqual({ deleted: 0 });
    expect(prisma.photo.findMany).toHaveBeenCalledWith({ where: { tournamentId: 't1', deletedAt: null } });
  });
});

describe('PhotosService 上传授权二维码', () => {
  it('之前发出的上传二维码也须等待对应赛事的图片管理申请通过', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findUnique.mockResolvedValue({ id: 't1', name: '赛事', submittedById: admin.id });
    prisma.user.findMany.mockResolvedValue([{ id: admin.id }]);
    prisma.photoManagementRequest.findMany.mockResolvedValue([]);
    const token = 'a'.repeat(32);

    await expect(service.getPhotoUploadAccess(token)).rejects.toThrow('图片管理尚未审核开通');
    expect(prisma.photoManagementRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'APPROVED', active: true, OR: [{ targetType: 'TOURNAMENT', targetId: 't1', applicantId: admin.id }] },
    }));
    prisma.photoManagementRequest.findMany.mockResolvedValue([{ targetType: 'TOURNAMENT', targetId: 't1', applicantId: admin.id }]);
    await expect(service.getPhotoUploadAccess(token)).resolves.toMatchObject({ targetType: 'TOURNAMENT', id: 't1' });
  });

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

  it('只开放当前管理员已经获批的赛事，不能批量删除其他场次的图片', async () => {
    const { service, prisma } = buildService();
    const approvedAdmin = { ...admin, photoManagementRequests: [{ targetType: 'TOURNAMENT' as const, targetId: 't1' }] };
    prisma.tournament.findMany.mockResolvedValue([tournamentRow, { ...tournamentRow, id: 't2' }]);
    prisma.photoActivity.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);
    const targets = await service.listPhotoTargets(approvedAdmin);
    expect(targets).toMatchObject([
      { id: 't1', managementAllowed: true, managementApprovalId: null },
      { id: 't2', managementAllowed: false, managementApprovalId: null },
    ]);

    prisma.photo.findMany.mockResolvedValue([
      { id: 'p1', tournamentId: 't1', tournament: { submittedById: admin.id } },
      { id: 'p2', tournamentId: 't2', tournament: { submittedById: admin.id } },
    ]);
    await expect(service.deletePhotos(['p1', 'p2'], approvedAdmin)).rejects.toThrow('图片管理尚未审核开通');
    expect(prisma.photo.updateMany).not.toHaveBeenCalled();
  });

  it('超级管理员的操作权限与赛事是否已开通分别返回', async () => {
    const { service, prisma } = buildService();
    prisma.tournament.findMany.mockResolvedValue([
      { ...tournamentRow, id: 'unopened', submittedById: admin.id, _count: { photos: 0 } },
      { ...tournamentRow, id: 'opened', submittedById: admin.id, _count: { photos: 0 } },
      { ...tournamentRow, id: 'root-owned', submittedById: root.id },
    ]);
    prisma.photoActivity.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([{ id: admin.id, role: Role.ADMIN, username: '管理员' }]);
    prisma.photoManagementRequest.findMany.mockResolvedValue([
      { id: 'request-1', targetType: 'TOURNAMENT', targetId: 'opened', applicantId: admin.id },
    ]);

    const targets = await service.listPhotoTargets(root);
    expect(targets).toMatchObject([
      { id: 'unopened', managementAllowed: true, managementOpened: false, managementApprovalId: null },
      { id: 'opened', managementAllowed: true, managementOpened: true, managementApprovalId: 'request-1' },
      { id: 'root-owned', managementAllowed: true, managementOpened: true, managementApprovalId: null },
    ]);
  });
});
