import { createHmac, timingSafeEqual } from 'node:crypto';

// Admin previews use short-lived, file-scoped links. These do not create or
// disclose the tournament's public gallery address.
const PREVIEW_LIFETIME_SECONDS = 60 * 60;

function signature(path: string, expires: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required for photo previews');
  return createHmac('sha256', secret)
    .update(`photo-preview\n${path}\n${expires}`)
    .digest('hex');
}

export function signedPhotoPreviewUrl(path: string) {
  const expires = String(Math.floor(Date.now() / 1000) + PREVIEW_LIFETIME_SECONDS);
  return `/api/uploads/${path}?expires=${expires}&signature=${signature(path, expires)}`;
}

export function validPhotoPreviewSignature(
  path: string,
  expires?: string,
  suppliedSignature?: string,
) {
  if (
    typeof expires !== 'string' ||
    !/^\d{10}$/.test(expires) ||
    Number(expires) <= Math.floor(Date.now() / 1000) ||
    typeof suppliedSignature !== 'string' ||
    !/^[a-f0-9]{64}$/.test(suppliedSignature)
  ) return false;
  return timingSafeEqual(
    Buffer.from(suppliedSignature, 'hex'),
    Buffer.from(signature(path, expires), 'hex'),
  );
}
