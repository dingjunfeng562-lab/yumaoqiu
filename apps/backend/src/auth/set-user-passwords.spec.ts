import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

const administrator = { id: 'manager', role: Role.ADMIN };
const password = 'FixtureOnly123';

function fixture() {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    user: { count: jest.fn().mockResolvedValue(2) },
    $transaction: jest.fn(async work => work({ user: { updateMany } })),
  };
  return { service: new AuthService(prisma as never, {} as never), prisma, updateMany };
}

describe('set managed user passwords', () => {
  it('updates the selected accounts in one transaction with independent password hashes', async () => {
    const { service, prisma, updateMany } = fixture();
    await expect(service.setUserPasswords(['staff-2', 'staff-1'], password, administrator)).resolves.toEqual({ updated: 2 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(2);
    const [first, second] = updateMany.mock.calls.map(([argument]) => argument);
    expect(first.where).toEqual({ id: 'staff-1', managerId: 'manager', role: { in: [Role.PLAYER, Role.REFEREE, Role.PHOTOGRAPHER] } });
    expect(first.data).toMatchObject({ mustChangePassword: false, failedAttempts: 0, lockedUntil: null });
    expect(first.data.passwordHash).not.toBe(second.data.passwordHash);
    await expect(bcrypt.compare(password, first.data.passwordHash)).resolves.toBe(true);
    await expect(bcrypt.compare(password, second.data.passwordHash)).resolves.toBe(true);
  });

  it('rejects the entire selection when an account is outside the manager scope', async () => {
    const { service, prisma, updateMany } = fixture();
    prisma.user.count.mockResolvedValue(1);
    await expect(service.setUserPasswords(['staff-1', 'another-manager'], password, administrator)).rejects.toBeInstanceOf(ForbiddenException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('checks account ownership again inside the transaction', async () => {
    const { service, updateMany } = fixture();
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(service.setUserPasswords(['staff-1', 'staff-2'], password, administrator)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects invalid passwords before changing any account', async () => {
    const { service, prisma } = fixture();
    await expect(service.setUserPasswords(['staff-1'], 'weak', administrator)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });
});
