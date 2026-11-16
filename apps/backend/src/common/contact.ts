import { BadRequestException } from '@nestjs/common';
import { normalizeContact } from '../payments/payment-rules';

/**
 * 联系方式校验。
 * 原来只要求「非空」，于是「1」「00」「11111111111」这类占位号码也能报名，
 * 而认人、查重、通知都靠这个号码，垃圾号码会让同一个人被当成好几个人。
 */

/** 中国大陆手机号：1 开头、第二位 3-9、共 11 位。空格、横线、括号、+86 先归一化掉。 */
export function isMainlandMobile(value: string | null | undefined): boolean {
  return /^1[3-9]\d{9}$/.test(normalizeContact(value));
}

/** 座机：0 开头区号 + 7~8 位号码，归一化后 10~12 位。 */
export function isLandline(value: string | null | undefined): boolean {
  return /^0\d{9,11}$/.test(normalizeContact(value));
}

/** 线上报名：必须是真实手机号。 */
export function assertMobileContact(
  value: string | null | undefined,
  label = '联系方式',
): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) throw new BadRequestException(`请填写${label}`);
  if (!isMainlandMobile(trimmed)) {
    throw new BadRequestException(
      `${label}须填写 11 位手机号（例如 13800138000）`,
    );
  }
  return trimmed;
}

/**
 * 后台代录 / 导入 / 编辑：手机号或座机都行，但必须是「像个号码」的 7~15 位数字，
 * 避免历史数据里的「1」「00」这类占位号码继续混进来。
 */
export function assertAdminContact(
  value: string | null | undefined,
  label = '联系方式',
): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) throw new BadRequestException(`请填写${label}`);
  if (isMainlandMobile(trimmed) || isLandline(trimmed)) return trimmed;
  if (!/^\d{7,15}$/.test(normalizeContact(trimmed))) {
    throw new BadRequestException(
      `${label}填写有误，请填 11 位手机号或带区号的座机`,
    );
  }
  return trimmed;
}
