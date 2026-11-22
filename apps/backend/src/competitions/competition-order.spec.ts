import { Role, TournamentStatus } from '@prisma/client';
import { AdminCompetitionsController } from './admin-competitions.controller';
import { CompetitionsService } from './competitions.service';
import { orderPublicCompetitions } from './competition-order';

const competitions = [
  { id: 'scheduled', name: '待赛', startDate: new Date(3000), status: TournamentStatus.REGISTRATION_CLOSED },
  { id: 'registering', name: '开放报名', startDate: new Date(2000), status: TournamentStatus.REGISTRATION_OPEN },
  { id: 'finished', name: '已完赛', startDate: new Date(1000), status: TournamentStatus.FINISHED },
];
const root = { id: 'root', role: Role.ROOT };
const admin = { id: 'admin', role: Role.ADMIN };

describe('public competition order', () => {
  const sortedIds = (settings: Parameters<typeof orderPublicCompetitions>[1]) =>
    orderPublicCompetitions(competitions, settings).map(({ id }) => id);

  it('prioritizes manual choices and applies the selected rule to the remaining competitions', () => {
    expect(sortedIds({ mode: 'REGISTRATION_FIRST', orderedIds: [] }))
      .toEqual(['registering', 'scheduled', 'finished']);
    expect(sortedIds({ mode: 'REGISTRATION_FIRST', orderedIds: ['finished', 'archived'] }))
      .toEqual(['finished', 'registering', 'scheduled']);
    expect(sortedIds({ mode: 'START_DATE_DESC', orderedIds: [] }))
      .toEqual(['scheduled', 'registering', 'finished']);
    expect(sortedIds({ mode: 'START_DATE_ASC', orderedIds: ['scheduled'] }))
      .toEqual(['scheduled', 'finished', 'registering']);
    expect(competitions.map(({ id }) => id)).toEqual(['scheduled', 'registering', 'finished']);
  });

  function fixture() {
    const prisma = {
      tournament: { findMany: jest.fn().mockResolvedValue(competitions), count: jest.fn().mockResolvedValue(1) },
      publicCompetitionOrder: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    };
    return { prisma, service: new CompetitionsService(prisma as never, {} as never) };
  }

  it('limits reads and writes to super administrators', async () => {
    const { service, prisma } = fixture();
    const controller = AdminCompetitionsController.prototype;
    expect(Reflect.getMetadata('roles', controller.getCompetitionOrder)).toEqual([Role.ROOT]);
    expect(Reflect.getMetadata('roles', controller.updateCompetitionOrder)).toEqual([Role.ROOT]);
    await expect(service.getPublicCompetitionOrder(admin)).rejects.toThrow('仅超级管理员');
    await expect(service.savePublicCompetitionOrder({ mode: 'REGISTRATION_FIRST', orderedIds: [] }, admin)).rejects.toThrow('仅超级管理员');
    expect(prisma.publicCompetitionOrder.upsert).not.toHaveBeenCalled();
  });

  it('saves both settings together and rejects stale manual entries', async () => {
    const { prisma, service } = fixture();
    const saved = { mode: 'START_DATE_ASC' as const, orderedIds: ['scheduled'] };
    await expect(service.savePublicCompetitionOrder(saved, root)).resolves.toEqual(saved);
    expect(prisma.tournament.count).toHaveBeenCalledWith({
      where: { isArchived: false, isPublished: true, approvalStatus: 'APPROVED', id: { in: ['scheduled'] } },
    });
    expect(prisma.publicCompetitionOrder.upsert).toHaveBeenCalledWith({
      where: { id: 1 }, create: { id: 1, ...saved }, update: saved,
    });
    prisma.tournament.count.mockResolvedValue(0);
    await expect(service.savePublicCompetitionOrder(saved, root)).rejects.toThrow('前台赛事列表已变化');
    expect(prisma.publicCompetitionOrder.upsert).toHaveBeenCalledTimes(1);
    prisma.publicCompetitionOrder.findUnique.mockResolvedValue({ ...saved, orderedIds: ['archived', 'scheduled'] });
    const view = await service.getPublicCompetitionOrder(root);
    expect(view.orderedIds).toEqual(['scheduled']);
    expect(view.competitions.map(({ id }) => id)).toEqual(['scheduled', 'finished', 'registering']);
  });
});
