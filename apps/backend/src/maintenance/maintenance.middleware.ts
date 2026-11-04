import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { MaintenanceService } from './maintenance.service';

export const MAINTENANCE_MESSAGE = '系统维护中，请稍后再访问';
export const MAINTENANCE_READONLY_MESSAGE = '全服维护中，不能进行任何操作';

// 读请求一律放行：前台页面在服务端取数时不带登录态，拦掉会让管理员看到的前台变成空页。
// 普通用户看不到这些页面——前端 proxy 已把所有页面换成维护页。
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// 维护期间任何人都能调用的写接口：登录（AuthController 再按角色拦）和续期登录态。
const OPEN_WRITE_PATHS = [/^\/api(?:\/v1)?\/auth\/(?:login|refresh)\/?$/];

/**
 * 全服维护闸门。挂在 Express 最前面（main.ts），开启维护后只有超级管理员能做写操作，
 * 管理员只能查看，其余账号和游客的写请求一律 503。
 */
@Injectable()
export class MaintenanceMiddleware {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  use = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (READ_METHODS.has(req.method.toUpperCase())) return next();
      const state = await this.maintenance.getState();
      if (!state.enabled) return next();
      if (OPEN_WRITE_PATHS.some((pattern) => pattern.test(req.path)))
        return next();

      const role = await this.staffRole(req.headers.authorization);
      if (role === Role.ROOT) return next();
      const readonly = role === Role.ADMIN;
      res
        .status(503)
        .set('Cache-Control', 'no-store')
        .json({
          statusCode: 503,
          code: readonly ? 'MAINTENANCE_READONLY' : 'MAINTENANCE',
          message: readonly
            ? MAINTENANCE_READONLY_MESSAGE
            : MAINTENANCE_MESSAGE,
        });
    } catch (error) {
      next(error);
    }
  };

  private async staffRole(authorization?: string): Promise<Role | null> {
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
    if (!match) return null;
    let payload: { sub?: string; role?: string; tokenType?: string };
    try {
      payload = await this.jwt.verifyAsync(match[1]);
    } catch {
      return null;
    }
    if (!payload?.sub || payload.tokenType === 'refresh') return null;
    if (payload.role !== Role.ROOT && payload.role !== Role.ADMIN) return null;
    // 令牌里的角色可能已经过时（被降级或停用），以库里为准。
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { role: true, status: true },
    });
    if (!user || user.status === UserStatus.DISABLED) return null;
    return user.role === Role.ROOT || user.role === Role.ADMIN
      ? user.role
      : null;
  }
}
