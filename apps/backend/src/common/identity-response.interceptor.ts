import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs/operators';

/** 证件密文/查重标识只在服务层使用，所有HTTP响应均移除。 */
export function stripIdentityStorage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIdentityStorage);
  if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['identityData', 'partnerIdentityData', 'personKey'].includes(key)).map(([key, item]) => [key, stripIdentityStorage(item)]));
}
@Injectable()
export class IdentityResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) { return next.handle().pipe(map(stripIdentityStorage)); }
}
