import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthActor, MANAGED_ROLES, STAFF_ROLES } from './admin-scope';
import { effectivePermissions, hasPermission } from './permissions';
import { LoginDto } from './dto/login.dto';
import {
  CheckEmailDto,
  CheckInviteDto,
  CheckUsernameDto,
  CreateInviteCodeDto,
  INVITE_CODE_PATTERN,
  PASSWORD_PATTERN,
  RefreshTokenDto,
  RegisterDto,
  UpdateUserStatusDto,
  USERNAME_PATTERN,
} from './dto/auth.dto';

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_MINUTES = 15;
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 2 * 60 * 60;
const REFRESH_TOKEN_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
const REMEMBERED_REFRESH_TOKEN_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
const INVITE_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const INVALID_LOGIN_MESSAGE = '账号或密码错误';
const LOCKED_LOGIN_MESSAGE = '账号已锁定,请稍后再试';
const RENAME_LIMIT_PER_YEAR = 3;
const RENAME_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const inviteCodeValue = this.normalizeInviteCode(dto.inviteCode);
    const username = this.normalizeUsername(dto.username);
    const email = this.normalizeEmail(dto.email);

    this.assertValidUsername(username);
    this.assertValidEmail(email);
    this.assertValidPassword(dto.password);

    const inviteCode = await this.prisma.inviteCode.findUnique({
      where: { code: inviteCodeValue },
    });
    if (!inviteCode) {
      throw new BadRequestException('邀请码无效');
    }
    this.ensureInviteCodeUsable(inviteCode);

    const usernameExists = await this.prisma.user.findUnique({ where: { username } });
    if (usernameExists) {
      throw new ConflictException('用户名已被占用');
    }

    const emailExists = await this.prisma.user.findUnique({ where: { email } });
    if (emailExists) {
      throw new ConflictException('邮箱已被占用');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        // 邀请码的归属关系是永久的：通过管理员邀请码注册的账号会挂在该管理员名下。
        // 新邀请码在创建时已按使用次数预扣余额；历史的管理员邀请码仍在这里扣 1 次。
        const issuer = inviteCode.createdById
          ? await tx.user.findUnique({ where: { id: inviteCode.createdById } })
          : null;
        if (inviteCode.createdById && (!issuer || issuer.status !== UserStatus.ACTIVE)) {
          throw new ForbiddenException('邀请码发放人已停用');
        }
        if (issuer && !hasPermission(issuer, 'INVITES')) {
          throw new ForbiddenException('邀请码发放人已无发放权限');
        }
        if (issuer && issuer.role !== Role.ROOT && !MANAGED_ROLES.includes(inviteCode.role)) {
          throw new ForbiddenException('管理员不能发放此角色的邀请码');
        }
        const managerId = issuer && issuer.role !== Role.ROOT ? issuer.id : null;
        const staffQuotaCharged = Boolean(
          managerId && (inviteCode.quotaCharged || STAFF_ROLES.includes(inviteCode.role)),
        );
        // 新邀请码在创建时已预扣余额；只有历史邀请码仍需在注册时扣除。
        if (managerId && !inviteCode.quotaCharged && STAFF_ROLES.includes(inviteCode.role)) {
          await this.consumeStaffQuota(tx, managerId);
        }
        const updatedInviteCode = await tx.inviteCode.updateMany({
          where: {
            id: inviteCode.id,
            isEnabled: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            usedUses: { lt: inviteCode.maxUses },
          },
          data: { usedUses: { increment: 1 } },
        });

        if (updatedInviteCode.count !== 1) {
          throw new ConflictException('邀请码已用尽');
        }

        return tx.user.create({
          data: {
            username,
            email,
            passwordHash,
            role: inviteCode.role,
            inviteCodeId: inviteCode.id,
            managerId,
            staffQuotaCharged,
          },
        });
      });

      return {
        message: '注册成功',
        user: this.serializeUser(user),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target)
      ) {
        if (error.meta.target.includes('username')) {
          throw new ConflictException('用户名已被占用');
        }
        if (error.meta.target.includes('email')) {
          throw new ConflictException('邮箱已被占用');
        }
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const identifier = dto.identifier.trim();
    if (!identifier) {
      throw new UnauthorizedException(INVALID_LOGIN_MESSAGE);
    }

    const normalizedIdentifier =
      dto.loginType === 'email' ? this.normalizeEmail(identifier) : this.normalizeUsername(identifier);

    if (dto.loginType === 'email' && !this.isValidEmail(normalizedIdentifier)) {
      throw new UnauthorizedException(INVALID_LOGIN_MESSAGE);
    }
    if (dto.loginType === 'username' && !USERNAME_PATTERN.test(normalizedIdentifier)) {
      throw new UnauthorizedException(INVALID_LOGIN_MESSAGE);
    }

    const user = await this.prisma.user.findUnique({
      where: dto.loginType === 'email' ? { email: normalizedIdentifier } : { username: normalizedIdentifier },
    });
    if (!user) {
      throw new UnauthorizedException(INVALID_LOGIN_MESSAGE);
    }
    if (user.status === UserStatus.DISABLED) {
      throw new ForbiddenException('账号已禁用');
    }

    const now = new Date();
    const lockExpired = Boolean(user.lockedUntil && user.lockedUntil <= now);
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new UnauthorizedException(LOCKED_LOGIN_MESSAGE);
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      await this.recordLoginFailure(user.id, lockExpired ? 0 : user.failedAttempts);
      throw new UnauthorizedException(INVALID_LOGIN_MESSAGE);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    const tokens = this.issueTokens(updatedUser, Boolean(dto.rememberMe));
    return {
      ...tokens,
      user: this.serializeUser(updatedUser),
    };
  }

  async refresh(dto: RefreshTokenDto) {
    let payload: {
      sub: string;
      username?: string;
      email?: string;
      role?: Role;
      tokenType?: string;
      rememberMe?: boolean;
    };

    try {
      payload = await this.jwt.verifyAsync(dto.refreshToken);
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    if (payload.tokenType !== 'refresh' || !payload.sub) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    return {
      ...this.issueTokens(user, Boolean(payload.rememberMe)),
      user: this.serializeUser(user),
    };
  }

  async checkUsername(dto: CheckUsernameDto) {
    const username = this.normalizeUsername(dto.username);
    if (!USERNAME_PATTERN.test(username)) {
      return {
        available: false,
        status: 'invalid_format',
        message: '用户名需为 2-20 位中文、字母、数字、下划线或连字符，首字符需为中文或字母',
      };
    }
    const exists = await this.prisma.user.findUnique({ where: { username } });
    return {
      available: !exists,
      status: exists ? 'occupied' : 'available',
      message: exists ? '用户名已被占用' : '用户名可用',
    };
  }

  async checkEmail(dto: CheckEmailDto) {
    const email = this.normalizeEmail(dto.email);
    if (!this.isValidEmail(email)) {
      return {
        available: false,
        status: 'invalid_format',
        message: '邮箱格式不正确',
      };
    }
    const exists = await this.prisma.user.findUnique({ where: { email } });
    return {
      available: !exists,
      status: exists ? 'occupied' : 'available',
      message: exists ? '邮箱已被占用' : '邮箱可用',
    };
  }

  async checkInvite(dto: CheckInviteDto) {
    const code = this.normalizeInviteCode(dto.inviteCode);
    if (!INVITE_CODE_PATTERN.test(code)) {
      return {
        available: false,
        status: 'invalid_format',
        message: '邀请码格式不正确',
      };
    }

    const inviteCode = await this.prisma.inviteCode.findUnique({ where: { code } });
    if (!inviteCode || !inviteCode.isEnabled) {
      return {
        available: false,
        status: 'invalid',
        message: '邀请码已失效',
      };
    }
    if (inviteCode.expiresAt && inviteCode.expiresAt < new Date()) {
      return {
        available: false,
        status: 'expired',
        message: '邀请码已失效',
      };
    }
    if (inviteCode.usedUses >= inviteCode.maxUses) {
      return {
        available: false,
        status: 'exhausted',
        message: '邀请码已用尽',
      };
    }
    return {
      available: true,
      status: 'valid',
      message: '邀请码有效',
      role: inviteCode.role,
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    return this.serializeUser(user);
  }

  async createRoot(username: string, email: string, password: string, actor: AuthActor) {
    return this.createManagedUser(Role.ROOT, username, email, password, actor);
  }

  async createAdmin(username: string, email: string, password: string, actor: AuthActor) {
    return this.createManagedUser(Role.ADMIN, username, email, password, actor);
  }

  async createReferee(username: string, email: string, password: string, actor: AuthActor) {
    return this.createManagedUser(Role.REFEREE, username, email, password, actor);
  }

  async createPlayer(username: string, email: string, password: string, actor: AuthActor) {
    return this.createManagedUser(Role.PLAYER, username, email, password, actor);
  }

  async createPhotographer(username: string, email: string, password: string, actor: AuthActor) {
    return this.createManagedUser(Role.PHOTOGRAPHER, username, email, password, actor);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    this.assertValidPassword(newPassword);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('当前密码错误');
    if (currentPassword === newPassword) {
      throw new BadRequestException('新密码不能与当前密码相同');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: false,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    return { success: true };
  }

  async resetUserPassword(userId: string, actor: AuthActor) {
    await this.requireManageableUser(userId, actor);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: true,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    return {
      success: true,
      temporaryPassword,
      mustChangePassword: true,
    };
  }

  async updateUserStatus(userId: string, dto: UpdateUserStatusDto, actor: AuthActor) {
    await this.requireManageableUser(userId, actor);
    const requesterId = actor.id;
    // 停用会立刻让目标账号已登录的会话失效，所以超级管理员不能把自己锁在后台之外。
    if (dto.status === UserStatus.DISABLED && requesterId && requesterId === userId) {
      throw new BadRequestException('不能禁用自己的账号');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: dto.status,
        ...(dto.status === UserStatus.ACTIVE
          ? { failedAttempts: 0, lockedUntil: null }
          : {}),
      },
    });

    return this.serializeUser(updated);
  }

  /**
   * 超级管理员（ROOT）修改任意用户的角色/权限分类，任何角色都可以指定，
   * 包括把别的账号提升为 ROOT。ROOT 不能修改自己的角色——那样可能让平台
   * 失去最高权限；确实要降级自己时，先提升另一个账号，再让对方来操作。
   */
  async updateUserRole(userId: string, role: Role, requesterId?: string) {
    if (requesterId && requesterId === userId) {
      throw new BadRequestException('不能修改自己的角色');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    if (user.role === role) {
      return this.serializeUser(user);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      // 先锁住该账号，避免并发提升角色时重复扣除余额。
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const charge = Boolean(current.managerId && !current.staffQuotaCharged && STAFF_ROLES.includes(role));
      if (charge) await this.consumeStaffQuota(tx, current.managerId!);
      // 角色变更后，该账号此前发出的特权邀请码一律作废。
      await tx.inviteCode.updateMany({ where: { createdById: userId }, data: { isEnabled: false } });
      return tx.user.update({
        where: { id: userId },
        data: { role, permissions: Prisma.DbNull, ...(charge ? { staffQuotaCharged: true } : {}) },
      });
    });
    return this.serializeUser(updated);
  }

  /**
   * 用户自助改名。每个用户都可以修改自己的显示名（即全局唯一的 `username`），
   * 上限为 {@link RENAME_LIMIT_PER_YEAR} 次；计费窗口从本窗口第一次改名起
   * 滚动计算 365 天。
   */
  async renameSelf(userId: string, nameInput: string) {
    const name = this.normalizeUsername(nameInput);
    this.assertValidUsername(name);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    if (user.username === name) {
      throw new BadRequestException('新名称与当前名称相同');
    }

    const now = new Date();
    const quota = this.getRenameQuota(user, now);
    if (quota.remaining <= 0) {
      throw new BadRequestException(
        `改名次数已用完（每年最多 ${quota.limit} 次）${
          quota.resetAt ? `，${this.formatDate(quota.resetAt)} 后可再次改名` : ''
        }`,
      );
    }

    // 新窗口的第一次改名开始计时；后续改名沿用同一锚点，
    // 保证所有改名都算在同一个 365 天里。
    const windowStart = quota.windowStart ?? now;

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: {
          username: name,
          nameChangeCount: quota.used + 1,
          nameChangeWindowStart: windowStart,
        },
      });
      return this.serializeUser(updated);
    } catch (error) {
      throw this.mapUsernameConflict(error);
    }
  }

  /**
   * 超级管理员修改任意账号的显示名。不占用用户自己的改名次数，
   * 也不受每年次数限制。
   */
  async renameUser(userId: string, nameInput: string, actor: AuthActor) {
    await this.requireManageableUser(userId, actor);
    const name = this.normalizeUsername(nameInput);
    this.assertValidUsername(name);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    if (user.username === name) {
      throw new BadRequestException('新名称与当前名称相同');
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { username: name },
      });
      return this.serializeUser(updated);
    } catch (error) {
      throw this.mapUsernameConflict(error);
    }
  }

  async listUsers(actor: AuthActor) {
    const users = await this.prisma.user.findMany({
      where: actor.role !== Role.ROOT ? { managerId: actor.id, role: { in: MANAGED_ROLES } } : {},
      include: {
        inviteCode: {
          select: { code: true },
        },
        competitionRegistrations: {
          select: { status: true },
        },
        _count: {
          select: { matches: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => ({
      ...this.serializeUser(user),
      inviteCode: user.inviteCode?.code ?? null,
      registrationStatus: user.competitionRegistrations[0]?.status ?? null,
      // 该用户作为裁判执裁过的场次总数（含待开始、进行中、已结束和已取消），
      // 便于一眼看出工作量。
      refereedMatchesCount: user._count.matches,
      managerId: user.managerId,
      staffInviteLimit: user.staffInviteLimit,
      staffInviteUsed: user.staffInviteUsed,
      staffInviteRemaining: Math.max(0, user.staffInviteLimit - user.staffInviteUsed),
      createdAt: user.createdAt,
    }));
  }

  async createInviteCode(dto: CreateInviteCodeDto, actor: AuthActor) {
    this.assertInviteManager(actor);
    this.assertCreatableRole(dto.role, actor);
    const code = await this.generateUniqueInviteCode();
    const maxUses = dto.maxUses ?? 1;
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('有效期格式不正确');
    }

    return this.prisma.$transaction(async (tx) => {
      // 超级管理员不受余额限制；其他发放人按填写的使用次数预扣余额。
      const quotaCharged = actor.role !== Role.ROOT;
      if (quotaCharged) await this.reserveInviteQuota(tx, actor.id, maxUses);
      return tx.inviteCode.create({
        data: {
          code,
          role: dto.role,
          maxUses,
          quotaCharged,
          expiresAt,
          remark: dto.remark?.trim() || null,
          createdById: actor.id,
        },
      });
    });
  }

  async listInviteCodes(actor: AuthActor) {
    this.assertInviteManager(actor);
    return this.prisma.inviteCode.findMany({
      where: actor.role !== Role.ROOT ? { createdById: actor.id } : {},
      include: { createdBy: { select: { id: true, username: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateInviteCode(id: string, isEnabled: boolean, actor: AuthActor) {
    this.assertInviteManager(actor);
    const inviteCode = await this.prisma.inviteCode.findUnique({ where: { id } });
    if (!inviteCode) {
      throw new NotFoundException('邀请码不存在');
    }
    this.requireManageableInvite(inviteCode, actor);
    return this.prisma.inviteCode.update({
      where: { id },
      data: { isEnabled },
    });
  }

  async deleteInviteCode(id: string, actor: AuthActor) {
    this.assertInviteManager(actor);
    const inviteCode = await this.prisma.inviteCode.findUnique({
      where: { id },
      include: { users: { select: { id: true } } },
    });
    if (!inviteCode) {
      throw new NotFoundException('邀请码不存在');
    }
    this.requireManageableInvite(inviteCode, actor);
    if (inviteCode.users.length) {
      throw new BadRequestException('该邀请码已被使用，不能删除');
    }
    return this.prisma.inviteCode.delete({ where: { id } });
  }

  async deleteUser(id: string, actor: AuthActor) {
    await this.requireManageableUser(id, actor);
    const requesterId = actor.id;
    if (requesterId && requesterId === id) {
      throw new BadRequestException('不能删除自己的账号');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    const blocked = await this.userDeletionBlockers([id]);
    const reasons = blocked.get(id);
    if (reasons) {
      throw new ConflictException(`该账号有${reasons.join('、')}，这些是审计记录，不能删除账号，请改为封禁。`);
    }
    return this.deleteOrExplain(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.inviteCode.updateMany({ where: { createdById: id }, data: { isEnabled: false } });
        // 不要回退 staffInviteUsed：它记录的是已消耗和已预扣的额度，
        // 删除账号不应把余额还回来。
        return tx.user.delete({ where: { id } });
      }),
    );
  }

  async deleteUsers(ids: string[], actor: AuthActor) {
    const requesterId = actor.id;
    const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (!uniqueIds.length) {
      throw new BadRequestException('请选择要删除的账号');
    }
    if (requesterId && uniqueIds.includes(requesterId)) {
      throw new BadRequestException('不能删除自己的账号');
    }
    for (const id of uniqueIds) await this.requireManageableUser(id, actor);

    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, username: true },
    });
    if (users.length !== uniqueIds.length) {
      throw new NotFoundException('部分账号不存在，请刷新后重试');
    }
    const blocked = await this.userDeletionBlockers(uniqueIds);
    if (blocked.size) {
      const names = users.filter((user) => blocked.has(user.id)).map((user) => user.username);
      throw new ConflictException(
        `以下账号有抽签、照片等审计记录，不能删除，请改为封禁或取消勾选后再删：${names.join('、')}`,
      );
    }

    const result = await this.deleteOrExplain(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.inviteCode.updateMany({ where: { createdById: { in: uniqueIds } }, data: { isEnabled: false } });
        return tx.user.deleteMany({ where: { id: { in: uniqueIds } } });
      }),
    );
    return { deleted: result.count };
  }

  // 这些表对 User 是 RESTRICT 外键（抽签/照片的审计记录），有记录时数据库拒绝删除账号。
  // 删除前先查出来给出可读原因，而不是让外键错误变成 500。
  private async userDeletionBlockers(ids: string[]) {
    const where = { in: ids };
    const count = { _all: true } as const;
    const sources = await Promise.all([
      this.prisma.drawOperationLog.groupBy({ by: ['operatorId'], where: { operatorId: where }, _count: count })
        .then((rows) => rows.map((r) => ['抽签操作记录', r.operatorId, r._count._all] as const)),
      this.prisma.drawSeedSetting.groupBy({ by: ['createdBy'], where: { createdBy: where }, _count: count })
        .then((rows) => rows.map((r) => ['种子设置记录', r.createdBy, r._count._all] as const)),
      this.prisma.drawRedrawRequest.groupBy({ by: ['requesterId'], where: { requesterId: where }, _count: count })
        .then((rows) => rows.map((r) => ['重抽申请', r.requesterId, r._count._all] as const)),
      this.prisma.drawRedrawRequest.groupBy({ by: ['decidedById'], where: { decidedById: where }, _count: count })
        .then((rows) => rows.map((r) => ['重抽审批', r.decidedById, r._count._all] as const)),
      this.prisma.teamDrawClearRequest.groupBy({ by: ['requesterId'], where: { requesterId: where }, _count: count })
        .then((rows) => rows.map((r) => ['团体签表清空申请', r.requesterId, r._count._all] as const)),
      this.prisma.teamDrawClearRequest.groupBy({ by: ['decidedById'], where: { decidedById: where }, _count: count })
        .then((rows) => rows.map((r) => ['团体签表清空审批', r.decidedById, r._count._all] as const)),
      this.prisma.photo.groupBy({ by: ['uploaderId'], where: { uploaderId: where }, _count: count })
        .then((rows) => rows.map((r) => ['上传的照片', r.uploaderId, r._count._all] as const)),
      this.prisma.photoOperationLog.groupBy({ by: ['operatorId'], where: { operatorId: where }, _count: count })
        .then((rows) => rows.map((r) => ['照片操作记录', r.operatorId, r._count._all] as const)),
    ]);
    const blockers = new Map<string, string[]>();
    for (const [label, userId, n] of sources.flat()) {
      if (!userId || !n) continue;
      blockers.set(userId, [...(blockers.get(userId) ?? []), `${n} 条${label}`]);
    }
    return blockers;
  }

  private async deleteOrExplain<T>(run: () => Promise<T>) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('该账号仍被其他数据引用，不能删除，请改为封禁');
      }
      throw error;
    }
  }

  private async createManagedUser(role: Role, usernameInput: string, emailInput: string, password: string, actor: AuthActor) {
    this.assertCreatableRole(role, actor);
    const username = this.normalizeUsername(usernameInput);
    const email = this.normalizeEmail(emailInput);
    this.assertValidUsername(username);
    this.assertValidEmail(email);
    this.assertValidPassword(password);

    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
    });
    if (exists?.username === username) {
      throw new ConflictException('用户名已被占用');
    }
    if (exists?.email === email) {
      throw new ConflictException('邮箱已被占用');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.$transaction(async (tx) => {
      const managerId = actor.role !== Role.ROOT ? actor.id : null;
      const staffQuotaCharged = Boolean(managerId && STAFF_ROLES.includes(role));
      if (staffQuotaCharged) await this.consumeStaffQuota(tx, managerId!);
      return tx.user.create({ data: { username, email, passwordHash, role, managerId, staffQuotaCharged } });
    });
    return this.serializeUser(user);
  }

  private assertCreatableRole(role: Role, actor: AuthActor) {
    if (actor.role !== Role.ROOT && !MANAGED_ROLES.includes(role)) throw new ForbiddenException('无权创建此角色的账号或邀请码');
  }

  private assertInviteManager(actor: AuthActor) {
    if (actor.role !== Role.ADMIN && actor.role !== Role.ROOT) {
      throw new ForbiddenException('只有管理员和超级管理员可以管理邀请码');
    }
  }

  private async requireManageableUser(id: string, actor: AuthActor) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('用户不存在');
    if (actor.role !== Role.ROOT && !(target.managerId === actor.id && MANAGED_ROLES.includes(target.role))) {
      throw new ForbiddenException('无权管理此账号');
    }
    return target;
  }

  private requireManageableInvite(invite: { createdById: string | null; role: Role }, actor: AuthActor) {
    if (actor.role === Role.ROOT) return;
    if (invite.createdById === actor.id && MANAGED_ROLES.includes(invite.role)) return;
    throw new ForbiddenException('无权管理此邀请码');
  }

  /**
   * `staffInviteUsed` 同时记录「直接创建的账号」和「邀请码预扣的额度」。
   * 锁定发放人所在行，可以让「查余额 → 预扣」在并发创建邀请码时保持原子。
   */
  private async reserveInviteQuota(tx: Prisma.TransactionClient, managerId: string, amount: number) {
    const [manager] = await tx.$queryRaw<
      Array<{ staffInviteLimit: number; staffInviteUsed: number; role: Role; status: UserStatus }>
    >`SELECT staffInviteLimit, staffInviteUsed, role, status FROM User WHERE id = ${managerId} FOR UPDATE`;
    if (!manager || manager.role === Role.ROOT || manager.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('当前账号不可发放邀请码');
    }
    const remaining = Math.max(0, Number(manager.staffInviteLimit) - Number(manager.staffInviteUsed));
    if (amount > remaining) {
      throw new BadRequestException(`使用次数不能大于余额（当前余额 ${remaining} 次）`);
    }
    await tx.user.update({
      where: { id: managerId },
      data: { staffInviteUsed: { increment: amount } },
    });
  }

  private async consumeStaffQuota(tx: Prisma.TransactionClient, managerId: string) {
    const updated = await tx.user.updateMany({
      where: {
        id: managerId, role: { not: Role.ROOT }, status: UserStatus.ACTIVE,
        staffInviteUsed: { lt: tx.user.fields.staffInviteLimit },
      },
      data: { staffInviteUsed: { increment: 1 } },
    });
    if (updated.count !== 1) {
      const manager = await tx.user.findUnique({ where: { id: managerId } });
      if (!manager || manager.role === Role.ROOT || manager.status !== UserStatus.ACTIVE) {
        throw new ForbiddenException('管理员已停用或角色已变更');
      }
      throw new BadRequestException('邀请码余额已用尽，请联系超级管理员分配');
    }
  }

  async getInviteQuota(actor: AuthActor) {
    this.assertInviteManager(actor);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    return {
      limit: actor.role !== Role.ROOT ? user.staffInviteLimit : null,
      used: actor.role !== Role.ROOT ? user.staffInviteUsed : 0,
      remaining: actor.role !== Role.ROOT ? Math.max(0, user.staffInviteLimit - user.staffInviteUsed) : null,
    };
  }

  async updateInviteQuota(id: string, limit: number, actor: AuthActor) {
    if (actor.role !== Role.ROOT) throw new ForbiddenException();
    // 带条件的 UPDATE 会和并发的额度预扣互斥。
    const updated = await this.prisma.user.updateMany({
      where: { id, role: { not: Role.ROOT }, staffInviteUsed: { lte: limit } },
      data: { staffInviteLimit: limit },
    });
    if (!updated.count) throw new BadRequestException('只能给非超级管理员账号分配邀请码余额，且总额度不能低于已占用数量');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    return { limit: user.staffInviteLimit, used: user.staffInviteUsed, remaining: user.staffInviteLimit - user.staffInviteUsed };
  }

  async getUserPermissions(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    return { permissions: effectivePermissions(user), customized: Array.isArray(user.permissions), role: user.role };
  }

  async setUserPermissions(userId: string, permissions: string[] | null) {
    if (permissions === undefined) throw new BadRequestException('请选择功能或恢复角色默认权限');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.role === Role.ROOT) throw new BadRequestException('超级管理员固定拥有全部权限；如需限制，请先调整角色');
    if (user.role !== Role.ADMIN && permissions?.includes('INVITES')) {
      throw new BadRequestException('邀请码权限仅可分配给管理员和超级管理员');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { permissions: permissions === null ? Prisma.DbNull : permissions } });
    return this.getUserPermissions(userId);
  }

  private buildTokenPayload(user: {
    id: string;
    username: string;
    email: string;
    role: Role;
    mustChangePassword?: boolean;
    status?: UserStatus;
  }) {
    return {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status ?? UserStatus.ACTIVE,
      mustChangePassword: Boolean(user.mustChangePassword),
    };
  }

  private buildRefreshTokenPayload(
    user: {
      id: string;
      username: string;
      email: string;
      role: Role;
    },
    rememberMe: boolean,
  ) {
    return {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      tokenType: 'refresh',
      rememberMe,
    };
  }

  private issueTokens(
    user: {
      id: string;
      username: string;
      email: string;
      role: Role;
      mustChangePassword?: boolean;
      status?: UserStatus;
    },
    rememberMe: boolean,
  ) {
    const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000);
    const refreshTokenTtl = rememberMe
      ? REMEMBERED_REFRESH_TOKEN_EXPIRES_IN_SECONDS
      : REFRESH_TOKEN_EXPIRES_IN_SECONDS;
    const refreshTokenExpiresAt = new Date(Date.now() + refreshTokenTtl * 1000);

    return {
      access_token: this.jwt.sign(this.buildTokenPayload(user), {
        expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
      }),
      refresh_token: this.jwt.sign(this.buildRefreshTokenPayload(user, rememberMe), {
        expiresIn: refreshTokenTtl,
      }),
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    };
  }

  private serializeUser(user: {
    id: string;
    username: string;
    email: string;
    role: Role;
    status?: UserStatus;
    mustChangePassword?: boolean;
    nameChangeCount?: number | null;
    nameChangeWindowStart?: Date | null;
    permissions?: Prisma.JsonValue;
    createdAt?: Date;
  }) {
    const quota = this.getRenameQuota(user);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.username,
      role: user.role,
      status: user.status ?? UserStatus.ACTIVE,
      mustChangePassword: Boolean(user.mustChangePassword),
      permissions: effectivePermissions(user),
      permissionsCustomized: Array.isArray(user.permissions),
      renameLimit: quota.limit,
      renameUsed: quota.used,
      renameRemaining: quota.remaining,
      renameResetAt: quota.resetAt,
      createdAt: user.createdAt,
    };
  }

  /**
   * 计算用户当前的改名额度。距窗口开始满 365 天后视为过期并清零，
   * 这样新的一年会自动重新开始计数。
   */
  private getRenameQuota(
    user: { nameChangeCount?: number | null; nameChangeWindowStart?: Date | null },
    now: Date = new Date(),
  ) {
    const windowStart = user.nameChangeWindowStart ?? null;
    const expired =
      !windowStart || now.getTime() - windowStart.getTime() >= RENAME_WINDOW_MS;
    const used = expired ? 0 : user.nameChangeCount ?? 0;
    const effectiveWindowStart = expired ? null : windowStart;
    return {
      limit: RENAME_LIMIT_PER_YEAR,
      used,
      remaining: Math.max(0, RENAME_LIMIT_PER_YEAR - used),
      windowStart: effectiveWindowStart,
      resetAt: effectiveWindowStart
        ? new Date(effectiveWindowStart.getTime() + RENAME_WINDOW_MS)
        : null,
    };
  }

  private mapUsernameConflict(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('该名称已被占用，请换一个');
    }
    return error;
  }

  private formatDate(date: Date) {
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  private normalizeUsername(username: string) {
    return username.trim();
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private normalizeInviteCode(code: string) {
    return code.trim().toUpperCase();
  }

  private assertValidUsername(username: string) {
    if (!USERNAME_PATTERN.test(username)) {
      throw new BadRequestException('用户名需为 2-20 位中文、字母、数字、下划线或连字符，首字符需为中文或字母');
    }
  }

  private assertValidEmail(email: string) {
    if (!this.isValidEmail(email)) {
      throw new BadRequestException('邮箱格式不正确');
    }
  }

  private assertValidPassword(password: string) {
    if (!PASSWORD_PATTERN.test(password)) {
      throw new BadRequestException('密码需为 8-32 位，并同时包含大写字母、小写字母和数字，且不能包含空格或中文');
    }
  }

  private isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private ensureInviteCodeUsable(inviteCode: {
    isEnabled: boolean;
    expiresAt: Date | null;
    maxUses: number;
    usedUses: number;
  }) {
    if (!inviteCode.isEnabled) {
      throw new BadRequestException('邀请码已失效');
    }
    if (inviteCode.expiresAt && inviteCode.expiresAt < new Date()) {
      throw new BadRequestException('邀请码已失效');
    }
    if (inviteCode.usedUses >= inviteCode.maxUses) {
      throw new BadRequestException('邀请码已用尽');
    }
  }

  private async recordLoginFailure(userId: string, currentFailedAttempts: number) {
    const nextFailedAttempts = currentFailedAttempts + 1;
    const lockedUntil =
      nextFailedAttempts >= LOGIN_FAILURE_LIMIT
        ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000)
        : null;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedAttempts: nextFailedAttempts,
        lockedUntil,
      },
    });
  }

  private async generateUniqueInviteCode() {
    for (let i = 0; i < 10; i += 1) {
      const code = `YZY-${new Date().getFullYear()}-${this.randomString(INVITE_CODE_CHARS, 6)}`;
      const exists = await this.prisma.inviteCode.findUnique({ where: { code } });
      if (!exists) {
        return code;
      }
    }
    throw new BadRequestException('邀请码生成失败，请重试');
  }

  private generateTemporaryPassword() {
    return `Tmp${this.randomString(TEMP_PASSWORD_CHARS, 9)}A1`;
  }

  private randomString(charset: string, length: number) {
    const bytes = randomBytes(length);
    let output = '';
    for (let i = 0; i < length; i += 1) {
      output += charset[bytes[i] % charset.length];
    }
    return output;
  }
}
