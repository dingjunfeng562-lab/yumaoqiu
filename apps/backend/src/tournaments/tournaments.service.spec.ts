import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TournamentsService } from './tournaments.service';

describe('TournamentsService.remove', () => {
  const tournament = { id: 'tournament-1', submittedById: 'admin-1' };

  function buildService() {
    const prisma = {
      tournament: {
        findUnique: jest.fn().mockResolvedValue(tournament),
        delete: jest.fn().mockResolvedValue(tournament),
      },
    };
    const service = new TournamentsService(prisma as never, {} as never);
    return { service, prisma };
  }

  it('允许管理员删除自己创建的赛事', async () => {
    const { service, prisma } = buildService();

    await service.remove('tournament-1', {
      id: 'admin-1',
      role: Role.ADMIN,
      permissions: ['TOURNAMENTS'],
    });

    expect(prisma.tournament.delete).toHaveBeenCalledWith({
      where: { id: 'tournament-1' },
    });
  });

  it('拒绝管理员删除别人创建的赛事', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.remove('tournament-1', {
        id: 'admin-2',
        role: Role.ADMIN,
        permissions: ['TOURNAMENTS'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.tournament.delete).not.toHaveBeenCalled();
  });

  it('允许超级管理员删除任意赛事', async () => {
    const { service, prisma } = buildService();

    await service.remove('tournament-1', { id: 'root-1', role: Role.ROOT });

    expect(prisma.tournament.delete).toHaveBeenCalledWith({
      where: { id: 'tournament-1' },
    });
  });
});
