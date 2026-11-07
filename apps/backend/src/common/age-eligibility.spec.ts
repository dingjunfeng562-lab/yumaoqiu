import { ageForRule, ageOn, ageRuleLabel, birthRangeFromAges, checkAge, checkGender, checkReportedAge, cnDate, groupFields, normalizeAgeRule, parseIdentity } from './age-eligibility';
import { preparePerson } from './registration-eligibility';
import { decryptIdentity, encryptIdentity, identityFingerprint } from './identity-vault';
import { stripIdentityStorage } from './identity-response.interceptor';

function idFor(birth: string) {
  const prefix = `110101${birth.replaceAll('-', '')}001`;
  const weights = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
  return prefix + '10X98765432'[weights.reduce((s,w,i)=>s+w*Number(prefix[i]),0)%11];
}
describe('自定义组别资格规则', () => {
  const range = normalizeAgeRule({ mode: 'AGE', minAge: 7, maxAge: 10, cutoffDate: '2026-11-06' });
  it.each([['2019-11-06',7],['2015-11-07',10]])('接受边界出生日期%s', (date, age) => expect(checkAge(range,date)).toEqual({status:'PASSED',age}));
  it.each(['2019-11-07','2015-11-06'])('拒绝范围之外%s', date => expect(()=>checkAge(range,date)).toThrow('不符合'));
  it('未满8周岁在8岁生日当天不通过', () => expect(()=>checkAge(normalizeAgeRule({mode:'AGE',maxAge:8,maxInclusive:false,cutoffDate:'2026-11-06'}),'2018-11-06')).toThrow());
  it('出生年份组不受是否已过生日影响', () => {
    const r=normalizeAgeRule({mode:'BIRTH_DATE',minDate:'2018-01-01',maxDate:'2018-12-31'});
    expect(checkAge(r,'2018-12-31').status).toBe('PASSED');
    expect(()=>checkAge(r,'2019-01-01')).toThrow();
  });
  it('闰日按3月1日达到新周岁',()=>{expect(ageOn('2020-02-29','2027-02-28')).toBe(6);expect(ageOn('2020-02-29','2027-03-01')).toBe(7);});
  it('拒绝空区间、非法日期和非法边界',()=>{
    for (const r of [{mode:'AGE',minAge:8,maxAge:8,minInclusive:false,cutoffDate:'2026-11-06'},{mode:'BIRTH_DATE',minDate:'2025-02-29'},{mode:'AGE',maxAge:18,cutoffDate:'2026-11-06',maxInclusive:'false'}]) expect(()=>normalizeAgeRule(r)).toThrow();
  });
  it('选填缺失保留未知，不伪造通过',()=>{
    const p=preparePerson({},groupFields({}),range);
    expect(p.gender).toBeNull();expect(p.identity).toBeNull();expect(p.age.status).toBe('PENDING');
    expect(checkGender('MIXED_DOUBLES','MALE',null)).toBe('PENDING');
  });
  it('必填缺失拒绝，不收集时忽略客户端传值',()=>{
    expect(()=>preparePerson({},groupFields({identityNumber:'required'}),range)).toThrow('身份证');
    const p=preparePerson({identityNumber:'invalid',gender:'MALE'},groupFields({identityNumber:'hidden',gender:'hidden'}),range);
    expect(p.gender).toBeNull();expect(p.identity).toBeNull();
  });
  it('已知的错误性别不因另一方留空而通过',()=>{
    expect(()=>checkGender('WOMENS_DOUBLES',null,'MALE')).toThrow();
    expect(()=>checkGender('MIXED_DOUBLES','FEMALE','FEMALE')).toThrow();
  });
  it('身份证拒绝无效日期、未来生日、损坏校验位',()=>{
    expect(parseIdentity('11010519491231002x','2026-11-06').birthDate).toBe('1949-12-31');
    for (const id of [idFor('2025-02-29'),idFor('2027-01-01'),'110105194912310020']) expect(()=>parseIdentity(id,'2026-11-06')).toThrow();
  });
  it('证件加密带认证和随机nonce，指纹稳定',()=>{
    const old=process.env.REGISTRATION_IDENTITY_KEY;
    try { process.env.REGISTRATION_IDENTITY_KEY='ab'.repeat(32);
      const id=idFor('2018-01-01');const a=encryptIdentity(id),b=encryptIdentity(id);
      expect(a).not.toContain(id);expect(a).not.toEqual(b);expect(decryptIdentity(a)).toBe(id);
      expect(identityFingerprint(id)).toBe(identityFingerprint(id));
      const parts=a.split('.');parts[2]=Buffer.alloc(16).toString('base64');expect(()=>decryptIdentity(parts.join('.'))).toThrow();
    } finally { if(old===undefined) delete process.env.REGISTRATION_IDENTITY_KEY; else process.env.REGISTRATION_IDENTITY_KEY=old; }
  });
  it('所有层级的响应均不泄露证件存储数据',()=>expect(stripIdentityStorage({id:'1',identityData:{encrypted:'secret'},members:[{personKey:'key',partnerIdentityData:{fingerprint:'hash'},name:'测试'}]})).toEqual({id:'1',members:[{name:'测试'}]}));
});

describe('按年龄填写，自动推算出生日期', () => {
  it('按出生年份：8～10岁、2026年 → 2016年1月1日至2018年12月31日', () => {
    expect(birthRangeFromAges({ basis: 'YEAR', minAge: 8, maxAge: 10, refDate: '2026-11-26' })).toEqual({ minDate: '2016-01-01', maxDate: '2018-12-31' });
  });
  it('U8 = 未满9岁：按出生年份只设下限出生日期', () => {
    expect(birthRangeFromAges({ basis: 'YEAR', maxAge: 8, refDate: '2026-11-26' })).toEqual({ minDate: '2018-01-01' });
  });
  it('按周岁：以2026年11月26日为准8～10周岁 → 2015年11月27日至2018年11月26日', () => {
    const range = birthRangeFromAges({ basis: 'AGE', minAge: 8, maxAge: 10, refDate: '2026-11-26' });
    expect(range).toEqual({ minDate: '2015-11-27', maxDate: '2018-11-26' });
    expect(ageOn(range.minDate!, '2026-11-26')).toBe(10);
    expect(ageOn('2015-11-26', '2026-11-26')).toBe(11);
    expect(ageOn(range.maxDate!, '2026-11-26')).toBe(8);
  });
  it('按周岁且参照日是2月29日：边界与闰日规则一致', () => {
    const range = birthRangeFromAges({ basis: 'AGE', minAge: 8, maxAge: 10, refDate: '2028-02-29' });
    expect(range).toEqual({ minDate: '2017-03-01', maxDate: '2020-02-29' });
    expect(ageOn('2017-02-28', '2028-02-29')).toBe(11);
    expect(ageOn('2017-03-01', '2028-02-29')).toBe(10);
  });
  it('保存时由服务端换算日期，忽略前端传来的日期', () => {
    const rule = normalizeAgeRule({ mode: 'BIRTH_DATE', minDate: '1900-01-01', ageInput: { basis: 'YEAR', maxAge: 8, refDate: '2026-11-26' } });
    expect(rule).toEqual({ mode: 'BIRTH_DATE', minInclusive: true, maxInclusive: true, minDate: '2018-01-01', ageInput: { basis: 'YEAR', maxAge: 8, refDate: '2026-11-26' } });
    expect(() => checkAge(rule, '2017-12-31')).toThrow('不符合');
    expect(checkAge(rule, '2018-01-01').status).toBe('PASSED');
  });
  it('拒绝无效的年龄输入', () => {
    for (const ageInput of [{ basis: 'YEAR', refDate: '2026-11-26' }, { basis: 'YEAR', minAge: 10, maxAge: 8, refDate: '2026-11-26' }, { basis: 'X', maxAge: 8, refDate: '2026-11-26' }, { basis: 'AGE', maxAge: 8, refDate: '2026-02-30' }, { basis: 'YEAR', maxAge: 8.5, refDate: '2026-11-26' }]) {
      expect(() => normalizeAgeRule({ mode: 'BIRTH_DATE', ageInput })).toThrow();
    }
  });
  it('规则说明全部用中文日期', () => {
    expect(cnDate('2018-01-01')).toBe('2018年1月1日');
    expect(ageRuleLabel(normalizeAgeRule({ mode: 'BIRTH_DATE', ageInput: { basis: 'YEAR', maxAge: 8, refDate: '2026-11-26' } }))).toBe('8岁及以下（按出生年份，2018年1月1日及以后出生）');
    expect(ageRuleLabel(normalizeAgeRule({ mode: 'BIRTH_DATE', ageInput: { basis: 'AGE', minAge: 8, maxAge: 10, refDate: '2026-11-26' } }))).toBe('8～10周岁（以2026年11月26日为准，2015年11月27日至2018年11月26日出生）');
    expect(ageRuleLabel(normalizeAgeRule({ mode: 'BIRTH_DATE', minDate: '2016-01-01', maxDate: '2018-12-31' }))).toBe('2016年1月1日至2018年12月31日出生');
    expect(ageRuleLabel(normalizeAgeRule({ mode: 'AGE', minAge: 7, maxAge: 10, cutoffDate: '2026-11-06' }))).toBe('以2026年11月6日为准，7～10周岁');
  });
  it('按规则口径算年龄：出生年份 / 周岁', () => {
    expect(ageForRule(normalizeAgeRule({ mode: 'BIRTH_DATE', ageInput: { basis: 'YEAR', maxAge: 8, refDate: '2026-11-26' } }), '2018-12-31')).toBe(8);
    expect(ageForRule(normalizeAgeRule({ mode: 'BIRTH_DATE', ageInput: { basis: 'AGE', maxAge: 8, refDate: '2026-11-26' } }), '2018-12-31')).toBe(7);
  });
  it('只填年龄：超出范围拒绝，范围内待核验', () => {
    const rule = normalizeAgeRule({ mode: 'BIRTH_DATE', ageInput: { basis: 'YEAR', minAge: 8, maxAge: 10, refDate: '2026-11-26' } });
    expect(() => checkReportedAge(rule, 11)).toThrow('填写的年龄为11岁');
    expect(() => checkReportedAge(rule, 7)).toThrow();
    expect(checkReportedAge(rule, 9)).toEqual({ status: 'PENDING', age: 9 });
    expect(checkReportedAge({ mode: 'NONE' }, 30).status).toBe('NOT_REQUIRED');
  });
  it('报名：身份证优先自动算年龄，没身份证用自填年龄；衣服尺寸手填', () => {
    // 带身份证号的报名要加密证件号，测试里临时给一个密钥。
    const old = process.env.REGISTRATION_IDENTITY_KEY;
    process.env.REGISTRATION_IDENTITY_KEY = 'a'.repeat(64);
    try {
    const fields = groupFields({ age: 'required', shirtSize: 'optional', identityNumber: 'optional' });
    const rule = normalizeAgeRule({ mode: 'BIRTH_DATE', ageInput: { basis: 'YEAR', maxAge: 8, refDate: '2026-11-26' } });
    const byId = preparePerson({ identityNumber: idFor('2019-05-01'), age: 99, shirtSize: ' 130 ' }, fields, rule);
    expect(byId.ageValue).toBe(7);
    expect(byId.age.status).toBe('PASSED');
    expect(byId.shirtSize).toBe('130');
    const reported = preparePerson({ age: 8 }, fields, rule);
    expect(reported.ageValue).toBe(8);
    expect(reported.age.status).toBe('PENDING');
    expect(() => preparePerson({ age: 9 }, fields, rule)).toThrow('不符合');
    expect(() => preparePerson({ age: 8.5 }, fields, rule)).toThrow('整数');
    expect(preparePerson({ age: 8, shirtSize: 'M' }, groupFields({}), rule)).toMatchObject({ ageValue: null, shirtSize: null });
    } finally {
      if (old === undefined) delete process.env.REGISTRATION_IDENTITY_KEY; else process.env.REGISTRATION_IDENTITY_KEY = old;
    }
  });
  it('新字段默认不收集，老组别不会多出必填项', () => {
    expect(groupFields({})).toMatchObject({ age: 'hidden', shirtSize: 'hidden' });
  });
});
