import { Role } from '@prisma/client';
import { PhotoActivitiesService } from './photo-activities.service';

function buildService(activity: { photoAccessToken: string | null; approvalStatus: string }) {
  const prisma = {
    photoActivity: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'a1',
        title: '校园开放日',
        submittedById: 'admin-1',
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
  it('已有二维码的活动即使当前不是已通过状态，也能继续查看原二维码', async () => {
    const { service, prisma } = buildService({ photoAccessToken: 'existing-token', approvalStatus: 'PENDING' });

    const result = await service.createPhotoAccess('a1', root);

    expect(result).toEqual({ accessToken: 'existing-token', path: '/tupiannicai/existing-token' });
    expect(prisma.photoActivity.update).not.toHaveBeenCalled();
  });

  it('没有二维码且未通过审核时拒绝生成', async () => {
    const { service, prisma } = buildService({ photoAccessToken: null, approvalStatus: 'PENDING' });

    await expect(service.createPhotoAccess('a1', root)).rejects.toThrow('活动审核通过后才能生成图片二维码');
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
