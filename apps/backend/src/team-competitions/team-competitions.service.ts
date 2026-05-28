import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EventType,
  Format,
  Gender,
  MatchStatus,
  Prisma,
  Role,
  ScoringMode,
  ScoringRule,
  TeamCompetition,
  TeamCompetitionItem,
  TeamLineup,
  TeamMatch,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssignTeamMatchRefereeDto,
  CreateTeamCompetitionDto,
  CreateTeamDto,
  GenerateTeamDrawDto,
  ImportTeamPlayersDto,
  ParseQuickTeamDto,
  QuickParsedAssignmentDto,
  QuickTeamPreviewDto,
  ReplaceTeamMembersDto,
  SetTeamLineupsDto,
  TeamCompetitionItemDto,
  UpdateTeamCompetitionDto,
  UpdateTeamDto,
} from './dto/team-competition.dto';

type TeamWithMembers = Prisma.TeamGetPayload<{
  include: {
    members: {
      include: {
        player: true;
      };
    };
  };
}>;

type TeamCompetitionDetail = Prisma.TeamCompetitionGetPayload<{
  include: {
    tournament: true;
    items: true;
    teams: {
      include: {
        members: {
          include: {
            player: true;
          };
        };
      };
    };
    teamMatches: {
      include: {
        team1: true;
        team2: true;
        winnerTeam: true;
        matches: {
          include: {
            teamCompetitionItem: true;
            referee: {
              select: {
                id: true;
                username: true;
              };
            };
            venue: true;
            games: {
              orderBy: {
                gameNo: 'asc';
              };
            };
          };
          orderBy: [{ matchNo: 'asc' }];
        };
        lineups: {
          include: {
            teamCompetitionItem: true;
            player1: true;
            player2: true;
            team: true;
          };
        };
      };
      orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }];
    };
  };
}>;

type ParsedQuickAssignment = {
  eventType: EventType;
  names: string[];
};

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  MENS_SINGLES: '男单',
  WOMENS_SINGLES: '女单',
  MENS_DOUBLES: '男双',
  WOMENS_DOUBLES: '女双',
  MIXED_DOUBLES: '混双',
};

const QUICK_LABEL_MAP: Array<{ pattern: RegExp; eventType: EventType }> = [
  { pattern: /^(男单|男子单打|mens?_?singles?)$/i, eventType: 'MENS_SINGLES' },
  { pattern: /^(女单|女子单打|womens?_?singles?)$/i, eventType: 'WOMENS_SINGLES' },
  { pattern: /^(男双|男子双打|mens?_?doubles?)$/i, eventType: 'MENS_DOUBLES' },
  { pattern: /^(女双|女子双打|womens?_?doubles?)$/i, eventType: 'WOMENS_DOUBLES' },
  { pattern: /^(混双|mixed_?doubles?)$/i, eventType: 'MIXED_DOUBLES' },
];

@Injectable()
export class TeamCompetitionsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTeamCompetitionDto) {
    await this.ensureTournament(dto.tournamentId);
    const items = this.normalizeItems(dto.items);
    this.ensureWinThreshold(dto.winThreshold, items.length);

    return this.prisma.teamCompetition.create({
      data: {
        tournamentId: dto.tournamentId,
        name: dto.name,
        description: dto.description,
        winThreshold: dto.winThreshold,
        isPublished: dto.isPublished ?? false,
        items: {
          create: items.map((item) => ({ eventType: item.eventType, sortOrder: item.sortOrder })),
        },
      },
      include: {
        tournament: true,
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  list(tournamentId?: string) {
    return this.prisma.teamCompetition.findMany({
      where: tournamentId ? { tournamentId } : undefined,
      include: {
        tournament: true,
        items: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { teams: true, teamMatches: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async findOne(id: string) {
    const competition = await this.getCompetitionDetail(id);
    return this.toCompetitionView(competition);
  }

  async update(id: string, dto: UpdateTeamCompetitionDto) {
    const current = await this.ensureCompetition(id);
    const nextItems = dto.items ? this.normalizeItems(dto.items) : null;
    this.ensureWinThreshold(dto.winThreshold ?? current.winThreshold, nextItems?.length ?? undefined);

    await this.prisma.$transaction(async (tx) => {
      await tx.teamCompetition.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.winThreshold !== undefined ? { winThreshold: dto.winThreshold } : {}),
          ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
        },
      });

      if (nextItems) {
        const teamMatchCount = await tx.teamMatch.count({ where: { teamCompetitionId: id } });
        if (teamMatchCount > 0) {
          throw new ConflictException('已生成团体赛对阵后不能直接修改项目集合');
        }
        await tx.teamCompetitionItem.deleteMany({ where: { teamCompetitionId: id } });
        await tx.teamCompetitionItem.createMany({
          data: nextItems.map((item) => ({
            teamCompetitionId: id,
            eventType: item.eventType,
            sortOrder: item.sortOrder,
          })),
        });
      }
    });

    return this.findOne(id);
  }

  async remove(id: string) {
    await this.ensureCompetition(id);
    return this.prisma.teamCompetition.delete({ where: { id } });
  }

  async createTeam(teamCompetitionId: string, dto: CreateTeamDto) {
    const competition = await this.ensureCompetition(teamCompetitionId);
    const playerIds = this.uniquePlayerIds(dto.playerIds);
    await this.ensureMinimumTeamSize(playerIds.length);
    const players = await this.loadPlayers(playerIds);
    this.ensureSingleCompetitionMembership(players, teamCompetitionId);

    return this.prisma.team.create({
      data: {
        teamCompetitionId,
        name: dto.name,
        affiliation: dto.affiliation,
        notes: dto.notes,
        members: {
          create: playerIds.map((playerId) => ({ playerId })),
        },
      },
      include: {
        teamCompetition: true,
        members: { include: { player: true } },
      },
    });
  }

  async listTeams(teamCompetitionId: string) {
    await this.ensureCompetition(teamCompetitionId);
    const teams = await this.prisma.team.findMany({
      where: { teamCompetitionId },
      include: {
        members: { include: { player: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
    return teams.map((team) => this.toTeamView(team));
  }

  async updateTeam(teamId: string, dto: UpdateTeamDto) {
    await this.ensureTeam(teamId);
    return this.prisma.team.update({
      where: { id: teamId },
      data: dto,
      include: {
        members: { include: { player: true }, orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async replaceTeamMembers(teamId: string, dto: ReplaceTeamMembersDto) {
    const team = await this.ensureTeam(teamId);
    const playerIds = this.uniquePlayerIds(dto.playerIds);
    await this.ensureMinimumTeamSize(playerIds.length);
    const players = await this.loadPlayers(playerIds);
    this.ensureSingleCompetitionMembership(players, team.teamCompetitionId, team.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({ where: { teamId } });
      await tx.teamMember.createMany({
        data: playerIds.map((playerId) => ({ teamId, playerId })),
      });
    });

    return this.prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      include: {
        members: { include: { player: true }, orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async removeTeam(teamId: string) {
    await this.ensureTeam(teamId);
    return this.prisma.team.delete({ where: { id: teamId } });
  }

  async importTeamPlayers(teamCompetitionId: string, dto: ImportTeamPlayersDto) {
    await this.ensureCompetition(teamCompetitionId);
    if (dto.players.length < 10) {
      throw new BadRequestException('每队至少 10 人');
    }

    return this.prisma.$transaction(async (tx) => {
      const createdPlayers = [] as Array<{ id: string }>;
      for (const player of dto.players) {
        const created = await tx.player.create({
          data: {
            name: player.name,
            gender: player.gender,
            affiliation: player.affiliation,
            contact: player.contact,
            notes: player.notes,
          },
          select: { id: true },
        });
        createdPlayers.push(created);
      }

      return tx.team.create({
        data: {
          teamCompetitionId,
          name: dto.teamName,
          affiliation: dto.affiliation,
          notes: dto.notes,
          members: {
            create: createdPlayers.map((player) => ({ playerId: player.id })),
          },
        },
        include: {
          members: { include: { player: true }, orderBy: { createdAt: 'asc' } },
        },
      });
    });
  }

  async previewQuickTeam(prompt: string, itemEventTypes: EventType[]) {
    const parsed = this.parseQuickAssignments(prompt);
    const unsupported = parsed.filter((item) => !itemEventTypes.includes(item.eventType));
    if (unsupported.length) {
      throw new BadRequestException(
        `以下项目不在当前团体赛配置中：${unsupported.map((item) => EVENT_TYPE_LABELS[item.eventType]).join('、')}`,
      );
    }

    const assignmentNames = parsed.flatMap((item) => item.names);
    const uniqueNames = [...new Set(assignmentNames)];
    const benchNames = uniqueNames.slice(Math.min(uniqueNames.length, parsed.length + 8));

    return {
      assignments: parsed,
      benchNames,
      uniquePlayerNames: uniqueNames,
    };
  }

  async createTeamFromQuickInput(teamCompetitionId: string, dto: ParseQuickTeamDto) {
    const competition = await this.ensureCompetition(teamCompetitionId);
    const preview = await this.previewQuickTeam(
      dto.prompt,
      competition.items.map((item) => item.eventType),
    );
    if (preview.uniquePlayerNames.length < 10) {
      throw new BadRequestException('快速录入至少需要解析出 10 名队员');
    }

    return this.prisma.$transaction(async (tx) => {
      const createdPlayers = [] as Array<{ id: string; name: string }>;
      for (const name of preview.uniquePlayerNames) {
        const created = await tx.player.create({
          data: {
            name,
            gender: this.guessGenderFromName(name),
            affiliation: dto.affiliation,
            notes: '由团体赛快速录入创建',
          },
          select: { id: true, name: true },
        });
        createdPlayers.push(created);
      }

      const team = await tx.team.create({
        data: {
          teamCompetitionId,
          name: dto.teamName,
          affiliation: dto.affiliation,
          notes: dto.notes,
          members: {
            create: createdPlayers.map((player) => ({ playerId: player.id })),
          },
        },
        include: {
          members: { include: { player: true }, orderBy: { createdAt: 'asc' } },
        },
      });

      return {
        team: this.toTeamView(team),
        preview,
      };
    });
  }

  async generateDraw(teamCompetitionId: string, dto: GenerateTeamDrawDto) {
    const competition = await this.ensureCompetition(teamCompetitionId);
    const teams = await this.prisma.team.findMany({
      where: { teamCompetitionId },
      include: { members: true },
      orderBy: [{ createdAt: 'asc' }],
    });
    if (teams.length < 2) throw new BadRequestException('至少需要 2 支队伍才能生成团体赛对阵');

    const existing = await this.prisma.teamMatch.count({ where: { teamCompetitionId } });
    if (existing > 0 && !dto.force) {
      throw new ConflictException('团体赛对阵已存在，如需覆盖请使用重新生成');
    }

    const shuffled = this.shuffle(teams);
    const bracketSize = this.nextPowerOfTwo(shuffled.length);
    const slots = [...shuffled, ...Array.from({ length: bracketSize - shuffled.length }, () => null)];
    const teamMatches = [] as Array<{
      round: string;
      roundNo: number;
      matchNo: number;
      team1Id: string | null;
      team2Id: string | null;
      status: MatchStatus;
      winnerTeamId: string | null;
    }>;

    let currentSlots = slots;
    let roundNo = 1;
    while (currentSlots.length >= 2) {
      const roundLabel = this.roundLabel(currentSlots.length);
      const nextSlots: Array<(typeof teams)[number] | null> = [];
      for (let i = 0; i < currentSlots.length; i += 2) {
        const team1 = currentSlots[i];
        const team2 = currentSlots[i + 1];
        const hasBye = Boolean(team1) !== Boolean(team2);
        const winnerTeam = hasBye ? (team1 ?? team2) : null;
        teamMatches.push({
          round: roundLabel,
          roundNo,
          matchNo: i / 2 + 1,
          team1Id: team1?.id ?? null,
          team2Id: team2?.id ?? null,
          status: hasBye ? MatchStatus.COMPLETED : MatchStatus.PENDING,
          winnerTeamId: winnerTeam?.id ?? null,
        });
        nextSlots.push(winnerTeam);
      }
      currentSlots = nextSlots;
      roundNo += 1;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.match.deleteMany({
        where: {
          teamMatch: {
            teamCompetitionId,
          },
        },
      });
      await tx.teamLineup.deleteMany({ where: { teamMatch: { teamCompetitionId } } });
      await tx.teamMatch.deleteMany({ where: { teamCompetitionId } });

      for (const item of teamMatches) {
        const created = await tx.teamMatch.create({
          data: {
            teamCompetitionId,
            round: item.round,
            roundNo: item.roundNo,
            matchNo: item.matchNo,
            team1Id: item.team1Id,
            team2Id: item.team2Id,
            status: item.status,
            winnerTeamId: item.winnerTeamId,
          },
        });

        if (item.team1Id && item.team2Id) {
          const competitionItems = await tx.teamCompetitionItem.findMany({
            where: { teamCompetitionId },
            orderBy: { sortOrder: 'asc' },
          });
          await tx.match.createMany({
            data: competitionItems.map((competitionItem, index) => ({
              teamMatchId: created.id,
              teamCompetitionItemId: competitionItem.id,
              round: item.round,
              roundNo: item.roundNo,
              matchNo: index + 1,
              side1Id: null,
              side2Id: null,
              status: MatchStatus.PENDING,
              durationMinutes: 45,
            })),
          });
        }
      }
    });

    return this.findOne(teamCompetitionId);
  }

  async getTeamMatchLineups(teamMatchId: string) {
    const teamMatch = await this.ensureTeamMatch(teamMatchId);
    const lineups = await this.prisma.teamLineup.findMany({
      where: { teamMatchId },
      include: {
        teamCompetitionItem: true,
        player1: true,
        player2: true,
        team: true,
      },
      orderBy: [{ teamCompetitionItem: { sortOrder: 'asc' } }, { team: { createdAt: 'asc' } }],
    });

    return {
      teamMatch,
      lineups: lineups.map((lineup) => this.toLineupView(lineup)),
    };
  }

  async setTeamLineups(teamMatchId: string, dto: SetTeamLineupsDto) {
    const teamMatch = await this.ensureTeamMatch(teamMatchId);
    if (teamMatch.lineupLocked) {
      throw new ConflictException('该团体赛出场名单已锁定');
    }
    if (!teamMatch.team1Id || !teamMatch.team2Id) {
      throw new BadRequestException('轮空团体赛无需设置出场名单');
    }

    const teamCompetition = await this.ensureCompetition(teamMatch.teamCompetitionId);
    const competitionItemIds = new Set(teamCompetition.items.map((item) => item.id));
    const teamIds = new Set([teamMatch.team1Id, teamMatch.team2Id]);
    const teamMemberMap = await this.teamMemberMap([teamMatch.team1Id, teamMatch.team2Id]);
    const existingItems = teamCompetition.items;

    if (dto.selections.length !== existingItems.length * 2) {
      throw new BadRequestException('每个项目必须为双方各设置 1 组出场名单');
    }

    const seenKeys = new Set<string>();
    const usageCounter = new Map<string, number>();
    for (const selection of dto.selections) {
      if (!teamIds.has(selection.teamId)) {
        throw new BadRequestException('出场名单中的队伍不属于该团体赛');
      }
      if (!competitionItemIds.has(selection.teamCompetitionItemId)) {
        throw new BadRequestException('出场项目不属于该团体赛');
      }
      const key = `${selection.teamId}:${selection.teamCompetitionItemId}`;
      if (seenKeys.has(key)) {
        throw new BadRequestException('同一队伍在同一项目下只能设置一条出场名单');
      }
      seenKeys.add(key);

      const item = existingItems.find((entry) => entry.id === selection.teamCompetitionItemId)!;
      this.validateLineupPlayers(item.eventType, selection.player1Id, selection.player2Id);
      const playerIds = [selection.player1Id, selection.player2Id].filter(Boolean) as string[];
      for (const playerId of playerIds) {
        if (!teamMemberMap.get(selection.teamId)?.has(playerId)) {
          throw new BadRequestException('出场名单中的选手必须属于对应队伍');
        }
        usageCounter.set(playerId, (usageCounter.get(playerId) ?? 0) + 1);
      }
    }

    for (const [playerId, count] of usageCounter.entries()) {
      if (count > 2) {
        throw new ConflictException(`队员 ${playerId} 在同一场团体赛中最多身兼 2 项`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.teamLineup.deleteMany({ where: { teamMatchId } });
      await tx.teamLineup.createMany({
        data: dto.selections.map((selection) => ({
          teamMatchId,
          teamCompetitionItemId: selection.teamCompetitionItemId,
          teamId: selection.teamId,
          player1Id: selection.player1Id,
          player2Id: selection.player2Id ?? null,
        })),
      });

      const matchItems = await tx.match.findMany({
        where: { teamMatchId },
        include: { teamCompetitionItem: true },
        orderBy: { matchNo: 'asc' },
      });
      for (const match of matchItems) {
        const side1 = dto.selections.find(
          (selection) =>
            selection.teamCompetitionItemId === match.teamCompetitionItemId && selection.teamId === teamMatch.team1Id,
        );
        const side2 = dto.selections.find(
          (selection) =>
            selection.teamCompetitionItemId === match.teamCompetitionItemId && selection.teamId === teamMatch.team2Id,
        );
        await tx.match.update({
          where: { id: match.id },
          data: {
            side1Id: side1 ? this.lineupSlotId(side1.teamId, side1.teamCompetitionItemId) : null,
            side2Id: side2 ? this.lineupSlotId(side2.teamId, side2.teamCompetitionItemId) : null,
            status: MatchStatus.PENDING,
            winnerSide: null,
          },
        });
      }

      if (dto.lock) {
        await tx.teamMatch.update({
          where: { id: teamMatchId },
          data: { lineupLocked: true },
        });
      }
    });

    return this.getTeamMatchLineups(teamMatchId);
  }

  async assignTeamMatchReferee(matchId: string, dto: AssignTeamMatchRefereeDto) {
    const referee = await this.prisma.user.findUnique({ where: { id: dto.refereeId } });
    if (!referee || referee.role !== Role.REFEREE) {
      throw new BadRequestException('请选择有效的裁判账号');
    }
    await this.prisma.match.update({
      where: { id: matchId },
      data: { refereeId: dto.refereeId },
    });
    return this.prisma.match.findUniqueOrThrow({
      where: { id: matchId },
      include: {
        referee: { select: { id: true, username: true } },
        venue: true,
        games: { orderBy: { gameNo: 'asc' } },
        teamCompetitionItem: true,
        teamMatch: true,
      },
    });
  }

  async getPublicCompetitions(tournamentId?: string) {
    const competitions = await this.prisma.teamCompetition.findMany({
      where: {
        isPublished: true,
        ...(tournamentId ? { tournamentId } : {}),
      },
      include: {
        tournament: true,
        items: { orderBy: { sortOrder: 'asc' } },
        teams: {
          include: { members: true },
          orderBy: { createdAt: 'asc' },
        },
        teamMatches: {
          include: {
            team1: true,
            team2: true,
            winnerTeam: true,
            matches: {
              include: {
                teamCompetitionItem: true,
                venue: true,
                games: { orderBy: { gameNo: 'asc' } },
              },
              orderBy: { matchNo: 'asc' },
            },
          },
          orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    return competitions.map((competition) => this.toPublicCompetitionView(competition));
  }

  async updateTeamMatchAggregate(tx: Prisma.TransactionClient, matchId: string) {
    const match = await tx.match.findUnique({
      where: { id: matchId },
      include: {
        teamMatch: {
          include: {
            matches: {
              include: {
                teamCompetitionItem: true,
              },
              orderBy: { matchNo: 'asc' },
            },
            teamCompetition: {
              include: {
                items: { orderBy: { sortOrder: 'asc' } },
              },
            },
          },
        },
      },
    });
    if (!match?.teamMatch) return null;

    const teamMatch = match.teamMatch;
    const finished = teamMatch.matches.filter((item) => item.status === MatchStatus.COMPLETED && item.winnerSide);
    const team1Wins = finished.filter((item) => item.winnerSide === 1).length;
    const team2Wins = finished.filter((item) => item.winnerSide === 2).length;

    const teamMatchData = {
      team1Wins,
      team2Wins,
    };

    let winnerTeamId: string | null = null;
    let nextStatus: MatchStatus = MatchStatus.PENDING;
    if (team1Wins >= teamMatch.teamCompetition.winThreshold && teamMatch.team1Id) {
      winnerTeamId = teamMatch.team1Id;
      nextStatus = MatchStatus.COMPLETED;
    } else if (team2Wins >= teamMatch.teamCompetition.winThreshold && teamMatch.team2Id) {
      winnerTeamId = teamMatch.team2Id;
      nextStatus = MatchStatus.COMPLETED;
    } else if (finished.length > 0) {
      nextStatus = MatchStatus.LIVE;
    }

    await tx.teamMatch.update({
      where: { id: teamMatch.id },
      data: {
        ...teamMatchData,
        winnerTeamId,
        status: nextStatus,
      },
    });

    if (winnerTeamId) {
      const remainingMatchIds = teamMatch.matches
        .filter((item) => item.status === MatchStatus.PENDING || item.status === MatchStatus.LIVE)
        .map((item) => item.id);
      if (remainingMatchIds.length) {
        await tx.match.updateMany({
          where: { id: { in: remainingMatchIds } },
          data: { status: MatchStatus.CANCELLED, winnerSide: null },
        });
      }
    }

    return { teamMatchId: teamMatch.id, winnerTeamId, team1Wins, team2Wins, status: nextStatus };
  }

  async buildLineupRegistrationMap(ids: Array<string | null>) {
    const compactIds = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.startsWith('lineup:')))];
    if (!compactIds.length) return new Map<string, any>();
    const pairs = compactIds.map((id) => this.parseLineupSlotId(id));
    const teamIds = [...new Set(pairs.map((pair) => pair.teamId))];
    const itemIds = [...new Set(pairs.map((pair) => pair.teamCompetitionItemId))];
    const lineups = await this.prisma.teamLineup.findMany({
      where: {
        teamId: { in: teamIds },
        teamCompetitionItemId: { in: itemIds },
      },
      include: {
        player1: true,
        player2: true,
        team: true,
        teamCompetitionItem: true,
      },
    });

    const map = new Map<string, any>();
    for (const lineup of lineups) {
      map.set(this.lineupSlotId(lineup.teamId, lineup.teamCompetitionItemId), {
        id: this.lineupSlotId(lineup.teamId, lineup.teamCompetitionItemId),
        teamId: lineup.teamId,
        name: lineup.player2
          ? `${lineup.player1.name} / ${lineup.player2.name}`
          : lineup.player1.name,
        affiliation: lineup.player2
          ? `${lineup.player1.affiliation} / ${lineup.player2.affiliation}`
          : lineup.player1.affiliation,
        playerIds: [lineup.player1Id, lineup.player2Id].filter(Boolean),
        players: [
          { id: lineup.player1Id, name: lineup.player1.name, affiliation: lineup.player1.affiliation },
          lineup.player2
            ? { id: lineup.player2Id, name: lineup.player2.name, affiliation: lineup.player2.affiliation }
            : null,
        ].filter(Boolean),
        teamName: lineup.team.name,
        eventType: lineup.teamCompetitionItem.eventType,
      });
    }
    return map;
  }

  async buildTeamLineupPlayerMap(matchIds: string[]) {
    const lineups = await this.prisma.teamLineup.findMany({
      where: { teamMatchId: { in: matchIds } },
      include: { player1: true, player2: true },
    });
    const map = new Map<string, string[]>();
    for (const lineup of lineups) {
      map.set(this.lineupSlotId(lineup.teamId, lineup.teamCompetitionItemId), [
        lineup.player1Id,
        lineup.player2Id,
      ].filter(Boolean) as string[]);
    }
    return map;
  }

  private async ensureTournament(id: string) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id } });
    if (!tournament) throw new NotFoundException('赛事不存在');
    return tournament;
  }

  private async ensureCompetition(id: string) {
    const competition = await this.prisma.teamCompetition.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!competition) throw new NotFoundException('团体赛不存在');
    return competition;
  }

  private async ensureTeam(id: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        members: { include: { player: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!team) throw new NotFoundException('队伍不存在');
    return team;
  }

  private async ensureTeamMatch(id: string) {
    const teamMatch = await this.prisma.teamMatch.findUnique({
      where: { id },
      include: {
        teamCompetition: { include: { items: { orderBy: { sortOrder: 'asc' } } } },
        team1: true,
        team2: true,
      },
    });
    if (!teamMatch) throw new NotFoundException('团体赛对阵不存在');
    return teamMatch;
  }

  private async getCompetitionDetail(id: string) {
    const competition = await this.prisma.teamCompetition.findUnique({
      where: { id },
      include: {
        tournament: true,
        items: { orderBy: { sortOrder: 'asc' } },
        teams: {
          include: {
            members: {
              include: {
                player: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        teamMatches: {
          include: {
            team1: true,
            team2: true,
            winnerTeam: true,
            matches: {
              include: {
                teamCompetitionItem: true,
                referee: { select: { id: true, username: true } },
                venue: true,
                games: { orderBy: { gameNo: 'asc' } },
              },
              orderBy: { matchNo: 'asc' },
            },
            lineups: {
              include: {
                teamCompetitionItem: true,
                player1: true,
                player2: true,
                team: true,
              },
            },
          },
          orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
        },
      },
    });
    if (!competition) throw new NotFoundException('团体赛不存在');
    return competition;
  }

  private normalizeItems(items: TeamCompetitionItemDto[]) {
    const normalized = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
    const eventTypes = new Set<EventType>();
    const sortOrders = new Set<number>();
    for (const item of normalized) {
      if (eventTypes.has(item.eventType)) {
        throw new ConflictException(`项目 ${EVENT_TYPE_LABELS[item.eventType]} 重复`);
      }
      if (sortOrders.has(item.sortOrder)) {
        throw new ConflictException(`出场顺序 ${item.sortOrder} 重复`);
      }
      eventTypes.add(item.eventType);
      sortOrders.add(item.sortOrder);
    }
    return normalized;
  }

  private ensureWinThreshold(winThreshold: number, itemCount?: number) {
    if (itemCount !== undefined && winThreshold > itemCount) {
      throw new BadRequestException('胜场阈值不能大于项目数');
    }
  }

  private uniquePlayerIds(playerIds: string[]) {
    const uniqueIds = [...new Set(playerIds.filter(Boolean))];
    if (uniqueIds.length !== playerIds.length) {
      throw new ConflictException('同一队伍不能重复添加同一位队员');
    }
    return uniqueIds;
  }

  private async ensureMinimumTeamSize(count: number) {
    if (count < 10) {
      throw new BadRequestException('每队至少 10 人');
    }
  }

  private async loadPlayers(playerIds: string[]) {
    const players = await this.prisma.player.findMany({
      where: { id: { in: playerIds } },
      include: { teamMembers: { include: { team: true } } },
    });
    if (players.length !== playerIds.length) {
      throw new NotFoundException('存在无效的选手');
    }
    return players;
  }

  private ensureSingleCompetitionMembership(players: any[], teamCompetitionId: string, teamId?: string) {
    for (const player of players) {
      const conflict = player.teamMembers.find(
        (member: { team: { teamCompetitionId: string; id: string } }) =>
          member.team.teamCompetitionId === teamCompetitionId && member.team.id !== teamId,
      );
      if (conflict) {
        throw new ConflictException(`选手 ${player.name} 已属于当前团体赛中的其他队伍`);
      }
    }
  }

  private parseQuickAssignments(prompt: string): ParsedQuickAssignment[] {
    const segments = prompt
      .split(/[，,；;\n]+/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (!segments.length) {
      throw new BadRequestException('快速录入内容不能为空');
    }

    return segments.map((segment) => {
      const [rawLabel, ...rest] = segment.split(/\s+/).filter(Boolean);
      const eventType = this.quickEventType(rawLabel);
      const names = rest.map((item) => item.trim()).filter(Boolean);
      if (!names.length) {
        throw new BadRequestException(`项目 ${rawLabel} 缺少选手姓名`);
      }
      if (this.isDoubles(eventType) && names.length < 2) {
        throw new BadRequestException(`项目 ${rawLabel} 需要至少 2 名选手`);
      }
      if (!this.isDoubles(eventType) && names.length !== 1) {
        throw new BadRequestException(`项目 ${rawLabel} 只能填写 1 名选手`);
      }
      return { eventType, names };
    });
  }

  private quickEventType(rawLabel: string) {
    const normalized = rawLabel.replace(/[:：]/g, '').trim();
    const mapping = QUICK_LABEL_MAP.find((item) => item.pattern.test(normalized));
    if (!mapping) throw new BadRequestException(`无法识别的项目标签：${rawLabel}`);
    return mapping.eventType;
  }

  private guessGenderFromName(_name: string): Gender {
    return Gender.MALE;
  }

  private shuffle<T>(items: T[]) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  private nextPowerOfTwo(value: number) {
    let size = 1;
    while (size < value) size *= 2;
    return size;
  }

  private roundLabel(slotCount: number) {
    if (slotCount === 2) return 'F';
    if (slotCount === 4) return 'SF';
    if (slotCount === 8) return 'QF';
    return `R${slotCount}`;
  }

  private async teamMemberMap(teamIds: string[]) {
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: { in: teamIds } },
    });
    const map = new Map<string, Set<string>>();
    for (const teamId of teamIds) map.set(teamId, new Set<string>());
    for (const member of members) {
      map.get(member.teamId)?.add(member.playerId);
    }
    return map;
  }

  private validateLineupPlayers(eventType: EventType, player1Id: string, player2Id?: string | null) {
    if (player1Id === player2Id) {
      throw new BadRequestException('同一项目中不能重复选择同一位队员');
    }
    if (this.isDoubles(eventType) && !player2Id) {
      throw new BadRequestException(`${EVENT_TYPE_LABELS[eventType]} 需要 2 名队员`);
    }
    if (!this.isDoubles(eventType) && player2Id) {
      throw new BadRequestException(`${EVENT_TYPE_LABELS[eventType]} 只能选择 1 名队员`);
    }
  }

  private isDoubles(eventType: EventType) {
    return ['MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES'].includes(eventType);
  }

  private lineupSlotId(teamId: string, teamCompetitionItemId: string) {
    return `lineup:${teamId}:${teamCompetitionItemId}`;
  }

  private parseLineupSlotId(value: string) {
    const match = /^lineup:([^:]+):([^:]+)$/.exec(value);
    if (!match) {
      throw new BadRequestException(`无效的团体赛出场槽位：${value}`);
    }
    return { teamId: match[1], teamCompetitionItemId: match[2] };
  }

  private toCompetitionView(competition: TeamCompetitionDetail) {
    return {
      id: competition.id,
      tournamentId: competition.tournamentId,
      tournament: competition.tournament,
      name: competition.name,
      description: competition.description,
      winThreshold: competition.winThreshold,
      isPublished: competition.isPublished,
      items: competition.items.map((item) => ({
        id: item.id,
        eventType: item.eventType,
        eventTypeLabel: EVENT_TYPE_LABELS[item.eventType],
        sortOrder: item.sortOrder,
      })),
      teams: competition.teams.map((team) => this.toTeamView(team)),
      teamMatches: competition.teamMatches.map((teamMatch) => ({
        id: teamMatch.id,
        round: teamMatch.round,
        roundNo: teamMatch.roundNo,
        matchNo: teamMatch.matchNo,
        status: teamMatch.status,
        winnerTeamId: teamMatch.winnerTeamId,
        winnerTeamName: teamMatch.winnerTeam?.name ?? null,
        team1: teamMatch.team1,
        team2: teamMatch.team2,
        team1Wins: teamMatch.team1Wins,
        team2Wins: teamMatch.team2Wins,
        lineupLocked: teamMatch.lineupLocked,
        lineups: teamMatch.lineups.map((lineup) => this.toLineupView(lineup)),
        matches: teamMatch.matches.map((match) => ({
          id: match.id,
          round: match.round,
          roundNo: match.roundNo,
          matchNo: match.matchNo,
          status: match.status,
          winnerSide: match.winnerSide,
          side1Id: match.side1Id,
          side2Id: match.side2Id,
          referee: match.referee,
          venue: match.venue,
          scheduledAt: match.scheduledAt,
          durationMinutes: match.durationMinutes,
          eventType: match.teamCompetitionItem?.eventType ?? null,
          eventTypeLabel: match.teamCompetitionItem?.eventType
            ? EVENT_TYPE_LABELS[match.teamCompetitionItem.eventType as EventType]
            : null,
          games: match.games,
        })),
      })),
      createdAt: competition.createdAt,
      updatedAt: competition.updatedAt,
    };
  }

  private toTeamView(team: TeamWithMembers) {
    return {
      id: team.id,
      teamCompetitionId: team.teamCompetitionId,
      name: team.name,
      affiliation: team.affiliation,
      notes: team.notes,
      memberCount: team.members.length,
      members: team.members.map((member) => ({
        id: member.player.id,
        name: member.player.name,
        gender: member.player.gender,
        affiliation: member.player.affiliation,
        contact: member.player.contact,
        notes: member.player.notes,
      })),
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    };
  }

  private toLineupView(
    lineup: TeamLineup & {
      teamCompetitionItem: TeamCompetitionItem;
      player1: { id: string; name: string; affiliation: string };
      player2: { id: string; name: string; affiliation: string } | null;
      team: { id: string; name: string };
    },
  ) {
    return {
      id: lineup.id,
      teamId: lineup.teamId,
      teamName: lineup.team.name,
      teamCompetitionItemId: lineup.teamCompetitionItemId,
      eventType: lineup.teamCompetitionItem.eventType,
      eventTypeLabel: EVENT_TYPE_LABELS[lineup.teamCompetitionItem.eventType],
      slotId: this.lineupSlotId(lineup.teamId, lineup.teamCompetitionItemId),
      player1: lineup.player1,
      player2: lineup.player2,
      name: lineup.player2
        ? `${lineup.player1.name} / ${lineup.player2.name}`
        : lineup.player1.name,
      affiliation: lineup.player2
        ? `${lineup.player1.affiliation} / ${lineup.player2.affiliation}`
        : lineup.player1.affiliation,
    };
  }

  private toPublicCompetitionView(competition: any) {
    return {
      id: competition.id,
      tournamentId: competition.tournamentId,
      tournamentName: competition.tournament.name,
      tournamentEdition: competition.tournament.edition,
      name: competition.name,
      description: competition.description,
      winThreshold: competition.winThreshold,
      items: competition.items.map((item: TeamCompetitionItem) => ({
        id: item.id,
        eventType: item.eventType,
        eventTypeLabel: EVENT_TYPE_LABELS[item.eventType],
        sortOrder: item.sortOrder,
      })),
      teams: competition.teams.map((team: any) => ({
        id: team.id,
        name: team.name,
        affiliation: team.affiliation,
        memberCount: team.members.length,
      })),
      teamMatches: competition.teamMatches.map((teamMatch: any) => ({
        id: teamMatch.id,
        round: teamMatch.round,
        roundNo: teamMatch.roundNo,
        matchNo: teamMatch.matchNo,
        status: teamMatch.status,
        team1: teamMatch.team1,
        team2: teamMatch.team2,
        winnerTeamId: teamMatch.winnerTeamId,
        winnerTeamName: teamMatch.winnerTeam?.name ?? null,
        team1Wins: teamMatch.team1Wins,
        team2Wins: teamMatch.team2Wins,
        matches: teamMatch.matches.map((match: any) => ({
          id: match.id,
          status: match.status,
          round: match.round,
          roundNo: match.roundNo,
          matchNo: match.matchNo,
          scheduledAt: match.scheduledAt,
          venueName: match.venue?.name ?? '待排场地',
          eventType: match.teamCompetitionItem?.eventType ?? null,
          eventTypeLabel: match.teamCompetitionItem?.eventType
            ? EVENT_TYPE_LABELS[match.teamCompetitionItem.eventType as EventType]
            : null,
          score: match.games.length
            ? `${match.games.at(-1)?.side1Score ?? 0}:${match.games.at(-1)?.side2Score ?? 0}`
            : '0:0',
          gamesText: match.games.length
            ? match.games.map((game: any) => `${game.side1Score}:${game.side2Score}`).join(' / ')
            : '-',
          winnerSide: match.winnerSide,
        })),
      })),
    };
  }
}
