import { BadRequestException } from '@nestjs/common';
import { Gender, Prisma } from '@prisma/client';
import { AgeRule, ageForRule, checkAge, checkGender, checkReportedAge, GroupFields, parseIdentity } from './age-eligibility';
import { identityFingerprint } from './identity-vault';

/** 库里只存这三项，不存身份证号原文，也不存可还原的密文。 */
export type IdentityData = { fingerprint: string; birthDate: string; masked: string };
export type PersonInput = { identityNumber?: string; gender?: string | null; age?: number | string | null; shirtSize?: string | null };
export const SHIRT_SIZE_MAX_LENGTH = 32;

/** 读取库里已存的证件信息（只取哈希、出生日期、打码号码；旧数据里多出的字段一律丢弃）。 */
export function storedIdentity(value: Prisma.JsonValue | null | undefined): IdentityData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { fingerprint, birthDate, masked } = value;
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) return null;
  if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || typeof masked !== 'string') return null;
  return { fingerprint, birthDate, masked };
}

/**
 * @param stored 库里已存的证件信息。只有调用方没有提交身份证号（undefined）时才沿用，
 *   显式空字符串表示清空。只能由服务端传入，不能来自客户端请求体。
 */
export function preparePerson(input: PersonInput, fields: GroupFields, ageRule: AgeRule, label = '本人', stored?: Prisma.JsonValue | null) {
  const number = fields.identityNumber === 'hidden' ? '' : input.identityNumber?.trim() ?? '';
  const kept = fields.identityNumber !== 'hidden' && input.identityNumber === undefined ? storedIdentity(stored) : null;
  if (!number && !kept && fields.identityNumber === 'required') throw new BadRequestException(`请填写${label}身份证号`);
  const value = fields.gender === 'hidden' ? '' : input.gender;
  if (!value && fields.gender === 'required') throw new BadRequestException(`请填写${label}性别`);
  let gender: Gender | null = null;
  if (value) {
    if (!['MALE', 'FEMALE', '男', '女'].includes(value)) throw new BadRequestException(`${label}性别填写有误`);
    gender = value === 'MALE' || value === '男' ? 'MALE' : 'FEMALE';
  }
  let identity: IdentityData | null = kept;
  if (number) {
    const parsed = parseIdentity(number);
    identity = { fingerprint: identityFingerprint(parsed.normalized), birthDate: parsed.birthDate, masked: parsed.masked };
  }
  // 年龄：填了身份证号就按身份证自动算（以身份证为准）；否则用报名人自填的年龄。
  const rawAge = fields.age === 'hidden' || input.age === '' ? null : input.age ?? null;
  const reported = rawAge == null ? null : Number(rawAge);
  if (reported != null && (!Number.isInteger(reported) || reported < 0 || reported > 150)) throw new BadRequestException(`${label}年龄须为0至150的整数`);
  // 衣服尺寸由报名人自己填写，不限定选项。
  const shirtSize = fields.shirtSize === 'hidden' ? null : input.shirtSize?.trim() || null;
  if (shirtSize && shirtSize.length > SHIRT_SIZE_MAX_LENGTH) throw new BadRequestException(`${label}衣服尺寸不超过${SHIRT_SIZE_MAX_LENGTH}个字`);
  try {
    const check = identity ? checkAge(ageRule, identity.birthDate) : reported != null ? checkReportedAge(ageRule, reported) : checkAge(ageRule, null);
    const ageValue = identity ? ageForRule(ageRule, identity.birthDate) : reported;
    return { gender, identity, age: { status: check.status, age: ageValue }, ageValue, shirtSize };
  } catch (error) {
    if (error instanceof BadRequestException) throw new BadRequestException(`${label}：${error.message}`);
    throw error;
  }
}
export type PreparedPerson = ReturnType<typeof preparePerson>;
export function itemEligibility(type: string, own: PreparedPerson, partner: PreparedPerson | null, rule: AgeRule, version: number) {
  if (own.identity && partner?.identity && own.identity.fingerprint === partner.identity.fingerprint) throw new BadRequestException('本人和搭档不能使用同一身份证号');
  const gender = checkGender(type, own.gender, partner?.gender ?? null);
  const pending = own.age.status === 'PENDING' || partner?.age.status === 'PENDING' || gender === 'PENDING';
  return { status: pending ? 'PENDING' : 'PASSED', age: own.age.status, partnerAge: partner?.age.status ?? 'NOT_REQUIRED', gender,
    calculatedAge: own.age.age, partnerCalculatedAge: partner?.age.age ?? null, rule, ruleVersion: version };
}
export function identityView(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { masked: value.masked, birthDate: value.birthDate };
}
export function isPendingEligibility(value: Prisma.JsonValue | null | undefined) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && value.status === 'PENDING';
}
