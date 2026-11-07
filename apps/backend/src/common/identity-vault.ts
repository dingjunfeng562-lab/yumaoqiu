import { createHmac } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

/**
 * 身份证号不落库，也不做可还原的加密：只保存带密钥的哈希（HMAC-SHA256）用于查重，
 * 另存出生日期（算年龄）和打码号码（后台核对）。
 *
 * 必须带密钥：身份证号可能的取值很少，打码号码和出生日期又已经露出大部分位数，
 * 不带密钥的 SHA-256 几次尝试就能反推出原号码。
 * 密钥丢失或更换不会丢数据（库里本来就没有原号码），只是新旧报名的查重对不上。
 */
function key() {
  const encoded = process.env.REGISTRATION_IDENTITY_KEY ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(encoded)) throw new ServiceUnavailableException('证件核验服务尚未配置，请联系管理员');
  return Buffer.from(encoded, 'hex');
}

export function identityFingerprint(number: string) {
  return createHmac('sha256', key()).update(`identity:v1:${number}`).digest('hex');
}
