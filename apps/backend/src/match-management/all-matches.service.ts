import { Injectable } from '@nestjs/common';
import { Prisma, TournamentStatus } from '@prisma/client';
import { AuthActor, tournamentScope } from '../auth/admin-scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  type AllMatchTab,
  DEFAULT_ALL_MATCH_PAGE_SIZE,
  compareAllMatches,
  countAllMatchTabs,
  inAllMatchTab,
  pageOf,
  splitIds,
} from './all-matches';
import { ListAllMatchesQueryDto } from './dto/match-management.dto';
import { computeMatchCodes } from './match-codes';
import { MatchManagementService } from './match-management.service';

/** 项目名（搜「男单」「男子单打」都能搜到）。 */
const EVENT_TYPE_NAMES: Record<string, string[]> = {
  MENS_SINGLES: ['男子单打', '男单'],
  WOMENS_SINGLES: ['女子单打', '女单'],
  MENS_DOUBLES: ['男子双打', '男双'],
  WOMENS_DOUBLES: ['女子双打', '女双'],
  MIXED_DOUBLES: ['混合双打', '混双'],
};

const LIGHT_SELECT = {
  id: true,
  status: true,
  scheduledAt: true,
  finishedAt: true,
  venueId: true,
  refereeId: true,
  side1Id: true,
  side2Id: true,
  winnerSide: true,
  roundNo: true,
  matchNo: true,
  venue: { select: { sortOrder: true } },
} satisfies Prisma.MatchSelect;

/** 算场次号要的字段（和 computeMatchCodes 的 CodeMatch 对应）。 */
const CODE_SELECT = {
  id: true,
  eventId: true,
  teamMatchId: true,
  scheduledAt: true,
  venueId: true,
  venue: { select: { sortOrder: true } },
  matchNo: true,
  roundNo: true,
  teamMatch: { select: { teamCompetitionId: true } },
} satisfies Prisma.MatchSelect;

type ScopeEvent = {
  id: string;
  tournamentId: string;
  type: string;
  groupLabel: string | null;
  mixHostId: string | null;
};
type ScopeCompetition = { id: string; tournamentId: string; name: string };

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, '');

/**
 * 裁判员对局管理「全部场次」：不用先选赛事，列出能管的所有赛事的场次，分页返回。
 * 做法：先用轻量查询取出符合条件的全部场次（几千场很快），在内存里算各标签数量、排序、分页，
 * 再只把这一页的场次查完整（和赛事 overview 同一格式）并补上场次号、赛事名、项目名。
 */
@Injectable()
export class AllMatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matchManagement: MatchManagementService,
  ) {}

  async list(
    actor: AuthActor | undefined,
    query: ListAllMatchesQueryDto,
    now = Date.now(),
  ) {
    const tab: AllMatchTab = query.tab ?? 'ALL';
    const pageSize = query.pageSize ?? DEFAULT_ALL_MATCH_PAGE_SIZE;
    const activeOnly = query.activeOnly !== '0';
    const picked = splitIds(query.tournaments);

    const tournaments = await this.prisma.tournament.findMany({
      where: {
        ...tournamentScope(actor),
        ...(activeOnly
          ? { isArchived: false, status: { not: TournamentStatus.FINISHED } }
          : {}),
        ...(picked.length ? { id: { in: picked } } : {}),
      },
      select: { id: true, name: true },
    });
    const empty = {
      items: [],
      total: 0,
      page: 1,
      pageSize,
      counts: countAllMatchTabs([], now),
    };
    if (!tournaments.length) return empty;
    const tournamentIds = tournaments.map((tournament) => tournament.id);

    const [events, competitions] = await Promise.all([
      this.prisma.event.findMany({
        where: { tournamentId: { in: tournamentIds } },
        select: {
          id: true,
          tournamentId: true,
          type: true,
          groupLabel: true,
          mixHostId: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.teamCompetition.findMany({
        where: { tournamentId: { in: tournamentIds } },
        select: { id: true, tournamentId: true, name: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const scope = this.matchScope(
      events.map((event) => event.id),
      competitions.map((competition) => competition.id),
    );
    if (!scope) return empty;

    const and: Prisma.MatchWhereInput[] = [scope];
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if (from || to)
      and.push({
        scheduledAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lt: to } : {}),
        },
      });
    const keyword = (query.q ?? '').trim().slice(0, 50);
    if (keyword) {
      const conditions = await this.keywordConditions(
        keyword,
        tournaments,
        events,
        competitions,
      );
      if (!conditions.length) return empty;
      and.push({ OR: conditions });
    }

    const light = await this.prisma.match.findMany({
      where: { AND: and },
      select: LIGHT_SELECT,
    });
    const counts = countAllMatchTabs(light, now);
    const inTab = light
      .filter((match) => inAllMatchTab(match, tab, now))
      .sort(compareAllMatches);
    const { page, items: rows } = pageOf(inTab, query.page ?? 1, pageSize);
    const views = await this.matchManagement.matchViewsByIds(
      rows.map((row) => row.id),
    );

    const tournamentName = new Map(
      tournaments.map((tournament) => [tournament.id, tournament.name]),
    );
    const eventById = new Map(events.map((event) => [event.id, event]));
    const competitionById = new Map(
      competitions.map((competition) => [competition.id, competition]),
    );
    const tournamentOf = (view: {
      eventId: string | null;
      teamCompetitionId: string | null;
    }) =>
      (view.eventId ? eventById.get(view.eventId)?.tournamentId : null) ??
      (view.teamCompetitionId
        ? competitionById.get(view.teamCompetitionId)?.tournamentId
        : null) ??
      null;
    const codes = await this.codesFor(
      new Set(
        views.map(tournamentOf).filter((id): id is string => Boolean(id)),
      ),
      events,
      competitions,
    );

    const items = views.map((view) => {
      const tournamentId = tournamentOf(view);
      const event = view.eventId ? eventById.get(view.eventId) : null;
      const competition = view.teamCompetitionId
        ? competitionById.get(view.teamCompetitionId)
        : null;
      const projectLabel = competition
        ? `团体 · ${competition.name}${view.itemTypeLabel ? ` · ${view.itemTypeLabel}` : ''}`
        : `${event?.groupLabel ? `${event.groupLabel} · ` : ''}${view.eventTypeLabel}`;
      return {
        ...view,
        code: codes.get(view.id) ?? null,
        tournamentId,
        tournamentName: tournamentId
          ? (tournamentName.get(tournamentId) ?? '')
          : '',
        projectLabel,
      };
    });
    return { items, total: inTab.length, page, pageSize, counts };
  }

  /** 这些单项、团体赛下的全部场次；两样都没有时返回 null。 */
  private matchScope(
    eventIds: string[],
    competitionIds: string[],
  ): Prisma.MatchWhereInput | null {
    const or: Prisma.MatchWhereInput[] = [];
    if (eventIds.length) or.push({ eventId: { in: eventIds } });
    if (competitionIds.length)
      or.push({ teamMatch: { teamCompetitionId: { in: competitionIds } } });
    return or.length ? { OR: or } : null;
  }

  /**
   * 关键词：选手名 / 单位、双打队名、团体队名 / 单位、裁判、场地、项目名（男单、甲组…）、团体赛名、赛事名。
   * 返回空数组表示什么都搜不到。
   */
  private async keywordConditions(
    keyword: string,
    tournaments: Array<{ id: string; name: string }>,
    events: ScopeEvent[],
    competitions: ScopeCompetition[],
  ): Promise<Prisma.MatchWhereInput[]> {
    const eventIds = events.map((event) => event.id);
    const competitionIds = competitions.map((competition) => competition.id);
    const [registrations, teams] = await Promise.all([
      eventIds.length
        ? this.prisma.registration.findMany({
            where: {
              eventId: { in: eventIds },
              OR: [
                { player1: { name: { contains: keyword } } },
                { player2: { name: { contains: keyword } } },
                { player1: { affiliation: { contains: keyword } } },
                { player2: { affiliation: { contains: keyword } } },
                { teamName: { contains: keyword } },
                { name: { contains: keyword } },
              ],
            },
            select: { id: true },
            take: 5000,
          })
        : [],
      competitionIds.length
        ? this.prisma.team.findMany({
            where: {
              teamCompetitionId: { in: competitionIds },
              OR: [
                { name: { contains: keyword } },
                { affiliation: { contains: keyword } },
              ],
            },
            select: { id: true },
            take: 2000,
          })
        : [],
    ]);

    const q = normalize(keyword);
    const hitTournaments = new Set(
      tournaments
        .filter((tournament) => normalize(tournament.name).includes(q))
        .map((tournament) => tournament.id),
    );
    // 项目名可以带组别搜：「甲组男单」「甲组 男子单打」。
    const eventNames = (event: ScopeEvent) => {
      const types = EVENT_TYPE_NAMES[event.type] ?? [];
      return event.groupLabel
        ? [
            event.groupLabel,
            ...types,
            ...types.map((name) => `${event.groupLabel}${name}`),
          ]
        : types;
    };
    const hitEvents = events
      .filter(
        (event) =>
          hitTournaments.has(event.tournamentId) ||
          eventNames(event).some((name) => normalize(name).includes(q)),
      )
      // 混编：并入的单项没有自己的场次，场次都在主项目上。
      .flatMap((event) =>
        event.mixHostId ? [event.id, event.mixHostId] : [event.id],
      );
    const hitCompetitions = competitions
      .filter(
        (competition) =>
          hitTournaments.has(competition.tournamentId) ||
          normalize(competition.name).includes(q) ||
          q === '团体',
      )
      .map((competition) => competition.id);

    const registrationIds = registrations.map((row) => row.id);
    const teamIds = teams.map((row) => row.id);
    const or: Prisma.MatchWhereInput[] = [
      { venue: { name: { contains: keyword } } },
      { referee: { username: { contains: keyword } } },
    ];
    if (registrationIds.length)
      or.push(
        { side1Id: { in: registrationIds } },
        { side2Id: { in: registrationIds } },
      );
    if (teamIds.length)
      or.push({
        teamMatch: {
          OR: [{ team1Id: { in: teamIds } }, { team2Id: { in: teamIds } }],
        },
      });
    if (hitEvents.length) or.push({ eventId: { in: hitEvents } });
    if (hitCompetitions.length)
      or.push({ teamMatch: { teamCompetitionId: { in: hitCompetitions } } });
    return or;
  }

  /** 场次号要按整个赛事编（和秩序册一致），所以这一页涉及的赛事要把全部场次取来算。 */
  private async codesFor(
    tournamentIds: Set<string>,
    events: ScopeEvent[],
    competitions: ScopeCompetition[],
  ) {
    const codes = new Map<string, string>();
    if (!tournamentIds.size) return codes;
    const pageEvents = events.filter((event) =>
      tournamentIds.has(event.tournamentId),
    );
    const pageCompetitions = competitions.filter((competition) =>
      tournamentIds.has(competition.tournamentId),
    );
    const scope = this.matchScope(
      pageEvents.map((event) => event.id),
      pageCompetitions.map((competition) => competition.id),
    );
    if (!scope) return codes;
    const matches = await this.prisma.match.findMany({
      where: scope,
      select: CODE_SELECT,
    });
    const eventTournament = new Map(
      pageEvents.map((event) => [event.id, event.tournamentId]),
    );
    const competitionTournament = new Map(
      pageCompetitions.map((competition) => [
        competition.id,
        competition.tournamentId,
      ]),
    );
    for (const tournamentId of tournamentIds) {
      const own = matches.filter(
        (match) =>
          (match.eventId
            ? eventTournament.get(match.eventId)
            : competitionTournament.get(
                match.teamMatch?.teamCompetitionId ?? '',
              )) === tournamentId,
      );
      const result = computeMatchCodes({
        events: pageEvents.filter(
          (event) => event.tournamentId === tournamentId,
        ),
        teamCompetitionIds: pageCompetitions
          .filter((competition) => competition.tournamentId === tournamentId)
          .map((competition) => competition.id),
        teamCompetitionOf: (match) =>
          (match as (typeof matches)[number]).teamMatch?.teamCompetitionId ??
          null,
        matches: own,
      });
      for (const [id, code] of result) codes.set(id, code);
    }
    return codes;
  }
}
