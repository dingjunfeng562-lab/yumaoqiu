import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const { user } = context.switchToHttp().getRequest();
    // 超级管理员(ROOT)拥有最高权限,通过所有角色检查。
    // 注意:总管理员(SUPER_ADMIN)已降权,不再自动通过,必须在 @Roles 中显式列出。
    if (user?.role === Role.ROOT) return true;
    return required.includes(user?.role);
  }
}
