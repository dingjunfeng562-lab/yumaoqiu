import { Injectable } from '@nestjs/common';
import { BroadcastSession, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { TeamCompetitionsService } from '../team-competitions/team-competitions.service';
import { OverlaySettingsDto } from './dto/broadcast.dto';

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettingsDto = {
  position: 'top-left',
  offsetX: 48,
  offsetY: 40,
  scale: 100,
  fontScale: 100,
  showTitle: true,
  showAffiliation: true,
  showGames: true,
  showGameWins: true,
  showServe: true,
  visible: true,
  swapSides: false,
  scoreDelaySeconds: 0,
  connectingText: '比分连接中',
};

/** Only these tournaments may feed a public overlay or viewer page. */
export const PUBLIC_TOURNAMENT_WHERE = {
  isPublished: true,
  isArchived: false,
  approvalStatus: 'APPROVED',
} satisfies Prisma.TournamentWhereInput;

export type OverlaySide = {
  name: string | null;
  teamName: string | null;
  players: { name: string; affiliation: string | null }[];
};

export type OverlayMatch = {
  id: string;
  status: string;
  pendingFinish: boolean;
  paused: boolean;
  eventTypeLabel: string;
  round: string;
  gamesToWin: number;
  side1: OverlaySide;
  side2: OverlaySide;
  games: { gameNo: number; side1Score: number; side2Score: number; winnerSide: number | null }[];
  currentGameNo: number | null;
  side1Games: number;
  side2Games: number;
  winnerSide: number | null;
  servingSide: 1 | 2 | null;
};

export type OverlaySnapshot = {
  broadcastId: string;
  configVersion: number;
  // Monotonic per server process (seeded from the clock so it keeps growing
  // across restarts). Clients drop any snapshot whose seq is not newer.
  seq: number;
  title: string;
  tournamentName: string;
  venueName: string | null;
  settings: OverlaySettingsDto;
  match: OverlayMatch | null;
  generatedAt: string;
};

function emptySide(): OverlaySide {
  return { name: null, teamName: null, players: [] };
}

@Injectable()
export class BroadcastScoreService {
  private lastSeq = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    private readonly teams: TeamCompetitionsService,
  ) {}

  nextSeq() {
    this.lastSeq = Math.max(Date.now() * 1000, this.lastSeq + 1);
    return this.lastSeq;
  }

  settingsOf(session: Pick<BroadcastSession, 'overlaySettings'>): OverlaySettingsDto {
    const raw = session.overlaySettings;
    const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Partial<OverlaySettingsDto> : {};
    return { ...DEFAULT_OVERLAY_SETTINGS, ...stored };
  }

  /**
   * Builds the minimal, display-only state for one broadcast. It reuses the
   * scoring service for rules, pause and serve state, then copies only the
   * fields an overlay needs: no referee account, event log, or internal ids.
   */
  async snapshot(sessionId: string): Promise<OverlaySnapshot | null> {
    const session = await this.prisma.broadcastSession.findUnique({
      where: { id: sessionId },
      include: { tournament: { select: { name: true } }, venue: { select: { name: true } } },
    });
    if (!session) return null;
    const match = session.currentMatchId ? await this.matchView(session.currentMatchId) : null;
    return {
      broadcastId: session.id,
      configVersion: session.configVersion,
      seq: this.nextSeq(),
      title: session.title,
      tournamentName: session.tournament.name,
      venueName: session.venue?.name ?? null,
      settings: this.settingsOf(session),
      match,
      generatedAt: new Date().toISOString(),
    };
  }

  private async matchView(matchId: string): Promise<OverlayMatch | null> {
    const state = await this.scoring.getMatchState(matchId).catch(() => null);
    if (!state) return null;
    const side = (view: typeof state.side1): OverlaySide => view ? {
      name: view.name ?? null,
      teamName: view.teamName ?? null,
      players: view.players.map((player: { name: string; affiliation: string | null }) => ({
        name: player.name, affiliation: player.affiliation ?? null,
      })),
    } : emptySide();
    const servingSide = state.servingState?.servingSide ?? null;
    return {
      id: state.id,
      status: state.status,
      pendingFinish: state.pendingFinish,
      paused: state.matchPaused,
      eventTypeLabel: state.event.typeLabel,
      round: state.round,
      // state.event already holds the stage-resolved rule for this match.
      gamesToWin: this.scoring.gamesToWinForMatch({
        round: state.round, roundNo: state.roundNo, matchNo: state.matchNo,
        event: {
          scoringRule: state.event.scoringRule, scoringMode: state.event.scoringMode,
          customGamePoint: state.event.customGamePoint, customGameCap: state.event.customGameCap,
          customGamesToWin: state.event.customGamesToWin,
        },
      }),
      side1: side(state.side1),
      side2: side(state.side2),
      games: state.games.map((game) => ({
        gameNo: game.gameNo, side1Score: game.side1Score, side2Score: game.side2Score, winnerSide: game.winnerSide,
      })),
      currentGameNo: state.currentGame?.gameNo ?? null,
      side1Games: state.side1Games,
      side2Games: state.side2Games,
      winnerSide: state.winnerSide,
      servingSide: state.status === 'LIVE' && (servingSide === 1 || servingSide === 2) ? servingSide : null,
    };
  }

  /** Short labels for the operator's match picker and viewer page. */
  async describeMatches<T extends { id: string; side1Id: string | null; side2Id: string | null }>(matches: T[]) {
    const ids = matches.flatMap((match) => [match.side1Id, match.side2Id]);
    const regularIds = [...new Set(ids.filter((id): id is string => !!id && !id.startsWith('lineup:')))];
    const registrations = regularIds.length ? await this.prisma.registration.findMany({
      where: { id: { in: regularIds } },
      select: { id: true, player1: { select: { name: true } }, player2: { select: { name: true } } },
    }) : [];
    const names = new Map<string, string>(registrations.map((item) => [
      item.id, item.player2 ? `${item.player1.name} / ${item.player2.name}` : item.player1.name,
    ]));
    const lineups = await this.teams.buildLineupRegistrationMap(ids);
    for (const [id, lineup] of lineups) names.set(id, `${lineup.teamName}：${lineup.name}`);
    return matches.map((match) => ({
      ...match,
      side1Name: (match.side1Id && names.get(match.side1Id)) || '待定',
      side2Name: (match.side2Id && names.get(match.side2Id)) || '待定',
    }));
  }
}
