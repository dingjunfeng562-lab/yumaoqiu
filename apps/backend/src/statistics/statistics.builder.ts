import { EntrantType, EventType, RegistrationStatus } from '@prisma/client';
import {
  createSchoolResolver,
  normalizePersonName,
  suggestSchoolMerges,
  type MergeSuggestion,
  type SchoolAliasRule,
} from './school-name';

// 赛事统计的口径（与后台「赛事统计」页的说明一致）：
// - 只算已通过的报名（含管理员录入、Excel 导入的）；待审核的报名表单独计数。
// - 按人算：双打两人都算；同一个人兼报多个项目只算 1 人（姓名 + 学校相同视为同一人）。
// - 团体赛队员也计入，学校按队伍的单位算。
// - 各组别人数里，同一个人在每个报了的项目各算 1 次，所以加起来会大于该组报名人数。

export type StatsPlayer = { name: string; affiliation: string | null } | null;

export type StatsInput = {
  events: Array<{
    type: EventType;
    entrantType: EntrantType;
    groupId?: string | null;
    groupLabel?: string | null;
    registrations: Array<{
      player1: StatsPlayer;
      player2: StatsPlayer;
      /** 线上报名对应报名表的状态；管理员录入的为 null。 */
      competitionRegistrationStatus: RegistrationStatus | null;
    }>;
  }>;
  teamCompetitions: Array<{
    entrantType: EntrantType;
    groupId?: string | null;
    groupLabel?: string | null;
    teams: Array<{ affiliation: string | null; members: Array<{ name: string; affiliation: string | null }> }>;
  }>;
  pendingByGroupId?: Record<string, number>;
  pendingByEntrantType: Partial<Record<EntrantType, number>>;
  aliases: SchoolAliasRule[];
};

export type EventStat = {
  key: EventType | 'TEAM';
  label: string;
  people: number;
  /** 双打的对数；单打、团体为 null。 */
  pairs: number | null;
  /** 团体赛的队数；单项为 null。 */
  teams: number | null;
};

export type SchoolRankItem = {
  name: string;
  people: number;
  /** 归并进来的其他写法（不含标准校名本身）。 */
  variants: Array<{ name: string; people: number }>;
};

export type SchoolStats = {
  count: number;
  /** 人数最多的高校；并列第一时全部列出。 */
  top: SchoolRankItem[];
  ranking: SchoolRankItem[];
  /** 没填学校的人数（不计入高校数）。 */
  unspecifiedPeople: number;
  /** 被标记为无效的写法（不计入高校数）。 */
  ignored: Array<{ name: string; people: number }>;
  suggestions: MergeSuggestion[];
};

export type GroupStats = {
  groupId?: string;
  entrantType: EntrantType;
  label: string;
  people: number;
  pendingRegistrations: number;
  events: EventStat[];
  /** 只有学生组统计高校。 */
  schools: SchoolStats | null;
};

export const EVENT_LABELS: Record<EventType, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};
const EVENT_ORDER: EventType[] = ['MENS_SINGLES', 'WOMENS_SINGLES', 'MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES'];
const GROUP_LABELS: Record<EntrantType, string> = { SCHOOL: '学生组', SOCIAL: '第三方' };

const isDoubles = (type: EventType) => type.endsWith('_DOUBLES');
const byName = (a: string, b: string) => a.localeCompare(b, 'zh-CN');

type Person = { schoolKey: string; school: ReturnType<ReturnType<typeof createSchoolResolver>> };

export function buildTournamentStatistics(input: StatsInput): GroupStats[] {
  const resolveSchool = createSchoolResolver(input.aliases);
  let anonymous = 0;

  // 同一个人：规范化姓名 + 解析后的学校。没写姓名的每条单独算一个人。
  const identify = (name: string, affiliation: string | null): [string, Person] => {
    const school = resolveSchool(affiliation);
    const schoolKey = school.kind === 'school' ? school.canonical : school.kind === 'ignored' ? `#${school.normalized}` : '';
    const personName = normalizePersonName(name);
    const key = personName ? `${personName}|${schoolKey}` : `#anonymous-${anonymous++}`;
    return [key, { schoolKey, school }];
  };

  const groups: GroupStats[] = [];
  const groupsById = new Map([...input.events, ...input.teamCompetitions].map(item => [item.groupId || item.entrantType, item]));
  for (const [groupId, config] of groupsById) {
    const entrantType = config.entrantType;
    const events = input.events
      .filter((event) => (event.groupId || event.entrantType) === groupId)
      .sort((a, b) => EVENT_ORDER.indexOf(a.type) - EVENT_ORDER.indexOf(b.type));
    const teamCompetitions = input.teamCompetitions.filter((item) => (item.groupId || item.entrantType) === groupId);
    if (!events.length && !teamCompetitions.length) continue;

    const people = new Map<string, Person>();
    const eventStats: EventStat[] = [];

    for (const event of events) {
      const eventPeople = new Set<string>();
      let pairs = 0;
      for (const registration of event.registrations) {
        // 报名表已被驳回/移除但项目报名还挂着的，不算。
        if (registration.competitionRegistrationStatus && registration.competitionRegistrationStatus !== RegistrationStatus.APPROVED) continue;
        pairs += 1;
        for (const player of [registration.player1, registration.player2]) {
          if (!player) continue;
          const [key, person] = identify(player.name, player.affiliation);
          eventPeople.add(key);
          if (!people.has(key)) people.set(key, person);
        }
      }
      eventStats.push({
        key: event.type,
        label: EVENT_LABELS[event.type],
        people: eventPeople.size,
        pairs: isDoubles(event.type) ? pairs : null,
        teams: null,
      });
    }

    if (teamCompetitions.length) {
      const teamPeople = new Set<string>();
      let teamCount = 0;
      for (const competition of teamCompetitions) {
        for (const team of competition.teams) {
          teamCount += 1;
          for (const member of team.members) {
            const [key, person] = identify(member.name, team.affiliation?.trim() ? team.affiliation : member.affiliation);
            teamPeople.add(key);
            if (!people.has(key)) people.set(key, person);
          }
        }
      }
      eventStats.push({ key: 'TEAM', label: '团体赛', people: teamPeople.size, pairs: null, teams: teamCount });
    }

    groups.push({
      groupId,
      entrantType,
      label: config.groupLabel || GROUP_LABELS[entrantType],
      people: people.size,
      pendingRegistrations: config.groupId ? input.pendingByGroupId?.[groupId] ?? 0 : input.pendingByEntrantType[entrantType] ?? 0,
      events: eventStats,
      schools: entrantType === 'SCHOOL' ? buildSchoolStats([...people.values()]) : null,
    });
  }
  return groups;
}

function buildSchoolStats(people: Person[]): SchoolStats {
  const schools = new Map<string, { people: number; variants: Map<string, number> }>();
  const ignored = new Map<string, number>();
  let unspecifiedPeople = 0;

  for (const { school } of people) {
    if (school.kind === 'empty') {
      unspecifiedPeople += 1;
    } else if (school.kind === 'ignored') {
      ignored.set(school.normalized, (ignored.get(school.normalized) ?? 0) + 1);
    } else {
      const entry = schools.get(school.canonical) ?? { people: 0, variants: new Map<string, number>() };
      entry.people += 1;
      if (school.normalized !== school.canonical) {
        entry.variants.set(school.normalized, (entry.variants.get(school.normalized) ?? 0) + 1);
      }
      schools.set(school.canonical, entry);
    }
  }

  const ranking: SchoolRankItem[] = [...schools.entries()]
    .map(([name, entry]) => ({
      name,
      people: entry.people,
      variants: [...entry.variants.entries()]
        .map(([variant, count]) => ({ name: variant, people: count }))
        .sort((a, b) => b.people - a.people || byName(a.name, b.name)),
    }))
    .sort((a, b) => b.people - a.people || byName(a.name, b.name));
  const maxPeople = ranking[0]?.people ?? 0;

  return {
    count: ranking.length,
    top: maxPeople ? ranking.filter((item) => item.people === maxPeople) : [],
    ranking,
    unspecifiedPeople,
    ignored: [...ignored.entries()]
      .map(([name, count]) => ({ name, people: count }))
      .sort((a, b) => b.people - a.people || byName(a.name, b.name)),
    suggestions: suggestSchoolMerges(ranking),
  };
}
