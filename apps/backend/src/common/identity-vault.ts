import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

/**
 * 身份证号不存原文。库里存四项：
 * - fingerprint：带密钥的哈希（HMAC-SHA256），用于查重；
 * - birthDate：出生日期（算年龄）；masked：打码号码（后台页面核对）；
 * - encrypted：完整号码的密文（AES-256-GCM），只在后台「导出报名表」时解密（2026-11-19 起）。
 *
 * 哈希必须带密钥：身份证号可能的取值很少，打码号码和出生日期又已经露出大部分位数，
 * 不带密钥的 SHA-256 几次尝试就能反推出原号码。
 * 加密密钥由 REGISTRATION_IDENTITY_KEY 派生。这把密钥丢失或更换后，旧报名的密文就解不开了
 * （导出时退回打码号码），查重也对不上，所以这把密钥必须另外妥善保管。
 */
function key() {
  const encoded = process.env.REGISTRATION_IDENTITY_KEY ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(encoded)) throw new ServiceUnavailableException('证件核验服务尚未配置，请联系管理员');
  return Buffer.from(encoded, 'hex');
}

export function identityFingerprint(number: string) {
  return createHmac('sha256', key()).update(`identity:v1:${number}`).digest('hex');
}

const CIPHER_VERSION = 'v2';

function encryptionKey() {
  return Buffer.from(hkdfSync('sha256', key(), Buffer.alloc(0), 'identity-number-encryption:v2', 32));
}

/**
 * 加密完整身份证号。fingerprint 作为附加认证数据：密文只能和它自己的哈希配对解开，
 * 被挪到别的报名记录上会解密失败。格式：v2.<iv>.<tag>.<密文>（base64url）。
 */
export function encryptIdentityNumber(number: string, fingerprint: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(fingerprint, 'utf8'));
  const data = Buffer.concat([cipher.update(number, 'utf8'), cipher.final()]);
  return [CIPHER_VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** 密文格式检查（不解密）：读库时只保留本版本的密文，旧版本或损坏的值丢掉。 */
export function isIdentityCipher(value: unknown): value is string {
  return typeof value === 'string' && /^v2\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(value);
}

/**
 * 解密完整身份证号；密文格式不对、密钥不对、被篡改或和 fingerprint 不配对时返回 null。
 * 解出的号码再用哈希核对一遍，确认就是这条记录的号码。
 */
export function decryptIdentityNumber(encrypted: unknown, fingerprint: string): string | null {
  if (!isIdentityCipher(encrypted)) return null;
  const [, iv, tag, data] = encrypted.split('.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(fingerprint, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const number = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    return identityFingerprint(number) === fingerprint ? number : null;
  } catch {
    return null;
  }
}
