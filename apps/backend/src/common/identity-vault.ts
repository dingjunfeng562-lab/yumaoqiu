import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

function key() {
  const encoded = process.env.REGISTRATION_IDENTITY_KEY ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(encoded)) throw new ServiceUnavailableException('证件核验服务尚未配置，请联系管理员');
  return Buffer.from(encoded, 'hex');
}
export function identityFingerprint(number: string) { return createHmac('sha256', key()).update(`identity:v1:${number}`).digest('hex'); }
export function encryptIdentity(number: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), nonce);
  const encrypted = Buffer.concat([cipher.update(number, 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}
export function decryptIdentity(value: string) {
  const [version, nonce, tag, encrypted] = value.split('.');
  if (version !== 'v1' || !nonce || !tag || !encrypted) throw new Error('无效的证件密文');
  const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(nonce, 'base64'));
  cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64')), cipher.final()]).toString('utf8');
}
