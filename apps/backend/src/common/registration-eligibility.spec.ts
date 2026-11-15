import { groupFields, normalizeAgeRule } from './age-eligibility';
import { itemEligibility, overallEligibilityStatus, preparePerson } from './registration-eligibility';

// 免审核赛事：系统核对不了的资格不转人工（UNVERIFIED 放行），明确不符合的照常拦下。
describe('免审核时的资格判断', () => {
  const noRule = normalizeAgeRule({ mode: 'NONE' });
  const u12 = normalizeAgeRule({ mode: 'AGE', maxAge: 12, cutoffDate: '2026-11-15' });
  const genderHidden = groupFields({ identityNumber: 'hidden', gender: 'hidden', age: 'hidden' });
  const ageOnly = groupFields({ identityNumber: 'hidden', gender: 'required', age: 'required' });

  it('组别不收集性别：开审核时待核验，免审核时未核验放行', () => {
    const own = preparePerson({ gender: 'MALE' }, genderHidden, noRule);
    expect(own.gender).toBeNull();
    expect(itemEligibility('MENS_SINGLES', own, null, noRule, 1).status).toBe('PENDING');
    expect(itemEligibility('MENS_SINGLES', own, null, noRule, 1, true).status).toBe('UNVERIFIED');
  });

  it('双打搭档没填性别：免审核时未核验放行', () => {
    const fields = groupFields({ gender: 'optional' });
    const own = preparePerson({ gender: 'MALE' }, fields, noRule);
    const partner = preparePerson({}, fields, noRule, '搭档');
    expect(itemEligibility('MIXED_DOUBLES', own, partner, noRule, 1).status).toBe('PENDING');
    expect(itemEligibility('MIXED_DOUBLES', own, partner, noRule, 1, true).status).toBe('UNVERIFIED');
  });

  it('有年龄规则但只填年龄：免审核时未核验放行', () => {
    const own = preparePerson({ gender: 'FEMALE', age: 10 }, ageOnly, u12);
    expect(own.age.status).toBe('PENDING');
    expect(itemEligibility('WOMENS_SINGLES', own, null, u12, 1).status).toBe('PENDING');
    expect(itemEligibility('WOMENS_SINGLES', own, null, u12, 1, true).status).toBe('UNVERIFIED');
  });

  it('资料齐全时不论是否审核都是通过', () => {
    const own = preparePerson({ gender: 'FEMALE' }, groupFields({ gender: 'required' }), noRule);
    expect(itemEligibility('WOMENS_SINGLES', own, null, noRule, 1).status).toBe('PASSED');
    expect(itemEligibility('WOMENS_SINGLES', own, null, noRule, 1, true).status).toBe('PASSED');
  });

  it('明确不符合的免审核也照常拦下', () => {
    const fields = groupFields({ gender: 'required' });
    const female = preparePerson({ gender: 'FEMALE' }, fields, noRule);
    const male = preparePerson({ gender: 'MALE' }, fields, noRule, '搭档');
    expect(() => itemEligibility('MENS_SINGLES', female, null, noRule, 1, true)).toThrow('性别不符合所选项目要求');
    expect(() => itemEligibility('MENS_DOUBLES', male, female, noRule, 1, true)).toThrow('性别不符合所选项目要求');
    expect(() => itemEligibility('MIXED_DOUBLES', male, preparePerson({ gender: 'MALE' }, fields, noRule), noRule, 1, true)).toThrow('混合双打必须一男一女');
    expect(() => preparePerson({ gender: 'FEMALE', age: 13 }, ageOnly, u12)).toThrow('不符合本组年龄条件');
  });

  it('整份报名的资格汇总', () => {
    expect(overallEligibilityStatus(['PASSED', 'UNVERIFIED'])).toBe('UNVERIFIED');
    expect(overallEligibilityStatus(['UNVERIFIED', 'PENDING'])).toBe('PENDING');
    expect(overallEligibilityStatus(['MANUAL', undefined, null])).toBe('PASSED');
  });
});
