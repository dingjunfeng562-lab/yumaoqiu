import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
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
    const user = await this.prisma.$transaction(async (tx) => {
      const freshInviteCode = await tx.inviteCode.findUnique({
        where: { id: inviteCode.id },
      });
      if (!freshInviteCode) {
        throw new BadRequestException('邀请码无效');
      }
      this.ensureInviteCodeUsable(freshInviteCode);

      const created = await tx.user.create({
        data: {
          username,
          email,
          passwordHash,
          role: freshInviteCode.role,
          inviteCodeId: freshInviteCode.id,
        },
      });
      await tx.inviteCode.update({
        where: { id: freshInviteCode.id },
        data: { usedUses: { increment: 1 } },
      });
      return created;
    });

    return {
      message: '注册成功',
      user: this.serializeUser(user),
    };
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
        message: '用户名需为 4-20 位字母、数字或下划线，且首字符为字母',
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

  async createAdmin(username: string, email: string, password: string) {
    return this.createManagedUser(Role.ADMIN, username, email, password);
  }

  async createReferee(username: string, email: string, password: string) {
    return this.createManagedUser(Role.REFEREE, username, email, password);
  }

  async createPlayer(username: string, email: string, password: string) {
    return this.createManagedUser(Role.PLAYER, username, email, password);
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

  async resetUserPassword(userId: string) {
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

  async updateUserStatus(userId: string, dto: UpdateUserStatusDto) {
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

  async listUsers() {
    const users = await this.prisma.user.findMany({
      include: {
        inviteCode: {
          select: { code: true },
        },
        competitionRegistrations: {
          select: { status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => ({
      ...this.serializeUser(user),
      inviteCode: user.inviteCode?.code ?? null,
      registrationStatus: user.competitionRegistrations[0]?.status ?? null,
      createdAt: user.createdAt,
    }));
  }

  async createInviteCode(dto: CreateInviteCodeDto) {
    const code = await this.generateUniqueInviteCode();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('有效期格式不正确');
    }

    return this.prisma.inviteCode.create({
      data: {
        code,
        role: dto.role,
        maxUses: dto.maxUses,
        expiresAt,
        remark: dto.remark?.trim() || null,
      },
    });
  }

  async listInviteCodes() {
    return this.prisma.inviteCode.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateInviteCode(id: string, isEnabled: boolean) {
    const inviteCode = await this.prisma.inviteCode.findUnique({ where: { id } });
    if (!inviteCode) {
      throw new NotFoundException('邀请码不存在');
    }
    return this.prisma.inviteCode.update({
      where: { id },
      data: { isEnabled },
    });
  }

  async deleteInviteCode(id: string) {
    const inviteCode = await this.prisma.inviteCode.findUnique({
      where: { id },
      include: { users: { select: { id: true } } },
    });
    if (!inviteCode) {
      throw new NotFoundException('邀请码不存在');
    }
    if (inviteCode.users.length) {
      throw new BadRequestException('该邀请码已被使用，不能删除');
    }
    return this.prisma.inviteCode.delete({ where: { id } });
  }

  async deleteUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return this.prisma.user.delete({ where: { id } });
  }

  private async createManagedUser(role: Role, usernameInput: string, emailInput: string, password: string) {
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
    const user = await this.prisma.user.create({
      data: { username, email, passwordHash, role },
    });
    return this.serializeUser(user);
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
    createdAt?: Date;
  }) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.username,
      role: user.role,
      status: user.status ?? UserStatus.ACTIVE,
      mustChangePassword: Boolean(user.mustChangePassword),
      createdAt: user.createdAt,
    };
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
      throw new BadRequestException('用户名需为 4-20 位字母、数字或下划线，且首字符为字母');
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
