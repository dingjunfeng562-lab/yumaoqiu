import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const playerSelect = { name: true, affiliation: true } as const;

@Injectable()
export class TournamentScreenService {
  constructor(private readonly prisma: PrismaService) {}

  async getScreen(tournamentId: string) {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, isPublished: true, isArchived: false, approvalStatus: 'APPROVED' },
      select: {
        id: true,
        name: true,
        screenSettings: true,
        venues: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            matches: {
              where: {
                status: { in: ['LIVE', 'PENDING'] },
                // Scope both the court and its matches to this tournament.
                OR: [
                  { event: { tournamentId } },
                  { teamMatch: { teamCompetition: { tournamentId } } },
                ],
              },
              select: {
                id: true, status: true, round: true, roundNo: true, matchNo: true,
                scheduledAt: true, startedAt: true, side1Id: true, side2Id: true,
                teamCompetitionItemId: true,
                event: { select: { type: true } },
                teamCompetitionItem: { select: { eventType: true } },
                games: {
                  orderBy: { gameNo: 'asc' },
                  select: { gameNo: true, side1Score: true, side2Score: true, winnerSide: true },
                },
                teamMatch: {
                  select: {
                    team1Id: true, team2Id: true,
                    lineups: {
                      select: {
                        teamId: true, teamCompetitionItemId: true,
                        player1: { select: playerSelect }, player2: { select: playerSelect },
                        team: { select: { name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!tournament) throw new NotFoundException('赛事不存在或尚未发布');

    const courts = tournament.venues.map((venue) => {
      const ordered = [...venue.matches].sort((a, b) => {
        if (a.status !== b.status) return a.status === 'LIVE' ? -1 : 1;
        const aTime = a.status === 'LIVE' ? a.startedAt : a.scheduledAt;
        const bTime = b.status === 'LIVE' ? b.startedAt : b.scheduledAt;
        return (aTime?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (bTime?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
          a.roundNo - b.roundNo || a.matchNo - b.matchNo || a.id.localeCompare(b.id);
      });
      return { id: venue.id, name: venue.name, match: ordered[0] ?? null };
    });
    const ids = courts.flatMap(({ match }) => match && !match.teamMatch
      ? [match.side1Id, match.side2Id].filter((id): id is string => Boolean(id)) : []);
    const registrations = ids.length ? await this.prisma.registration.findMany({
      where: { id: { in: ids }, event: { tournamentId } },
      select: { id: true, player1: { select: playerSelect }, player2: { select: playerSelect } },
    }) : [];
    const registrationMap = new Map(registrations.map((registration) => [registration.id, registration]));

    return {
      tournament: { id: tournament.id, name: tournament.name },
      settings: tournament.screenSettings,
      courts: courts.map(({ match, ...court }) => {
        if (!match) return { ...court, match: null };
        const side = (sideNo: 1 | 2) => {
          const teamId = sideNo === 1 ? match.teamMatch?.team1Id : match.teamMatch?.team2Id;
          const lineup = match.teamMatch?.lineups.find((item) =>
            item.teamId === teamId && item.teamCompetitionItemId === match.teamCompetitionItemId);
          const entrant = match.teamMatch ? lineup : registrationMap.get(
            (sideNo === 1 ? match.side1Id : match.side2Id) ?? '',
          );
          const players = entrant ? [entrant.player1, ...(entrant.player2 ? [entrant.player2] : [])] : [];
          return { players, teamName: lineup?.team.name ?? null };
        };
        return {
          ...court,
          match: {
            id: match.id, status: match.status, round: match.round, matchNo: match.matchNo,
            eventType: match.event?.type ?? match.teamCompetitionItem?.eventType ?? null,
            scheduledAt: match.scheduledAt,
            side1: side(1), side2: side(2),
            games: match.games,
            currentGame: match.games.find((game) => !game.winnerSide) ?? match.games.at(-1) ?? null,
          },
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  }
}
