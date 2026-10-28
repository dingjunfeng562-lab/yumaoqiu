import { BadRequestException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';

// 邀请码余额相关单元测试：用 mock 的 Prisma 事务验证创建时预扣、
// 余额不足时拒绝、超管不扣、预扣后注册不重复扣费，以及历史邀请码的兼容逻辑。

function createTransactionMock() {
  return {
    $queryRaw: jest.fn(),
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    inviteCode: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  };
}

function createPrismaMock(tx: ReturnType<typeof createTransactionMock>) {
  return {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
    },
    inviteCode: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
}

function buildService() {
  const tx = createTransactionMock();
  const prisma = createPrismaMock(tx);
  const service = new AuthService(prisma as never, {} as never);
  return { service, prisma, tx };
}

describe('AuthService 邀请码余额', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('按填写次数从管理员余额中预扣', async () => {
    const { service, prisma, tx } = buildService();
    prisma.inviteCode.findUnique.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValue([
      { staffInviteLimit: 20, staffInviteUsed: 0, role: Role.ADMIN, status: UserStatus.ACTIVE },
    ]);
    tx.user.update.mockResolvedValue({});
    tx.inviteCode.create.mockImplementation(({ data }: { data: object }) => ({
      id: 'invite-1',
      usedUses: 0,
      isEnabled: true,
      ...data,
    }));

    const created = await service.createInviteCode(
      { role: 'REFEREE', maxUses: 10 },
      { id: 'admin-1', role: Role.ADMIN },
    );

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: { staffInviteUsed: { increment: 10 } },
    });
    expect(created).toMatchObject({ maxUses: 10, quotaCharged: true, role: Role.REFEREE });
  });

  it('使用次数超过余额时拒绝创建', async () => {
    const { service, prisma, tx } = buildService();
    prisma.inviteCode.findUnique.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValue([
      { staffInviteLimit: 20, staffInviteUsed: 15, role: Role.ADMIN, status: UserStatus.ACTIVE },
    ]);

    await expect(
      service.createInviteCode(
        { role: 'PLAYER', maxUses: 6 },
        { id: 'admin-1', role: Role.ADMIN },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.inviteCode.create).not.toHaveBeenCalled();
  });

  it('不扣除超级管理员的余额', async () => {
    const { service, prisma, tx } = buildService();
    prisma.inviteCode.findUnique.mockResolvedValue(null);
    tx.inviteCode.create.mockImplementation(({ data }: { data: object }) => ({
      id: 'invite-1',
      usedUses: 0,
      isEnabled: true,
      ...data,
    }));

    await service.createInviteCode(
      { role: 'ADMIN', maxUses: 50 },
      { id: 'root-1', role: Role.ROOT },
    );

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.inviteCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ maxUses: 50, quotaCharged: false }),
    });
  });

  it('使用已预扣的邀请码时不再扣发放人余额', async () => {
    const { service, prisma, tx } = buildService();
    prisma.inviteCode.findUnique.mockResolvedValue({
      id: 'invite-1',
      code: 'YZY-2026-ABC123',
      role: Role.REFEREE,
      maxUses: 3,
      usedUses: 0,
      quotaCharged: true,
      isEnabled: true,
      expiresAt: null,
      createdById: 'admin-1',
    });
    prisma.user.findUnique.mockResolvedValue(null);
    tx.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.com',
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
    });
    tx.inviteCode.updateMany.mockResolvedValue({ count: 1 });
    tx.user.create.mockImplementation(({ data }: { data: object }) => ({
      id: 'user-1',
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      ...data,
    }));
    const consume = jest.spyOn(
      service as unknown as { consumeStaffQuota: (tx: unknown, managerId: string) => Promise<void> },
      'consumeStaffQuota',
    ).mockResolvedValue(undefined);

    await service.register({
      inviteCode: 'YZY-2026-ABC123',
      username: 'newreferee',
      email: 'newreferee@example.com',
      password: 'Password1',
    });

    expect(consume).not.toHaveBeenCalled();
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ staffQuotaCharged: true }),
    });
  });

  it('历史邀请码仍在注册时扣除余额', async () => {
    const { service, prisma, tx } = buildService();
    prisma.inviteCode.findUnique.mockResolvedValue({
      id: 'invite-legacy',
      code: 'YZY-2026-LEGACY',
      role: Role.REFEREE,
      maxUses: 1,
      usedUses: 0,
      quotaCharged: false,
      isEnabled: true,
      expiresAt: null,
      createdById: 'admin-1',
    });
    prisma.user.findUnique.mockResolvedValue(null);
    tx.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.com',
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
    });
    tx.inviteCode.updateMany.mockResolvedValue({ count: 1 });
    tx.user.create.mockImplementation(({ data }: { data: object }) => ({
      id: 'user-2',
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      ...data,
    }));
    const consume = jest.spyOn(
      service as unknown as { consumeStaffQuota: (tx: unknown, managerId: string) => Promise<void> },
      'consumeStaffQuota',
    ).mockResolvedValue(undefined);

    await service.register({
      inviteCode: 'YZY-2026-LEGACY',
      username: 'legacyreferee',
      email: 'legacyreferee@example.com',
      password: 'Password1',
    });

    expect(consume).toHaveBeenCalledWith(tx, 'admin-1');
  });
});
