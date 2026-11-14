import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AuthActor } from '../auth/admin-scope';
import { tournamentScope } from '../auth/admin-scope';
import { VersionedCache } from '../common/versioned-cache';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringGateway } from '../scoring/scoring.gateway';
import { SetCheckInDto } from './check-in.dto';

// 观众页在每次计分广播后都会重新拉取。同一数据版本内同一赛事只查一次库，最多旧 3 秒；
// 计分、晋级广播前（publicDataChanges）和签到写入后立即失效。与对阵页缓存同一做法。
const PUBLIC_BOARD_TTL_MS = 3_000;

const playerSelect = { id: true, name: true } as const;
const entrantSelect = { player1: { select: playerSelect }, player2: { select: playerSelect } } as const;
const matchInclude = {
  checkIns: true,
  games: { orderBy: { gameNo: 'asc' as const }, select: { gameNo: true, side1Score: true, side2Score: true, winnerSide: true } },
  event: { select: { id: true, tournamentId: true, type: true, drawPublished: true } },
  teamCompetitionItem: { select: { eventType: true } },
  teamMatch: { select: {
    team1Id: true, team2Id: true,
    team1: { select: { name: true } }, team2: { select: { name: true } },
    teamCompetition: { select: { id: true, tournamentId: true, isPublished: true } },
    lineups: { select: { id: true, teamId: true, teamCompetitionItemId: true, ...entrantSelect } },
  } },
} satisfies Prisma.MatchInclude;
type BoardMatch = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;
type Entrant = { player1: { id: string; name: string }; player2: { id: string; name: string } | null };

function participant(match: BoardMatch, side: 1 | 2, registrations: Map<string, Entrant>) {
  const id = side === 1 ? match.side1Id : match.side2Id;
  const team = match.teamMatch;
  const teamId = side === 1 ? team?.team1Id : team?.team2Id;
  const entrant = team
    ? team.lineups.find((item) => item.teamId === teamId && item.teamCompetitionItemId === match.teamCompetitionItemId)
    : registrations.get(id ?? '');
  const players = entrant ? [entrant.player1, ...(entrant.player2 ? [entrant.player2] : [])] : [];
  const eventType = match.event?.type ?? match.teamCompetitionItem?.eventType;
  const complete = !!id && players.length === (eventType?.endsWith('DOUBLES') ? 2 : 1);
  const key = createHash('sha256').update(JSON.stringify([id, ...players.map((p) => p.id)])).digest('hex');
  const record = match.checkIns.find((item) => item.side === side && item.entrantKey === key);
  return {
    key,
    name: players.map((p) => p.name).join(' / ') || '选手待定',
    teamName: (side === 1 ? team?.team1?.name : team?.team2?.name) ?? null,
    complete,
    checkedAt: complete ? record?.checkedAt.toISOString() ?? null : null,
  };
}

// 选手指纹只用于工作人员签到时核对对阵，观众页用不到，公开接口不返回。
function publicSide(side: ReturnType<typeof participant>) {
  return { name: side.name, teamName: side.teamName, complete: side.complete, checkedAt: side.checkedAt };
}
function toPublicBoard(board: Awaited<ReturnType<CheckInService['loadBoard']>>) {
  return { ...board, matches: board.matches.map((match) => ({ ...match, side1: publicSide(match.side1), side2: publicSide(match.side2) })) };
}

@Injectable()
export class CheckInService {
  private readonly publicBoards = new VersionedCache<Map<string, Promise<ReturnType<typeof toPublicBoard>>>>(PUBLIC_BOARD_TTL_MS);

  constructor(private readonly prisma: PrismaService, private readonly gateway: ScoringGateway) {
    gateway.publicDataChanges.subscribe(() => this.publicBoards.invalidate());
  }

  list(actor: AuthActor) {
    return this.prisma.tournament.findMany({
      where: { ...tournamentScope(actor), isArchived: false },
      select: { id: true, name: true, startDate: true, endDate: true, isPublished: true, approvalStatus: true },
      orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
    });
  }

  private async registrations(db: Prisma.TransactionClient, matches: BoardMatch[], tournamentId: string) {
    const ids = [...new Set(matches.filter((m) => !m.teamMatch).flatMap((m) => [m.side1Id, m.side2Id]).filter((id): id is string => !!id))];
    const items = ids.length ? await db.registration.findMany({
      where: { id: { in: ids }, event: { tournamentId } }, select: { id: true, ...entrantSelect },
    }) : [];
    return new Map(items.map((item) => [item.id, item]));
  }

  /** 工作人员签到页：每次现查，按账号可管理的赛事限定。 */
  board(tournamentId: string, actor: AuthActor) {
    return this.loadBoard(tournamentId, actor);
  }

  /** 观众页：按赛事共用缓存，同一数据版本最多缓存 100 个赛事，再多的（多半是乱填的 id）每次现查。 */
  async publicBoard(tournamentId: string) {
    const boards = await this.publicBoards.get(async () => new Map());
    let board = boards.get(tournamentId);
    if (!board) {
      board = this.loadBoard(tournamentId).then(toPublicBoard);
      if (boards.size < 100) {
        boards.set(tournamentId, board);
        board.catch(() => boards.delete(tournamentId));
      }
    }
    return board;
  }

  private async loadBoard(tournamentId: string, actor?: AuthActor) {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, ...(actor ? tournamentScope(actor) : { isPublished: true, isArchived: false, approvalStatus: 'APPROVED' as const }) },
      select: { id: true, name: true, startDate: true, endDate: true, isPublished: true, isArchived: true, approvalStatus: true },
    });
    if (!tournament) throw new NotFoundException('赛事不存在或尚未公开');
    const [venues, matches] = await Promise.all([
      this.prisma.venue.findMany({
        where: { tournamentId }, select: { id: true, name: true, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.match.findMany({
        where: { OR: [
          { event: { tournamentId, ...(!actor ? { drawPublished: true } : {}) } },
          { teamMatch: { teamCompetition: { tournamentId, ...(!actor ? { isPublished: true } : {}) } } },
        ] },
        include: matchInclude,
        orderBy: [{ scheduledAt: 'asc' }, { roundNo: 'asc' }, { matchNo: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const registrations = await this.registrations(this.prisma, matches, tournamentId);
    return {
      tournament: { id: tournament.id, name: tournament.name, startDate: tournament.startDate, endDate: tournament.endDate,
        publicAvailable: tournament.isPublished && !tournament.isArchived && tournament.approvalStatus === 'APPROVED' },
      venues,
      matches: matches.map((match) => {
        const side1 = participant(match, 1, registrations);
        const side2 = participant(match, 2, registrations);
        return {
          id: match.id, matchNo: match.matchNo, round: match.round, roundNo: match.roundNo,
          eventId: match.eventId ?? match.teamMatch?.teamCompetition.id ?? '',
          eventType: match.event?.type ?? match.teamCompetitionItem?.eventType ?? '',
          venueId: match.venueId, scheduledAt: match.scheduledAt,
          status: match.status, forfeitedSide: match.forfeitedSide, winnerSide: match.winnerSide,
          side1, side2, games: match.games,
          canCheckIn: match.status === 'PENDING' && !match.forfeitedSide && side1.complete && side2.complete,
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  async set(matchId: string, dto: SetCheckInDto, actor: AuthActor) {
    const tournamentId = await this.prisma.$transaction(async (tx) => {
      // Serialize operators on the match row, also excluding concurrent start/result writes.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM \`Match\` WHERE id = ${matchId} FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('比赛不存在');
      const match = await tx.match.findUnique({ where: { id: matchId }, include: matchInclude });
      if (!match) throw new NotFoundException('比赛不存在');
      const tournamentId = match.event?.tournamentId ?? match.teamMatch?.teamCompetition.tournamentId;
      if (!tournamentId || !(await tx.tournament.findFirst({ where: { id: tournamentId, ...tournamentScope(actor) }, select: { id: true } }))) {
        throw new NotFoundException('比赛不存在或无权访问');
      }
      if (match.status !== 'PENDING' || match.forfeitedSide) throw new BadRequestException('比赛已开始或已结束，不能修改签到');
      const registrations = await this.registrations(tx, [match], tournamentId);
      const sides = [participant(match, 1, registrations), participant(match, 2, registrations)];
      if (!sides.every((side) => side.complete)) throw new BadRequestException('双方选手尚未确定或双打阵容不完整');
      if (sides[0].key !== dto.side1Key || sides[1].key !== dto.side2Key) {
        throw new ConflictException('对阵选手已变更，请刷新后重新签到');
      }
      const targets = dto.side === 'both' ? [1, 2] : [Number(dto.side)];
      for (const side of targets) {
        const current = sides[side - 1];
        // Retried requests are idempotent: retain the original timestamp and log once.
        if (!!current.checkedAt === dto.checked) continue;
        if (dto.checked) {
          await tx.matchCheckIn.upsert({
            where: { matchId_side: { matchId, side } },
            create: { matchId, side, entrantKey: current.key, checkedAt: new Date(), actorId: actor.id },
            update: { entrantKey: current.key, checkedAt: new Date(), actorId: actor.id },
          });
        } else {
          await tx.matchCheckIn.deleteMany({ where: { matchId, side } });
        }
        await tx.matchCheckInLog.create({ data: {
          matchId, side, entrantKey: current.key, action: dto.checked ? 'CHECK_IN' : 'UNDO', actorId: actor.id,
        } });
      }
      return tournamentId;
    });
    this.publicBoards.invalidate();
    // No operator identities or entrant data are sent through the public socket.
    this.gateway.emitCheckInUpdate({ tournamentId, matchId });
    return { ok: true };
  }
}
