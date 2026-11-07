import { BadRequestException } from '@nestjs/common';
import { EntrantType, EventType, RegistrationStatus } from '@prisma/client';
import { createSchoolResolver, normalizeSchoolName, suggestSchoolMerges } from './school-name';
import { buildTournamentStatistics, type StatsInput } from './statistics.builder';
import { StatisticsService } from './statistics.service';

const p = (name: string, affiliation: string | null) => ({ name, affiliation });
const approved = (player1: ReturnType<typeof p>, player2: ReturnType<typeof p> | null = null, status: RegistrationStatus | null = null) => ({
  player1,
  player2,
  competitionRegistrationStatus: status,
});
const input = (partial: Partial<StatsInput>): StatsInput => ({
  events: [],
  teamCompetitions: [],
  pendingByEntrantType: {},
  aliases: [],
  ...partial,
});

describe('学校名称规范化', () => {
  it('去空白、全角转半角、去掉校区括号，保留校名里的括号', () => {
    expect(normalizeSchoolName(' 重庆 大学 ')).toBe('重庆大学');
    expect(normalizeSchoolName('重庆大学（虎溪校区）')).toBe('重庆大学');
    expect(normalizeSchoolName('中国石油大学（华东）')).toBe('中国石油大学(华东)');
  });

  it('占位写法当作未填写', () => {
    expect(normalizeSchoolName('未填写学校')).toBe('');
    expect(normalizeSchoolName('  ')).toBe('');
    expect(normalizeSchoolName(null)).toBe('');
  });

  it('别名可以连环解析，遇到环不会死循环', () => {
    const resolve = createSchoolResolver([
      { alias: '应用职业', canonical: '应用技术职业学院', ignored: false },
      { alias: '应用技术职业学院', canonical: '重庆应用技术职业学院', ignored: false },
      { alias: '甲', canonical: '乙', ignored: false },
      { alias: '乙', canonical: '甲', ignored: false },
      { alias: '高', canonical: null, ignored: true },
    ]);
    expect(resolve('应用职业')).toEqual({ kind: 'school', normalized: '应用职业', canonical: '重庆应用技术职业学院' });
    expect(resolve('甲').kind).toBe('school');
    expect(resolve('高')).toEqual({ kind: 'ignored', normalized: '高' });
    expect(resolve('')).toEqual({ kind: 'empty' });
  });

  it('按字序包含时提示疑似重复，太短的写法不提示', () => {
    const suggestions = suggestSchoolMerges([
      { name: '重庆应用技术职业学院', people: 30 },
      { name: '应用职业', people: 2 },
      { name: '重庆应用', people: 1 },
      { name: '高', people: 3 },
      { name: '重庆大学', people: 8 },
    ]);
    expect(suggestions).toEqual([
      { name: '应用职业', people: 2, candidates: ['重庆应用技术职业学院'] },
      { name: '重庆应用', people: 1, candidates: ['重庆应用技术职业学院'] },
    ]);
  });

  it('完整校名只在另一个校名多了前缀时提示，不把不同的大学当成重复', () => {
    const suggestions = suggestSchoolMerges([
      { name: '重庆大学', people: 20 },
      { name: '重庆工商大学', people: 14 },
      { name: '重庆交通大学', people: 14 },
      { name: '西南大学', people: 14 },
      { name: '西南政法大学', people: 6 },
      { name: '重庆应用技术职业学院', people: 30 },
      { name: '应用技术职业学院', people: 1 },
    ]);
    expect(suggestions).toEqual([
      { name: '应用技术职业学院', people: 1, candidates: ['重庆应用技术职业学院'] },
    ]);
  });
});

describe('赛事统计口径', () => {
  it('按人去重：兼项只算 1 人，各组别里各算 1 次；双打两人都算并给出对数', () => {
    const [school] = buildTournamentStatistics(input({
      events: [
        { type: EventType.MENS_SINGLES, entrantType: EntrantType.SCHOOL, registrations: [approved(p('张三', '重庆大学')), approved(p('李四', '西南大学'))] },
        { type: EventType.MENS_DOUBLES, entrantType: EntrantType.SCHOOL, registrations: [approved(p('张三', '重庆大学'), p('王五', '重庆大学'))] },
        { type: EventType.WOMENS_SINGLES, entrantType: EntrantType.SCHOOL, registrations: [] },
      ],
    }));
    expect(school.people).toBe(3);
    expect(school.events).toEqual([
      { key: 'MENS_SINGLES', label: '男子单打', people: 2, pairs: null, teams: null },
      { key: 'WOMENS_SINGLES', label: '女子单打', people: 0, pairs: null, teams: null },
      { key: 'MENS_DOUBLES', label: '男子双打', people: 2, pairs: 1, teams: null },
    ]);
    expect(school.schools?.count).toBe(2);
    expect(school.schools?.top).toEqual([{ name: '重庆大学', people: 2, variants: [] }]);
  });

  it('报名表已驳回/移除的不算；待审核的单独计数', () => {
    const [school] = buildTournamentStatistics(input({
      events: [{
        type: EventType.MENS_SINGLES,
        entrantType: EntrantType.SCHOOL,
        registrations: [
          approved(p('张三', '重庆大学'), null, RegistrationStatus.APPROVED),
          approved(p('李四', '重庆大学'), null, RegistrationStatus.REMOVED),
        ],
      }],
      pendingByEntrantType: { SCHOOL: 4 },
    }));
    expect(school.people).toBe(1);
    expect(school.pendingRegistrations).toBe(4);
  });

  it('团体赛队员计入，学校按队伍单位算；同一人兼报单项不重复', () => {
    const [school] = buildTournamentStatistics(input({
      events: [{ type: EventType.MENS_SINGLES, entrantType: EntrantType.SCHOOL, registrations: [approved(p('张三', '重庆大学'))] }],
      teamCompetitions: [{
        entrantType: EntrantType.SCHOOL,
        teams: [
          { affiliation: '重庆大学', members: [p('张三', '重大'), p('赵六', null)] },
          { affiliation: '', members: [p('孙七', '西南大学')] },
        ],
      }],
    }));
    expect(school.people).toBe(3);
    expect(school.events.at(-1)).toEqual({ key: 'TEAM', label: '团体赛', people: 3, pairs: null, teams: 2 });
    expect(school.schools?.ranking.map((item) => [item.name, item.people])).toEqual([['重庆大学', 2], ['西南大学', 1]]);
  });

  it('别名归并进标准校名并列出写法；无效写法、未填写不计入高校数；并列第一全部列出', () => {
    const [school] = buildTournamentStatistics(input({
      events: [{
        type: EventType.MENS_SINGLES,
        entrantType: EntrantType.SCHOOL,
        registrations: [
          approved(p('甲', '重庆应用技术职业学院')),
          approved(p('乙', '应用职业')),
          approved(p('丙', '重庆大学')),
          approved(p('丁', '重庆大学')),
          approved(p('戊', '高')),
          approved(p('己', '未填写学校')),
        ],
      }],
      aliases: [
        { alias: '应用职业', canonical: '重庆应用技术职业学院', ignored: false },
        { alias: '高', canonical: null, ignored: true },
      ],
    }));
    const schools = school.schools!;
    expect(school.people).toBe(6);
    expect(schools.count).toBe(2);
    expect(schools.top.map((item) => item.name)).toEqual(['重庆大学', '重庆应用技术职业学院']);
    expect(schools.ranking.find((item) => item.name === '重庆应用技术职业学院')?.variants).toEqual([{ name: '应用职业', people: 1 }]);
    expect(schools.ignored).toEqual([{ name: '高', people: 1 }]);
    expect(schools.unspecifiedPeople).toBe(1);
  });

  it('第三方组别不统计高校；没有项目也没有团体赛的组不返回', () => {
    const groups = buildTournamentStatistics(input({
      events: [{ type: EventType.MIXED_DOUBLES, entrantType: EntrantType.SOCIAL, registrations: [approved(p('甲', '俱乐部A'), p('乙', '俱乐部A'))] }],
    }));
    expect(groups.map((group) => group.entrantType)).toEqual(['SOCIAL']);
    expect(groups[0]).toMatchObject({ label: '第三方', people: 2, schools: null });
    expect(groups[0].events).toEqual([{ key: 'MIXED_DOUBLES', label: '混合双打', people: 2, pairs: 1, teams: null }]);
  });
});

describe('学校名称归并保存', () => {
  function setup(existing: Array<{ alias: string; canonical: string | null; ignored: boolean }>) {
    const schoolAlias = {
      findMany: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn((args: unknown) => ({ op: 'upsert', args })),
      deleteMany: jest.fn((args: unknown) => ({ op: 'deleteMany', args })),
      updateMany: jest.fn((args: unknown) => ({ op: 'updateMany', args })),
    };
    const prisma = { schoolAlias, $transaction: jest.fn().mockResolvedValue([]) };
    return { service: new StatisticsService(prisma as never), schoolAlias, prisma };
  }

  it('目标校名本身是别名时，归并到它最终指向的校名，并改指原来指向这些写法的别名', async () => {
    const { service, schoolAlias } = setup([{ alias: '重庆应用', canonical: '重庆应用技术职业学院', ignored: false }]);
    await service.saveSchoolAliases({ names: ['应用职业', ' 应用职业 '], canonical: '重庆应用' }, 'root');
    expect(schoolAlias.upsert).toHaveBeenCalledTimes(1);
    const [upsert] = schoolAlias.upsert.mock.calls[0] as [{ where: { alias: string }; create: { canonical: string; ignored: boolean } }];
    expect(upsert.where).toEqual({ alias: '应用职业' });
    expect(upsert.create).toMatchObject({ canonical: '重庆应用技术职业学院', ignored: false });
    expect(schoolAlias.deleteMany).toHaveBeenCalledWith({ where: { alias: '重庆应用技术职业学院' } });
    expect(schoolAlias.updateMany).toHaveBeenCalledWith({
      where: { canonical: { in: ['应用职业'] } },
      data: { canonical: '重庆应用技术职业学院', updatedBy: 'root' },
    });
  });

  it('写法和标准校名相同、或目标已被标为无效时拒绝', async () => {
    const { service } = setup([{ alias: '高', canonical: null, ignored: true }]);
    await expect(service.saveSchoolAliases({ names: ['重庆大学'], canonical: '重庆 大学' }, null)).rejects.toThrow(BadRequestException);
    await expect(service.saveSchoolAliases({ names: ['重大'], canonical: '高' }, null)).rejects.toThrow('已被标记为无效');
  });

  it('标记为无效时不需要标准校名', async () => {
    const { service, schoolAlias } = setup([]);
    await service.saveSchoolAliases({ names: ['高', '中华人民共和国'], ignored: true }, 'root');
    expect(schoolAlias.upsert).toHaveBeenCalledTimes(2);
    expect(schoolAlias.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { alias: '高' },
      update: { canonical: null, ignored: true, updatedBy: 'root' },
    }));
  });
});
