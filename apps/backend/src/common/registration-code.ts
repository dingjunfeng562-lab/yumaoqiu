import { randomInt } from 'node:crypto';
import { EntrantType } from '@prisma/client';

// 去掉 0/O/1/I 等易混淆字符，便于口头/手抄。
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateRegistrationCode(length = CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeRegistrationCode(value?: string | null): string {
  return (value ?? '').replace(/[\s-]/g, '').toUpperCase();
}

export function isValidRegistrationCode(value: string): boolean {
  return /^[A-Z2-9]{6,16}$/.test(value);
}

export function registrationCodeFor(
  tournament: {
    schoolRegistrationCode?: string | null;
    socialRegistrationCode?: string | null;
  },
  entrantType: EntrantType,
): string | null {
  return entrantType === EntrantType.SCHOOL
    ? tournament.schoolRegistrationCode ?? null
    : tournament.socialRegistrationCode ?? null;
}
