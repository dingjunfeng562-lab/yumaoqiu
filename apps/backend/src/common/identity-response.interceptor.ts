import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs/operators';

const STORAGE_KEYS = new Set(['identityData', 'partnerIdentityData', 'personKey']);

/** 只处理普通对象（Prisma 查询结果、对象字面量）；类实例原样放行。 */
function isPlainObject(value: object) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 证件哈希/查重标识只在服务层使用，所有HTTP响应均移除。
 * 只递归普通对象和数组：StreamableFile（封面、照片、收款码等文件下载）、Buffer、Date 等类实例
 * 若被拷贝成普通对象，会被当成 JSON 输出，文件就打不开了。
 */
export function stripIdentityStorage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIdentityStorage);
  if (!value || typeof value !== 'object' || !isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !STORAGE_KEYS.has(key))
      .map(([key, item]) => [key, stripIdentityStorage(item)]),
  );
}

@Injectable()
export class IdentityResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) { return next.handle().pipe(map(stripIdentityStorage)); }
}
