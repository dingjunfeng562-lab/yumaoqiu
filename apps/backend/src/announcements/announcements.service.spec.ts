import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnnouncementsService } from './announcements.service';

describe('role-targeted announcements', () => {
  const announcement = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const service = new AnnouncementsService({ announcement } as unknown as PrismaService);

  beforeEach(() => {
    jest.resetAllMocks();
    announcement.findFirst.mockResolvedValue(null);
    announcement.findMany.mockResolvedValue([]);
    announcement.create.mockImplementation(async ({ data }) => data);
    announcement.update.mockImplementation(async ({ data }) => data);
  });

  it('keeps both public lists and popups restricted to announcements for everyone', async () => {
    await service.findPublished(5);
    await service.findActivePopup('home');
    expect(announcement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ targetRole: null, scope: { in: ['global'] } }),
    }));
    expect(announcement.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ targetRole: null, scope: { in: ['global', 'home'] } }),
    }));
  });

  it('queries published notices for exactly the requested role', async () => {
    await service.findPublished(50, Role.REFEREE);
    expect(announcement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ targetRole: Role.REFEREE, status: 'targeted_published' }),
    }));
  });

  it('keeps targeted publications hidden from legacy readers while displaying published in admin', async () => {
    const saved = await service.create({
      title: '裁判通知',
      content: '请提前到场',
      status: 'published',
      targetRole: Role.REFEREE,
    });
    expect(announcement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetRole: Role.REFEREE,
        status: 'targeted_published',
        isPublished: false,
      }),
    });
    expect(saved).toMatchObject({ status: 'published', isPublished: true, targetRole: Role.REFEREE });
  });

  it('updates the stored publication fields when changing recipients on a published notice', async () => {
    announcement.findUnique.mockResolvedValueOnce({
      targetRole: null,
      status: 'published',
      isPublished: true,
    }).mockResolvedValueOnce({
      targetRole: Role.REFEREE,
      status: 'targeted_published',
      isPublished: false,
    });
    await service.update('notice', { targetRole: Role.REFEREE });
    await service.update('notice', { targetRole: null });
    expect(announcement.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ targetRole: Role.REFEREE, status: 'targeted_published', isPublished: false }),
    }));
    expect(announcement.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ targetRole: null, status: 'published', isPublished: true }),
    }));
  });
});
