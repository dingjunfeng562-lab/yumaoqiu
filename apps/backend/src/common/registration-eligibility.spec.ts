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

// 管理员后台批量导入：报名字段不强制（lenient），选手自己报名照旧严格。
describe('后台批量导入不强制报名字段', () => {
  // 证件号只存哈希，测试里给一个临时密钥。
  const savedKey = process.env.REGISTRATION_IDENTITY_KEY;
  beforeAll(() => { process.env.REGISTRATION_IDENTITY_KEY = 'ab'.repeat(32); });
  afterAll(() => {
    if (savedKey === undefined) delete process.env.REGISTRATION_IDENTITY_KEY;
    else process.env.REGISTRATION_IDENTITY_KEY = savedKey;
  });
  const withChecksum = (prefix: string) => {
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    return prefix + '10X98765432'[weights.reduce((sum, weight, i) => sum + weight * Number(prefix[i]), 0) % 11];
  };
  const kid = withChecksum('11010520150301001');
  const adult = withChecksum('11010519900307001');
  const badChecksum = kid.slice(0, 17) + (kid[17] === '0' ? '1' : '0');
  const primary = normalizeAgeRule({ mode: 'BIRTH_DATE', minDate: '2014-09-01', maxDate: '2020-08-31' });
  const strict = groupFields({ identityNumber: 'required', gender: 'required', age: 'hidden' });

  it('选手自己报名（默认）照旧严格', () => {
    expect(() => preparePerson({ gender: 'MALE' }, strict, primary)).toThrow('请填写本人身份证号');
    expect(() => preparePerson({ identityNumber: kid }, strict, primary)).toThrow('请填写本人性别');
    expect(() => preparePerson({ gender: 'MALE', identityNumber: badChecksum }, strict, primary)).toThrow('身份证号校验位有误');
    expect(() => preparePerson({ gender: 'MALE', identityNumber: adult }, strict, primary)).toThrow('不符合本组年龄条件');
  });

  it('必填的身份证号、性别没填：照常导入，资格未核验', () => {
    const own = preparePerson({}, strict, primary, '本人', null, true);
    expect(own.identity).toBeNull();
    expect(own.gender).toBeNull();
    expect(own.age.status).toBe('PENDING');
    expect(itemEligibility('MENS_SINGLES', own, null, primary, 1, true).status).toBe('UNVERIFIED');
  });

  it('身份证号无效：不保存，照常导入', () => {
    for (const number of [badChecksum, '1101052015', '110105201502300011']) {
      const own = preparePerson({ gender: 'MALE', identityNumber: number }, strict, primary, '本人', null, true);
      expect(own.identity).toBeNull();
      expect(own.age.status).toBe('PENDING');
    }
  });

  it('年龄不符本组条件：保存证件信息，照常导入，资格未核验', () => {
    const own = preparePerson({ gender: 'MALE', identityNumber: adult }, strict, primary, '本人', null, true);
    expect(own.identity?.birthDate).toBe('1990-03-07');
    expect(own.identity?.masked).toMatch(/^110\*+\d{3}[\dX]$/);
    expect(own.age.status).toBe('PENDING');
    expect(itemEligibility('MENS_SINGLES', own, null, primary, 1, true).status).toBe('UNVERIFIED');
  });

  it('号码有效且符合条件：照常通过核验', () => {
    const own = preparePerson({ gender: 'MALE', identityNumber: kid }, strict, primary, '本人', null, true);
    expect(own.identity?.birthDate).toBe('2015-03-01');
    expect(itemEligibility('MENS_SINGLES', own, null, primary, 1, true).status).toBe('PASSED');
  });

  it('明确的数据错误照常拦下', () => {
    const female = preparePerson({ gender: 'FEMALE' }, strict, primary, '本人', null, true);
    expect(() => itemEligibility('MENS_SINGLES', female, null, primary, 1, true)).toThrow('性别不符合所选项目要求');
    expect(() => preparePerson({ gender: '未知' }, strict, primary, '本人', null, true)).toThrow('性别填写有误');
    const own = preparePerson({ gender: 'MALE', identityNumber: kid }, strict, primary, '本人', null, true);
    const partner = preparePerson({ gender: 'MALE', identityNumber: kid }, strict, primary, '搭档', null, true);
    expect(() => itemEligibility('MENS_DOUBLES', own, partner, primary, 1, true)).toThrow('本人和搭档不能使用同一身份证号');
  });

  it('不收集的身份证号照旧忽略', () => {
    const own = preparePerson({ gender: 'MALE', identityNumber: kid }, groupFields({ identityNumber: 'hidden', gender: 'required' }), primary, '本人', null, true);
    expect(own.identity).toBeNull();
  });
});
