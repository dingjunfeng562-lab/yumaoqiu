import { BadRequestException } from '@nestjs/common';
import { EventsService } from './events.service';
import { PrismaService } from '../prisma/prisma.service';

function createPrisma() {
  return {
    tournament: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
    tournamentGroup: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'g1', name: '学生组', fieldTemplate: 'SCHOOL' }),
    },
    event: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
  };
}

function baseDto(overrides: Record<string, unknown>) {
  return {
    tournamentId: 't1',
    type: 'MENS_SINGLES',
    format: 'GROUP_PLUS_KNOCKOUT_STD',
    scoringRule: 'TWENTYONE_BO3',
    scoringMode: 'CAPPED_30',
    ...overrides,
  } as never;
}

describe('EventsService 分组配置', () => {
  it('手动小组数量优先，并清空每组人数', async () => {
    const prisma = createPrisma();
    const service = new EventsService(prisma as unknown as PrismaService);
    const created = await service.create(
      baseDto({ groupCount: 8, groupSize: 4, qualifiersPerGroup: 1 }),
    );
    expect(created.groupCount).toBe(8);
    expect(created.groupSize).toBeNull();
  });

  it('只填每组人数时清空手动组数', async () => {
    const prisma = createPrisma();
    const service = new EventsService(prisma as unknown as PrismaService);
    const created = await service.create(baseDto({ groupSize: 6, qualifiersPerGroup: 2 }));
    expect(created.groupSize).toBe(6);
    expect(created.groupCount).toBeNull();
  });

  it('不分组赛制会清空分组配置', async () => {
    const prisma = createPrisma();
    const service = new EventsService(prisma as unknown as PrismaService);
    const created = await service.create(
      baseDto({ format: 'SINGLE_ELIMINATION', groupCount: 8, groupSize: 4 }),
    );
    expect(created.groupCount).toBeNull();
    expect(created.groupSize).toBeNull();
  });

  it('每组出线数大于每组人数时拒绝保存', async () => {
    const prisma = createPrisma();
    const service = new EventsService(prisma as unknown as PrismaService);
    await expect(
      service.create(baseDto({ groupSize: 4, qualifiersPerGroup: 5 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('每组人数超出 2–8 时拒绝保存', async () => {
    const prisma = createPrisma();
    const service = new EventsService(prisma as unknown as PrismaService);
    await expect(service.create(baseDto({ groupSize: 9 }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
