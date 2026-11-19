import { normalizeAgeRule, groupFields } from '../common/age-eligibility';
import { preparePerson } from '../common/registration-eligibility';
import { ExportsService } from './exports.service';

// 报名表导出：身份证号、邮箱列按组别报名字段追加在原 22 列之后；身份证号能解密就是完整号码。

function idFor(birth: string) {
  const prefix = `110101${birth.replaceAll('-', '')}001`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  return prefix + '10X98765432'[weights.reduce((s, w, i) => s + w * Number(prefix[i]), 0) % 11];
}

const BASE_HEADER_LENGTH = 22;

function identityOf(id: string) {
  return preparePerson({ identityNumber: id }, groupFields({ identityNumber: 'required' }), normalizeAgeRule({ mode: 'NONE' })).identity!;
}

function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r', eventId: 'e', studentId: null, createdAt: new Date('2026-11-19T00:00:00Z'), className: null, groupName: null, teamName: null,
    isSeed: false, seedRank: null,
    player1: { name: '张三', gender: 'MALE', affiliation: '一中', contact: '13800000000' },
    player2: null,
    identityData: null, partnerIdentityData: null,
    competitionRegistration: { school: '一中', identityData: null, guestEmail: null, user: null, eventItems: [] },
    ...overrides,
  };
}

function event(id: string, fieldRules: Record<string, string> | null, registrations: unknown[], type = 'MENS_SINGLES') {
  return { id, type, entrantType: 'SOCIAL', groupLabel: id, group: fieldRules ? { fieldRules } : null, registrations, matches: [] };
}

function sheet(events: unknown[]) {
  const service = new ExportsService({} as never);
  return (service as unknown as { registrationsWorksheet(t: unknown): { rows: unknown[][] } })
    .registrationsWorksheet({ name: '测试赛', startDate: new Date(), endDate: new Date(), events, teamCompetitions: [] }).rows;
}

describe('报名表导出：身份证号、邮箱列', () => {
  const old = process.env.REGISTRATION_IDENTITY_KEY;
  beforeEach(() => { process.env.REGISTRATION_IDENTITY_KEY = 'ab'.repeat(32); });
  afterAll(() => { if (old === undefined) delete process.env.REGISTRATION_IDENTITY_KEY; else process.env.REGISTRATION_IDENTITY_KEY = old; });

  it('组别收身份证号：原 22 列不变，后面加身份证号1/出生日期1/身份证号2/出生日期2/邮箱1，号码不打码', () => {
    const own = idFor('2012-05-06');
    const partner = idFor('2013-07-08');
    const ownIdentity = identityOf(own);
    const rows = sheet([
      event('A组', { identityNumber: 'required', email: 'optional' }, [
        registration({
          eventId: 'A组',
          player2: { name: '李四', gender: 'MALE', affiliation: '一中', contact: '13900000000' },
          identityData: ownIdentity,
          competitionRegistration: {
            school: '一中', identityData: ownIdentity, guestEmail: 'zs@example.com', user: null,
            eventItems: [{ eventId: 'A组', partnerStudentId: null, partnerIdentityData: identityOf(partner) }],
          },
        }),
      ], 'MENS_DOUBLES'),
    ]);
    expect(rows[0].slice(0, BASE_HEADER_LENGTH)).toContain('衣服尺寸2');
    expect(rows[0][BASE_HEADER_LENGTH - 1]).toBe('衣服尺寸2');
    expect(rows[0].slice(BASE_HEADER_LENGTH)).toEqual(['身份证号1', '出生日期1', '身份证号2', '出生日期2', '邮箱1']);
    // 搭档的证件信息在 Registration 上没有时，从报名申请的项目里取。
    expect(rows[1].slice(BASE_HEADER_LENGTH)).toEqual([own, '2012-05-06', partner, '2013-07-08', 'zs@example.com']);
    expect(rows[1][4]).toBe('张三');
  });

  it('老报名只有打码号码：导出打码号码；登录报名的邮箱用账号邮箱', () => {
    const identity = identityOf(idFor('2012-05-06'));
    const legacy = { fingerprint: identity.fingerprint, birthDate: identity.birthDate, masked: identity.masked };
    const rows = sheet([
      event('A组', { identityNumber: 'optional' }, [
        registration({ eventId: 'A组', identityData: legacy, competitionRegistration: { school: '一中', identityData: legacy, guestEmail: 'old@example.com', user: { email: 'me@example.com' }, eventItems: [] } }),
      ]),
    ]);
    expect(rows[1].slice(BASE_HEADER_LENGTH)).toEqual([identity.masked, '2012-05-06', '', '', 'me@example.com']);
  });

  it('两个组别设置不同：有一个组收就加列，不收的组那几格留空', () => {
    const own = idFor('2012-05-06');
    const rows = sheet([
      event('A组', { identityNumber: 'required', email: 'hidden' }, [registration({ id: 'a', eventId: 'A组', identityData: identityOf(own) })]),
      event('B组', { identityNumber: 'hidden', email: 'hidden' }, [registration({ id: 'b', eventId: 'B组', competitionRegistration: { school: '二中', identityData: null, guestEmail: 'b@example.com', user: null, eventItems: [] } })]),
    ]);
    expect(rows[0].slice(BASE_HEADER_LENGTH)).toEqual(['身份证号1', '出生日期1', '身份证号2', '出生日期2']);
    expect(rows[1].slice(BASE_HEADER_LENGTH)).toEqual([own, '2012-05-06', '', '']);
    expect(rows[2].slice(BASE_HEADER_LENGTH)).toEqual(['', '', '', '']);
  });

  it('所有组别都不收身份证号和邮箱：表头还是原来的 22 列', () => {
    const rows = sheet([event('A组', { identityNumber: 'hidden', email: 'hidden' }, [registration({ eventId: 'A组' })])]);
    expect(rows[0]).toHaveLength(BASE_HEADER_LENGTH);
    expect(rows[1]).toHaveLength(BASE_HEADER_LENGTH);
  });

  it('没有组别的老赛事：不收身份证号（与报名时一致），邮箱默认选填', () => {
    const rows = sheet([event('男单', null, [registration({ eventId: '男单', competitionRegistration: { school: '一中', identityData: null, guestEmail: 'x@example.com', user: null, eventItems: [] } })])]);
    expect(rows[0].slice(BASE_HEADER_LENGTH)).toEqual(['邮箱1']);
    expect(rows[1].slice(BASE_HEADER_LENGTH)).toEqual(['x@example.com']);
  });

  it('分组列：数字编号写「1组」并按 1、2、10 排（数据库按字符串会排成 1、10、2）；字母照旧写 A，B 在 AA 前', () => {
    const regs = (codes: Array<string | null>) => codes.map((code, i) => registration({ id: `r${i}`, eventId: 'e', groupName: code, player1: { name: `选手${code ?? '无'}`, gender: 'MALE', affiliation: '一中', contact: '1' } }));
    const groupCol = (rows: unknown[][]) => rows[0].indexOf('分组');
    let rows = sheet([event('e', { identityNumber: 'hidden', email: 'hidden' }, regs(['1', '10', '11', '2', null]))]);
    expect(rows.slice(1).map((row) => row[groupCol(rows)])).toEqual(['', '1组', '2组', '10组', '11组']);
    rows = sheet([event('e', { identityNumber: 'hidden', email: 'hidden' }, regs(['A', 'AA', 'B']))]);
    expect(rows.slice(1).map((row) => row[groupCol(rows)])).toEqual(['A', 'B', 'AA']);
  });
});
