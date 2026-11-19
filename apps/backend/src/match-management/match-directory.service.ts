import { Injectable } from '@nestjs/common';
import { MatchStatus, Prisma, Role } from '@prisma/client';
import { AuthActor, tournamentScope } from '../auth/admin-scope';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

const STATUS_ORDER: Record<string, number> = { LIVE: 0, PENDING: 1, COMPLETED: 2, CANCELLED: 3 };
export const SEARCH_LIMIT = 60;

/**
 * 裁判员对局管理的「找赛事」和「跨赛事搜选手」。
 * 管理员只看得到自己的赛事（tournamentScope），超级管理员看全部，并能看到每个赛事是谁创建的。
 */
@Injectable()
export class MatchDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
  ) {}

  /** 选赛事用的列表：基本信息 + 场次数（总数 / 进行中 / 已结束）。 */
  async listTournaments(actor?: AuthActor) {
    const tournaments = await this.prisma.tournament.findMany({
      where: tournamentScope(actor),
      select: {
        id: true,
        name: true,
        edition: true,
        status: true,
        startDate: true,
        endDate: true,
        location: true,
        organizer: true,
        isArchived: true,
        submittedById: true,
      },
      orderBy: [{ startDate: 'desc' }],
    });
    if (!tournaments.length) return [];
    const ids = tournaments.map((tournament) => tournament.id);

    const isRoot = actor?.role === Role.ROOT;
    const ownerIds = [...new Set(tournaments.map((t) => t.submittedById).filter((id): id is string => Boolean(id)))];
    const owners = isRoot && ownerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, username: true } })
      : [];
    const ownerName = new Map(owners.map((owner) => [owner.id, owner.username]));

    const counts = new Map<string, { total: number; live: number; completed: number }>();
    const bump = (tournamentId: string, status: MatchStatus, n: number) => {
      const row = counts.get(tournamentId) ?? { total: 0, live: 0, completed: 0 };
      row.total += n;
      if (status === MatchStatus.LIVE) row.live += n;
      if (status === MatchStatus.COMPLETED) row.completed += n;
      counts.set(tournamentId, row);
    };
    const events = await this.prisma.event.findMany({ where: { tournamentId: { in: ids } }, select: { id: true, tournamentId: true } });
    const tournamentOfEvent = new Map(events.map((event) => [event.id, event.tournamentId]));
    if (events.length) {
      const grouped = await this.prisma.match.groupBy({
        by: ['eventId', 'status'],
        where: { eventId: { in: events.map((event) => event.id) } },
        _count: { _all: true },
      });
      for (const row of grouped) {
        const tournamentId = row.eventId ? tournamentOfEvent.get(row.eventId) : null;
        if (tournamentId) bump(tournamentId, row.status, row._count._all);
      }
    }
    const teamMatches = await this.prisma.match.findMany({
      where: { eventId: null, teamMatch: { teamCompetition: { tournamentId: { in: ids } } } },
      select: { status: true, teamMatch: { select: { teamCompetition: { select: { tournamentId: true } } } } },
    });
    for (const match of teamMatches) {
      const tournamentId = match.teamMatch?.teamCompetition.tournamentId;
      if (tournamentId) bump(tournamentId, match.status, 1);
    }

    return tournaments.map(({ submittedById, ...tournament }) => ({
      ...tournament,
      startDate: tournament.startDate.toISOString(),
      endDate: tournament.endDate.toISOString(),
      owner: isRoot && submittedById ? ownerName.get(submittedById) ?? null : null,
      matchTotal: counts.get(tournament.id)?.total ?? 0,
      matchLive: counts.get(tournament.id)?.live ?? 0,
      matchCompleted: counts.get(tournament.id)?.completed ?? 0,
    }));
  }

  /**
   * 跨赛事搜选手 / 队伍：输入名字，列出这个人（这支队）在所有（自己的）赛事里的场次。
   * 单项按选手名、双打队名搜；团体赛按队伍名搜。最多 60 场，进行中的在前。
   */
  async searchMatches(actor: AuthActor | undefined, rawKeyword: string) {
    const keyword = (rawKeyword ?? '').trim().slice(0, 50);
    if (!keyword) return { keyword, items: [], truncated: false };
    const scope = tournamentScope(actor);

    const registrations = await this.prisma.registration.findMany({
      where: {
        event: { tournament: scope },
        OR: [
          { player1: { name: { contains: keyword } } },
          { player2: { name: { contains: keyword } } },
          { teamName: { contains: keyword } },
        ],
      },
      select: { id: true },
      take: 300,
    });
    const teams = await this.prisma.team.findMany({
      where: { name: { contains: keyword }, teamCompetition: { tournament: scope } },
      select: { id: true },
      take: 100,
    });
    const registrationIds = registrations.map((row) => row.id);
    const teamIds = teams.map((row) => row.id);
    const or: Prisma.MatchWhereInput[] = [];
    if (registrationIds.length) {
      or.push({ eventId: { not: null }, side1Id: { in: registrationIds } }, { eventId: { not: null }, side2Id: { in: registrationIds } });
    }
    if (teamIds.length) {
      or.push({ teamMatch: { OR: [{ team1Id: { in: teamIds } }, { team2Id: { in: teamIds } }] } });
    }
    if (!or.length) return { keyword, items: [], truncated: false };

    const matches = await this.prisma.match.findMany({
      where: { OR: or },
      select: {
        id: true,
        round: true,
        roundNo: true,
        matchNo: true,
        status: true,
        scheduledAt: true,
        side1Id: true,
        side2Id: true,
        winnerSide: true,
        venue: { select: { name: true } },
        games: { orderBy: { gameNo: 'asc' }, select: { side1Score: true, side2Score: true } },
        event: { select: { type: true, groupLabel: true, tournament: { select: { id: true, name: true, isArchived: true } } } },
        teamCompetitionItem: { select: { eventType: true } },
        teamMatch: {
          select: {
            round: true,
            team1: { select: { name: true } },
            team2: { select: { name: true } },
            teamCompetition: { select: { name: true, tournament: { select: { id: true, name: true, isArchived: true } } } },
          },
        },
      },
      take: SEARCH_LIMIT + 1,
      orderBy: [{ scheduledAt: 'desc' }],
    });
    const truncated = matches.length > SEARCH_LIMIT;
    const kept = matches.slice(0, SEARCH_LIMIT);
    const sideViews = await this.scoring.resolveSideViews(kept.flatMap((match) => [match.side1Id, match.side2Id]));
    const sideName = (id: string | null) => {
      if (!id) return '待定';
      const view = sideViews.get(id);
      return view?.teamName?.trim() || view?.name || '待定';
    };

    const items = kept
      .map((match) => {
        const tournament = match.event?.tournament ?? match.teamMatch?.teamCompetition.tournament ?? null;
        const project = match.event
          ? `${match.event.groupLabel ? `${match.event.groupLabel} · ` : ''}${EVENT_TYPE_LABELS[match.event.type] ?? match.event.type}`
          : `团体 · ${match.teamMatch?.teamCompetition.name ?? ''}${match.teamCompetitionItem ? ` · ${EVENT_TYPE_LABELS[match.teamCompetitionItem.eventType] ?? match.teamCompetitionItem.eventType}` : ''}`;
        return {
          id: match.id,
          tournamentId: tournament?.id ?? null,
          tournamentName: tournament?.name ?? '',
          tournamentArchived: tournament?.isArchived ?? false,
          project,
          round: match.teamMatch?.round ?? match.round,
          roundNo: match.roundNo,
          matchNo: match.matchNo,
          status: match.status,
          scheduledAt: match.scheduledAt?.toISOString() ?? null,
          venue: match.venue?.name ?? null,
          side1Name: match.teamMatch ? `${match.teamMatch.team1?.name ?? '待定'}：${sideName(match.side1Id)}` : sideName(match.side1Id),
          side2Name: match.teamMatch ? `${match.teamMatch.team2?.name ?? '待定'}：${sideName(match.side2Id)}` : sideName(match.side2Id),
          winnerSide: match.winnerSide,
          scoreText: match.games.map((game) => `${game.side1Score}:${game.side2Score}`).join(' / '),
        };
      })
      .filter((item) => item.tournamentId)
      .sort((a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
        || (a.scheduledAt ?? '9999').localeCompare(b.scheduledAt ?? '9999'));
    return { keyword, items, truncated };
  }
}
