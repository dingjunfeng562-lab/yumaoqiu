import { BadRequestException } from '@nestjs/common';
import { Gender, Prisma } from '@prisma/client';
import { AgeRule, ageForRule, checkAge, checkGender, checkReportedAge, Eligibility, GroupFields, parseIdentity } from './age-eligibility';
import { decryptIdentityNumber, encryptIdentityNumber, identityFingerprint, isIdentityCipher } from './identity-vault';

/**
 * 库里存的证件信息：哈希、出生日期、打码号码，以及完整号码的密文（2026-11-19 起，只供后台导出报名表解密）。
 * 不存身份证号原文。2026-11-19 之前的报名没有 encrypted。
 */
export type IdentityData = { fingerprint: string; birthDate: string; masked: string; encrypted?: string };
export type PersonInput = { identityNumber?: string; gender?: string | null; age?: number | string | null; shirtSize?: string | null };
export const SHIRT_SIZE_MAX_LENGTH = 32;

/** 读取库里已存的证件信息（哈希、出生日期、打码号码、本版本的密文；旧数据里多出的字段一律丢弃）。 */
export function storedIdentity(value: Prisma.JsonValue | null | undefined): IdentityData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { fingerprint, birthDate, masked, encrypted } = value;
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) return null;
  if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || typeof masked !== 'string') return null;
  return isIdentityCipher(encrypted) ? { fingerprint, birthDate, masked, encrypted } : { fingerprint, birthDate, masked };
}

/**
 * 后台导出报名表用：能解密就给完整身份证号，解不开（2026-11-19 之前的报名、密钥不对）就给打码号码。
 * 只能用在导出里，接口响应仍然只给 identityView（打码号码 + 出生日期）。
 */
export function identityForExport(value: Prisma.JsonValue | null | undefined): { number: string; birthDate: string } | null {
  const identity = storedIdentity(value);
  if (!identity) return null;
  let number: string | null = null;
  try {
    number = identity.encrypted ? decryptIdentityNumber(identity.encrypted, identity.fingerprint) : null;
  } catch {
    number = null;
  }
  return { number: number ?? identity.masked, birthDate: identity.birthDate };
}

/**
 * @param stored 库里已存的证件信息。只有调用方没有提交身份证号（undefined）时才沿用，
 *   显式空字符串表示清空。只能由服务端传入，不能来自客户端请求体。
 * @param lenient 管理员后台批量导入：报名字段不强制（选手自己报名照旧严格）。必填的身份证号、性别没填照常导入；
 *   身份证号无效时不保存；年龄不符本组条件也照常导入。核对不了的资格记为待核验，
 *   再由 itemEligibility(skipReview) 记为未核验放行。性别与项目不符等明确错误照常拦下。
 */
export function preparePerson(input: PersonInput, fields: GroupFields, ageRule: AgeRule, label = '本人', stored?: Prisma.JsonValue | null, lenient = false) {
  const number = fields.identityNumber === 'hidden' ? '' : input.identityNumber?.trim() ?? '';
  const kept = fields.identityNumber !== 'hidden' && input.identityNumber === undefined ? storedIdentity(stored) : null;
  if (!number && !kept && fields.identityNumber === 'required' && !lenient) throw new BadRequestException(`请填写${label}身份证号`);
  const value = fields.gender === 'hidden' ? '' : input.gender;
  if (!value && fields.gender === 'required' && !lenient) throw new BadRequestException(`请填写${label}性别`);
  let gender: Gender | null = null;
  if (value) {
    if (!['MALE', 'FEMALE', '男', '女'].includes(value)) throw new BadRequestException(`${label}性别填写有误`);
    gender = value === 'MALE' || value === '男' ? 'MALE' : 'FEMALE';
  }
  let identity: IdentityData | null = kept;
  if (number) {
    try {
      const parsed = parseIdentity(number);
      const fingerprint = identityFingerprint(parsed.normalized);
      identity = { fingerprint, birthDate: parsed.birthDate, masked: parsed.masked, encrypted: encryptIdentityNumber(parsed.normalized, fingerprint) };
    } catch (error) {
      // 后台批量导入：号码无效就不保存，按没填处理。
      if (!lenient || !(error instanceof BadRequestException)) throw error;
    }
  }
  // 年龄：填了身份证号就按身份证自动算（以身份证为准）；否则用报名人自填的年龄。
  const rawAge = fields.age === 'hidden' || input.age === '' ? null : input.age ?? null;
  let reported = rawAge == null ? null : Number(rawAge);
  if (reported != null && (!Number.isInteger(reported) || reported < 0 || reported > 150)) {
    if (!lenient) throw new BadRequestException(`${label}年龄须为0至150的整数`);
    reported = null;
  }
  // 衣服尺寸由报名人自己填写，不限定选项。
  const shirtSize = fields.shirtSize === 'hidden' ? null : input.shirtSize?.trim() || null;
  if (shirtSize && shirtSize.length > SHIRT_SIZE_MAX_LENGTH) throw new BadRequestException(`${label}衣服尺寸不超过${SHIRT_SIZE_MAX_LENGTH}个字`);
  const ageValue = identity ? ageForRule(ageRule, identity.birthDate) : reported;
  try {
    const check = identity ? checkAge(ageRule, identity.birthDate) : reported != null ? checkReportedAge(ageRule, reported) : checkAge(ageRule, null);
    return { gender, identity, age: { status: check.status, age: ageValue }, ageValue, shirtSize };
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    // 后台批量导入：年龄不符本组条件也照常导入，资格记为待核验（批量导入时再记为未核验）。
    if (lenient) return { gender, identity, age: { status: 'PENDING' as Eligibility, age: ageValue }, ageValue, shirtSize };
    throw new BadRequestException(`${label}：${error.message}`);
  }
}
export type PreparedPerson = ReturnType<typeof preparePerson>;
/**
 * @param skipReview 赛事免审核时传 true：系统核对不了的项（没填性别、只填年龄没填身份证等）不再转人工核验，
 *   记为 UNVERIFIED（未核验）直接放行。明确不符合（性别与项目不符、超出本组年龄范围）照常报错拦下。
 */
export function itemEligibility(type: string, own: PreparedPerson, partner: PreparedPerson | null, rule: AgeRule, version: number, skipReview = false) {
  if (own.identity && partner?.identity && own.identity.fingerprint === partner.identity.fingerprint) throw new BadRequestException('本人和搭档不能使用同一身份证号');
  const gender = checkGender(type, own.gender, partner?.gender ?? null);
  const pending = own.age.status === 'PENDING' || partner?.age.status === 'PENDING' || gender === 'PENDING';
  return { status: pending ? (skipReview ? 'UNVERIFIED' : 'PENDING') : 'PASSED', age: own.age.status, partnerAge: partner?.age.status ?? 'NOT_REQUIRED', gender,
    calculatedAge: own.age.age, partnerCalculatedAge: partner?.age.age ?? null, rule, ruleVersion: version };
}
/** 整份报名的资格汇总：有待核验即待核验；免审核放行的记为未核验；其余为通过。 */
export function overallEligibilityStatus(statuses: Array<string | null | undefined>) {
  if (statuses.includes('PENDING')) return 'PENDING';
  return statuses.includes('UNVERIFIED') ? 'UNVERIFIED' : 'PASSED';
}
export function identityView(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { masked: value.masked, birthDate: value.birthDate };
}
export function isPendingEligibility(value: Prisma.JsonValue | null | undefined) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && value.status === 'PENDING';
}
