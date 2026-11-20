import { Role } from '@prisma/client';
import { PhotoActivitiesService } from './photo-activities.service';

function buildService(activity: {
  photoAccessToken: string | null;
  approvalStatus: string;
  rejectReason?: string | null;
}) {
  const prisma = {
    photoActivity: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'a1',
        title: '校园开放日',
        submittedById: 'admin-1',
        rejectReason: null,
        ...activity,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const service = new PhotoActivitiesService(prisma as never, { assertAllowed: jest.fn() } as never);
  return { service, prisma };
}

const root = { id: 'root-1', role: Role.ROOT };

describe('PhotoActivitiesService 活动图片二维码', () => {
  it('活动回到待审后，旧二维码也失效', async () => {
    const { service, prisma } = buildService({ photoAccessToken: 'existing-token', approvalStatus: 'PENDING' });

    await expect(service.createPhotoAccess('a1', root)).rejects.toThrow(
      '该活动图片正在等待上级管理员同意，相关图片功能暂不可用',
    );
    expect(prisma.photoActivity.update).not.toHaveBeenCalled();
  });

  it('被驳回的活动提示审核未通过', async () => {
    const { service } = buildService({ photoAccessToken: null, approvalStatus: 'REJECTED', rejectReason: '封面不合规' });

    await expect(service.createPhotoAccess('a1', root)).rejects.toThrow('该活动图片审核未通过：封面不合规');
  });

  it('没有二维码且未通过审核时拒绝生成', async () => {
    const { service, prisma } = buildService({ photoAccessToken: null, approvalStatus: 'PENDING' });

    await expect(service.createPhotoAccess('a1', root)).rejects.toThrow(
      '该活动图片正在等待上级管理员同意，相关图片功能暂不可用',
    );
    expect(prisma.photoActivity.update).not.toHaveBeenCalled();
  });

  it('审核通过后首次生成二维码并落库', async () => {
    const { service, prisma } = buildService({ photoAccessToken: null, approvalStatus: 'APPROVED' });

    const result = await service.createPhotoAccess('a1', root);

    expect(result.accessToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(result.path).toBe(`/tupiannicai/${result.accessToken}`);
    expect(prisma.photoActivity.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { photoAccessToken: result.accessToken },
    });
  });
});
