import { AuthActor, playerScope, tournamentScope } from '../auth/admin-scope';
import { validateTeamRoster } from './team-roster';
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
  AddTeamPlayersDto,
  BatchImportTeamsDto,
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
  TeamCompetitionFormat,
  UpdateTeamCompetitionDto,
  UpdateTeamDto,
  GenerateGroupDrawDto,
  AdjustGroupsDto,
  GenerateKnockoutFromGroupsDto,
} from './dto/team-competition.dto';
import {
  generateRoundRobin,
  distributeTeamsToGroups,
  validateRoundRobin,
  TeamSlot,
} from './group-round-robin';
import {
  calculateGroupStandings,
  markAdvancedTeams,
  updateTeamStanding,
  TeamStanding,
} from './group-standings';

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
    this.validateScoring(dto);

    return this.prisma.teamCompetition.create({
      data: {
        tournamentId: dto.tournamentId,
        name: dto.name,
        description: dto.description,
        winThreshold: dto.winThreshold,
        maxPlayerAppearances: dto.maxPlayerAppearances ?? 2,
        playAllMatches: dto.playAllMatches ?? false,
        ...this.formatData(dto),
        ...this.scoringData(dto),
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

  list(tournamentId?: string, actor?: AuthActor) {
    return this.prisma.teamCompetition.findMany({
      where: { tournamentId, tournament: tournamentScope(actor) },
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
    this.ensureWinThreshold(dto.winThreshold ?? current.winThreshold, nextItems?.length ?? current.items.length);
    this.validateScoring({ ...current, ...dto });

    const rulesChanged = (dto.winThreshold !== undefined && dto.winThreshold !== current.winThreshold)
      || (dto.maxPlayerAppearances !== undefined && dto.maxPlayerAppearances !== current.maxPlayerAppearances)
      || (dto.playAllMatches !== undefined && dto.playAllMatches !== current.playAllMatches)
      || Object.entries(this.formatData(dto)).some(([key, value]) => value !== current[key as keyof typeof current])
      || Object.entries(this.scoringData(dto)).some(([key, value]) => value !== undefined && value !== current[key as keyof typeof current]);
    const itemsChanged = nextItems && JSON.stringify(nextItems.map(i => [i.eventType, i.sortOrder])) !== JSON.stringify(current.items.map(i => [i.eventType, i.sortOrder]));
    if ((rulesChanged || itemsChanged) && await this.prisma.teamMatch.count({ where: { teamCompetitionId: id } })) {
      throw new ConflictException('已生成对阵后不能修改赛制、兼项、胜场、计分规则或项目顺序');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.teamCompetition.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.winThreshold !== undefined ? { winThreshold: dto.winThreshold } : {}),
          ...(dto.maxPlayerAppearances !== undefined ? { maxPlayerAppearances: dto.maxPlayerAppearances } : {}),
          ...(dto.playAllMatches !== undefined ? { playAllMatches: dto.playAllMatches } : {}),
          ...this.formatData(dto),
          ...this.scoringData(dto),
          ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
        },
      });

      if (nextItems && itemsChanged) {
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return this.findOne(id);
  }

  async remove(id: string) {
    await this.ensureCompetition(id);
    return this.prisma.teamCompetition.delete({ where: { id } });
  }

  async createTeam(teamCompetitionId: string, dto: CreateTeamDto, actor?: AuthActor) {
    await this.ensureCompetition(teamCompetitionId);
    const playerIds = this.uniquePlayerIds(dto.playerIds);
    const players = await this.loadPlayers(playerIds, actor);
    validateTeamRoster(players);
    await this.ensureRosterEditable(teamCompetitionId);
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

  async availablePlayers(teamCompetitionId: string, actor: AuthActor) {
    await this.ensureCompetition(teamCompetitionId);
    return this.prisma.player.findMany({
      where: { ...playerScope(actor), isTemporary: false },
      select: { id: true, name: true, gender: true, affiliation: true },
      orderBy: { createdAt: 'desc' },
    });
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

  async replaceTeamMembers(teamId: string, dto: ReplaceTeamMembersDto, actor?: AuthActor) {
    if (!dto.overrideConfirmed) throw new ConflictException('队员名单原则上不能更改，请确认例外调整后再提交');
    const team = await this.ensureTeam(teamId);
    const playerIds = this.uniquePlayerIds(dto.playerIds);
    const players = await this.loadPlayers(playerIds, actor);
    this.ensureSingleCompetitionMembership(players, team.teamCompetitionId, team.id);

    await this.prisma.$transaction(async (tx) => {
      const removed = team.members.filter(member => !playerIds.includes(member.playerId)).map(member => member.playerId);
      const referenced = removed.length ? await tx.teamLineup.findMany({ where: {
        teamId, OR: [{ player1Id: { in: removed } }, { player2Id: { in: removed } }],
        teamMatch: { status: { in: [MatchStatus.PENDING, MatchStatus.LIVE] } },
      }, include: { teamMatch: { select: { matches: {
        where: { status: { in: [MatchStatus.PENDING, MatchStatus.LIVE] } }, select: { teamCompetitionItemId: true },
      } } } } }) : [];
      if (referenced.some(lineup => lineup.teamMatch.matches.some(match => match.teamCompetitionItemId === lineup.teamCompetitionItemId))) {
        throw new ConflictException('移除的队员仍在未结束的子项名单中，请先调整对应子项名单');
      }
      await tx.teamMember.deleteMany({ where: { teamId } });
      await tx.teamMember.createMany({
        data: playerIds.map((playerId) => ({ teamId, playerId })),
      });
      await tx.team.update({ where: { id: teamId }, data: { rosterOverrideConfirmed: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return this.prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      include: {
        members: { include: { player: true }, orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async addTeamPlayers(teamId: string, dto: AddTeamPlayersDto, actor: AuthActor) {
    if (!dto.overrideConfirmed) throw new ConflictException('临时补充队员须先确认例外调整');
    await this.ensureTeam(teamId);
    await this.prisma.$transaction(async tx => {
      for (const player of dto.players) {
        const created = await tx.player.create({ data: { ...player, ownerId: actor.id } });
        await tx.teamMember.create({ data: { teamId, playerId: created.id } });
      }
      await tx.team.update({ where: { id: teamId }, data: { rosterOverrideConfirmed: true } });
    });
    return this.ensureTeam(teamId);
  }

  async removeTeam(teamId: string) {
    const team = await this.ensureTeam(teamId);
    await this.ensureRosterEditable(team.teamCompetitionId);
    return this.prisma.team.delete({ where: { id: teamId } });
  }

  async importTeamPlayers(teamCompetitionId: string, dto: ImportTeamPlayersDto, actor?: AuthActor) {
    await this.ensureCompetition(teamCompetitionId);
    validateTeamRoster(dto.players);
    await this.ensureRosterEditable(teamCompetitionId);

    return this.prisma.$transaction(async (tx) => {
      const createdPlayers = [] as Array<{ id: string }>;
      for (const player of dto.players) {
        const created = await tx.player.create({
          data: {
            name: player.name,
            ownerId: actor?.id,
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async batchImportTeams(teamCompetitionId: string, dto: BatchImportTeamsDto, actor: AuthActor) {
    // Share the competition lock with draw generation; validate the entire batch before writing.
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM TeamCompetition WHERE id = ${teamCompetitionId} FOR UPDATE`;
      const competition = await tx.teamCompetition.findUnique({ where: { id: teamCompetitionId } });
      if (!competition) throw new NotFoundException('团体赛不存在');
      if (await tx.teamMatch.count({ where: { teamCompetitionId } })) {
        throw new ConflictException('已生成对阵，不能批量新增队伍；临时补充人员请使用队伍的例外调整按钮');
      }
      const groups = new Map<string, BatchImportTeamsDto['players']>();
      for (const [index, input] of dto.players.entries()) {
        const row = { ...input, teamName: input.teamName.trim(), name: input.name.trim(), lineNumber: input.lineNumber ?? index + 1 };
        if (!row.teamName || !row.name) throw new BadRequestException(`第 ${row.lineNumber} 行团体名称和姓名不能为空`);
        const rows = groups.get(row.teamName) ?? [];
        rows.push(row);
        groups.set(row.teamName, rows);
      }
      const existing = await tx.team.findMany({ where: { teamCompetitionId }, select: { name: true } });
      const existingNames = new Set(existing.map(team => team.name.trim().toLocaleLowerCase()));
      for (const [name, rows] of groups) {
        if (existingNames.has(name.toLocaleLowerCase())) throw new ConflictException(`团体“${name}”已存在，请使用该队的例外调整入口`);
        existingNames.add(name.toLocaleLowerCase());
        try { validateTeamRoster(rows); }
        catch (error) { throw new BadRequestException(`团体“${name}”（第 ${rows.map(row => row.lineNumber).join('、')} 行）：${(error as Error).message}`); }
      }
      for (const [name, rows] of groups) {
        const team = await tx.team.create({ data: { teamCompetitionId, name, affiliation: rows.find(row => row.affiliation?.trim())?.affiliation?.trim() || name } });
        for (const row of rows) {
          const player = await tx.player.create({ data: { name: row.name, gender: row.gender, affiliation: row.affiliation?.trim() || team.affiliation, contact: row.contact?.trim() || null, ownerId: actor.id } });
          await tx.teamMember.create({ data: { teamId: team.id, playerId: player.id } });
        }
      }
      return { teamCount: groups.size, playerCount: dto.players.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 });
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

  async createTeamFromQuickInput(_teamCompetitionId: string, _dto: ParseQuickTeamDto, _actor?: AuthActor) {
    throw new BadRequestException('请使用队员导入并明确性别，出场项目在赛前手动填报');
  }

  async generateDraw(teamCompetitionId: string, dto: GenerateTeamDrawDto) {
    // 小组赛制统一走小组抽签
    const current = await this.prisma.teamCompetition.findUnique({ where: { id: teamCompetitionId }, select: { format: true } });
    if (current && current.format !== TeamCompetitionFormat.SINGLE_ELIMINATION) {
      return this.generateGroupDraw(teamCompetitionId, { force: dto.force });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM TeamCompetition WHERE id = ${teamCompetitionId} FOR UPDATE`;
      const competition = await tx.teamCompetition.findUnique({ where: { id: teamCompetitionId }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
      if (!competition) throw new NotFoundException('团体赛不存在');
      const teams = await tx.team.findMany({
        where: { teamCompetitionId }, include: { members: { include: { player: true } } }, orderBy: { createdAt: 'asc' },
      });
      if (teams.length < 2) throw new BadRequestException('至少需要 2 支队伍才能生成团体对阵');
      for (const team of teams) validateTeamRoster(team.members.map(m => m.player));
      const existing = await tx.teamMatch.count({ where: { teamCompetitionId } });
      if (existing && !dto.force) throw new ConflictException('团体对阵已存在，请使用重新生成');
      const played = await tx.match.count({ where: { teamMatch: { teamCompetitionId }, OR: [
        { status: { not: MatchStatus.PENDING } }, { startedAt: { not: null } }, { games: { some: {} } },
      ] } });
      if (played) throw new ConflictException('已有子项开赛或成绩，不能重新生成对阵');
      await tx.teamMatch.deleteMany({ where: { teamCompetitionId } });
      await tx.teamGroup.deleteMany({ where: { teamCompetitionId } });
      const shuffled = this.shuffle(teams);
      const size = this.nextPowerOfTwo(shuffled.length);
      const byes = size - shuffled.length;
      let slots = this.byeSlots(shuffled.map(team => team.id), size, byes);
      let roundNo = 1;
      while (slots.length >= 2) {
        const next: typeof slots = [];
        for (let i = 0; i < slots.length; i += 2) {
          const a = slots[i], b = slots[i + 1];
          const bye = a.resolved && b.resolved && Boolean(a.id) !== Boolean(b.id);
          const winner = bye ? a.id ?? b.id : null;
          const encounter = await tx.teamMatch.create({ data: {
            teamCompetitionId, round: this.roundLabel(slots.length), roundNo, matchNo: i / 2 + 1,
            team1Id: a.id, team2Id: b.id, winnerTeamId: winner, stage: 'KNOCKOUT',
            status: bye ? MatchStatus.COMPLETED : MatchStatus.PENDING,
          } });
          if (a.id && b.id) await this.createEncounterMatches(tx, encounter, competition.items);
          next.push({ id: winner, resolved: bye });
        }
        slots = next;
        roundNo++;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return this.findOne(teamCompetitionId);
  }

  private async createEncounterMatches(tx: Prisma.TransactionClient, encounter: TeamMatch, items: TeamCompetitionItem[]) {
    if (await tx.match.count({ where: { teamMatchId: encounter.id } })) return;
    await tx.match.createMany({ data: items.map((item, index) => ({
      teamMatchId: encounter.id, teamCompetitionItemId: item.id, round: encounter.round,
      roundNo: encounter.roundNo, matchNo: index + 1, status: MatchStatus.PENDING, durationMinutes: 45,
    })) });
  }

  private async advanceTeamWinner(tx: Prisma.TransactionClient, encounter: TeamMatch, winnerTeamId: string, items: TeamCompetitionItem[]) {
    // 小组赛只计积分，不向下一轮推进
    if (encounter.stage === 'GROUP') return;
    const next = await tx.teamMatch.findUnique({ where: { teamCompetitionId_roundNo_matchNo: {
      teamCompetitionId: encounter.teamCompetitionId, roundNo: encounter.roundNo + 1, matchNo: Math.ceil(encounter.matchNo / 2),
    } } });
    if (!next) return;
    await this.lockEncounter(tx, next.id);
    const key = encounter.matchNo % 2 === 1 ? 'team1Id' : 'team2Id';
    const updated = await tx.teamMatch.update({ where: { id: next.id }, data: { [key]: winnerTeamId } });
    if (updated.team1Id && updated.team2Id) await this.createEncounterMatches(tx, updated, items);
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
    await this.prisma.$transaction(async (tx) => {
      await this.lockEncounter(tx, teamMatchId);
      const encounter = await tx.teamMatch.findUnique({
        where: { id: teamMatchId },
        include: { matches: { include: { teamCompetitionItem: true, games: true } }, lineups: true, teamCompetition: { include: { items: true } } },
      });
      if (!encounter) throw new NotFoundException('团体对阵不存在');
      if (encounter.status === MatchStatus.COMPLETED || encounter.status === MatchStatus.CANCELLED) {
      throw new ConflictException('团体对阵已结束，不能修改名单或继续比赛');
      }
      if (!encounter.team1Id || !encounter.team2Id) throw new BadRequestException('请等待双方队伍确定后填报名单');
      const members = await tx.teamMember.findMany({
        where: { teamId: { in: [encounter.team1Id, encounter.team2Id] } }, include: { player: true },
      });
      const seen = new Set<string>();
      const merged = new Map(encounter.lineups.map(l => [`${l.teamId}:${l.teamCompetitionItemId}`, {
        teamId: l.teamId, teamCompetitionItemId: l.teamCompetitionItemId, player1Id: l.player1Id, player2Id: l.player2Id,
      }]));
      const affected = new Set<string>();
      for (const selection of dto.selections) {
        const key = `${selection.teamId}:${selection.teamCompetitionItemId}`;
        if (seen.has(key)) throw new BadRequestException('同一队伍同一项目只能填报一次');
        seen.add(key);
        if (![encounter.team1Id, encounter.team2Id].includes(selection.teamId)) throw new BadRequestException('队伍不属于该对阵');
        const match = encounter.matches.find(m => m.teamCompetitionItemId === selection.teamCompetitionItemId);
        if (!match?.teamCompetitionItem) throw new BadRequestException('出场项目不属于该对阵');
        if (match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED) throw new ConflictException('已结束子项保留原出场记录，不能换人');
        if (!dto.overrideConfirmed && (match.status !== MatchStatus.PENDING || match.startedAt || match.lineupLocked || match.games.length)) {
          throw new ConflictException('本项名单已锁定或比赛已开始，须确认例外换人');
        }
        this.validateLineupPlayers(match.teamCompetitionItem.eventType, selection.player1Id, selection.player2Id);
        const players = [selection.player1Id, selection.player2Id].filter(Boolean).map(id => {
          const member = members.find(m => m.teamId === selection.teamId && m.playerId === id);
          if (!member) throw new BadRequestException('出场选手必须属于对应队伍');
          return member.player;
        });
        const genders = players.map(p => p.gender);
        const type = match.teamCompetitionItem.eventType;
        if ((type.startsWith('MENS_') && genders.some(g => g !== Gender.MALE))
          || (type.startsWith('WOMENS_') && genders.some(g => g !== Gender.FEMALE))
          || (type === EventType.MIXED_DOUBLES && new Set(genders).size !== 2)) {
          throw new BadRequestException(`${EVENT_TYPE_LABELS[type]}的选手性别不符合项目要求`);
        }
        merged.set(key, { ...selection, player2Id: selection.player2Id ?? null });
        affected.add(match.id);
      }
      const usage = new Map<string, number>();
      for (const row of merged.values()) {
        for (const id of [row.player1Id, row.player2Id].filter(Boolean) as string[]) usage.set(id, (usage.get(id) ?? 0) + 1);
      }
      const limit = encounter.teamCompetition.maxPlayerAppearances;
      if (limit > 0 && [...usage.values()].some(count => count > limit)) {
        throw new ConflictException(limit === 1
          ? '本团体赛不允许兼项，每位队员在同一场团体对阵中只能参加 1 个项目'
          : '每位队员在同一场团体对阵中最多兼任 2 个项目');
      }
      for (const selection of dto.selections) {
        await tx.teamLineup.upsert({
          where: { teamMatchId_teamCompetitionItemId_teamId: { teamMatchId, teamCompetitionItemId: selection.teamCompetitionItemId, teamId: selection.teamId } },
          create: { teamMatchId, ...selection, player2Id: selection.player2Id ?? null },
          update: { player1Id: selection.player1Id, player2Id: selection.player2Id ?? null },
        });
      }
      for (const match of encounter.matches.filter(m => affected.has(m.id))) {
        const a = merged.get(`${encounter.team1Id}:${match.teamCompetitionItemId}`);
        const b = merged.get(`${encounter.team2Id}:${match.teamCompetitionItemId}`);
        if (dto.lock && (!a || !b)) throw new BadRequestException('锁定前须填齐本项双方出场名单');
        await tx.match.update({ where: { id: match.id }, data: {
          side1Id: a ? this.lineupSlotId(a.teamId, a.teamCompetitionItemId, teamMatchId) : null,
          side2Id: b ? this.lineupSlotId(b.teamId, b.teamCompetitionItemId, teamMatchId) : null,
          ...(dto.lock ? { lineupLocked: true } : {}),
        } });
        if (dto.overrideConfirmed) await tx.matchEvent.create({ data: { matchId: match.id, type: 'WARNING', note: `确认例外换人：${dto.selections.filter(s => s.teamCompetitionItemId === match.teamCompetitionItemId).map(s => [s.player1Id, s.player2Id].filter(Boolean).join('/')).join(' VS ')}` } });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return this.getTeamMatchLineups(teamMatchId);
  }

  private async lockEncounter(tx: Prisma.TransactionClient, teamMatchId: string) {
    await tx.$queryRaw`SELECT id FROM TeamMatch WHERE id = ${teamMatchId} FOR UPDATE`;
  }

  async prepareScoring(tx: Prisma.TransactionClient, matchId: string, options: { starting?: boolean; correcting?: boolean } = {}) {
    const ref = await tx.match.findUnique({ where: { id: matchId }, select: { teamMatchId: true } });
    if (!ref?.teamMatchId) return;
    await this.lockEncounter(tx, ref.teamMatchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId }, include: { teamMatch: { include: { matches: true } } } });
    const encounter = match.teamMatch!;
    if (!options.correcting && (encounter.status === MatchStatus.COMPLETED || encounter.status === MatchStatus.CANCELLED)) {
      throw new ConflictException('团体对阵已结束，不能修改名单或继续比赛');
    }
    if (match.status === MatchStatus.CANCELLED) throw new ConflictException('本项已取消，无需比赛');
    if (!options.correcting && match.status === MatchStatus.COMPLETED) throw new ConflictException('本项已结束');
    if (!match.lineupLocked || !match.side1Id || !match.side2Id) throw new ConflictException('请先填齐并锁定本项双方名单');
    if (options.starting) {
      if (match.status !== MatchStatus.PENDING) throw new ConflictException('本项已开始或结束');
      if (encounter.matches.some(m => m.matchNo < match.matchNo && m.status !== MatchStatus.COMPLETED && m.status !== MatchStatus.CANCELLED)) {
        throw new ConflictException('请按项目顺序比赛，先完成前面的子项');
      }
    }
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
        tournament: { isPublished: true, approvalStatus: 'APPROVED', isArchived: false },
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
    // The first team to reach the target wins, even when later sub-event
    // results bring both teams above a configured target below the majority.
    const runningWins = [0, 0];
    for (const item of finished) {
      const side = item.winnerSide! - 1;
      runningWins[side] += 1;
      if (runningWins[side] >= teamMatch.teamCompetition.winThreshold) {
        winnerTeamId = side === 0 ? teamMatch.team1Id : teamMatch.team2Id;
        break;
      }
    }
    const allFinished = teamMatch.matches.every(item => item.status === MatchStatus.COMPLETED || item.status === MatchStatus.CANCELLED);
    if (winnerTeamId && (!teamMatch.teamCompetition.playAllMatches || allFinished)) {
      nextStatus = MatchStatus.COMPLETED;
    } else if (finished.length > 0 || teamMatch.matches.some(item => item.status === MatchStatus.LIVE)) {
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

    // 小组赛：结果任何变化都重算积分（含改分后从已完成退回进行中）
    if (teamMatch.groupId) await this.updateGroupStandings(tx, teamMatch.id);

    if (winnerTeamId && nextStatus === MatchStatus.COMPLETED) {
      await this.advanceTeamWinner(tx, teamMatch, winnerTeamId, teamMatch.teamCompetition.items);
      const remainingMatchIds = teamMatch.matches
        .filter((item) => item.status === MatchStatus.PENDING || item.status === MatchStatus.LIVE)
        .map((item) => item.id);
      if (remainingMatchIds.length) {
        await tx.match.updateMany({
          where: { id: { in: remainingMatchIds } },
          data: { status: MatchStatus.CANCELLED, winnerSide: null, finishedAt: new Date() },
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
        OR: pairs.map(pair => ({ teamId: pair.teamId, teamCompetitionItemId: pair.teamCompetitionItemId, ...(pair.teamMatchId ? { teamMatchId: pair.teamMatchId } : {}) })),
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
      map.set(this.lineupSlotId(lineup.teamId, lineup.teamCompetitionItemId, lineup.teamMatchId), {
        id: this.lineupSlotId(lineup.teamId, lineup.teamCompetitionItemId, lineup.teamMatchId),
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
    for (const pair of pairs.filter(p => !p.teamMatchId)) {
      const candidates = lineups.filter(l => l.teamId === pair.teamId && l.teamCompetitionItemId === pair.teamCompetitionItemId);
      if (candidates.length === 1) map.set(this.lineupSlotId(pair.teamId, pair.teamCompetitionItemId), map.get(this.lineupSlotId(pair.teamId, pair.teamCompetitionItemId, candidates[0].teamMatchId)));
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
      map.set(this.lineupSlotId(lineup.teamId, lineup.teamCompetitionItemId, lineup.teamMatchId), [
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
    if (!Number.isInteger(winThreshold) || winThreshold < 1 || (itemCount !== undefined && 2 * winThreshold - 1 > itemCount)) {
      throw new BadRequestException('项目数不足以保证分出胜负：先赢 N 项至少需要安排 2N-1 个项目');
    }
  }

  private scoringData(dto: UpdateTeamCompetitionDto) {
    return { scoringRule: dto.scoringRule, scoringMode: dto.scoringMode, customGamePoint: dto.customGamePoint, customGameCap: dto.customGameCap, customGamesToWin: dto.customGamesToWin };
  }

  private validateScoring(dto: { scoringRule?: ScoringRule; customGamePoint?: number | null; customGameCap?: number | null }) {
    const point = dto.customGamePoint ?? ({ FIFTEEN_ONE: 15, FIFTEEN_BO3: 15, TWENTYONE_BO3: 21, THIRTYONE_BO3: 31 }[dto.scoringRule ?? ScoringRule.TWENTYONE_BO3]);
    if (dto.customGameCap && dto.customGameCap < point) {
      throw new BadRequestException('封顶分不能小于目标分');
    }
  }

  private uniquePlayerIds(playerIds: string[]) {
    const uniqueIds = [...new Set(playerIds.filter(Boolean))];
    if (uniqueIds.length !== playerIds.length) {
      throw new ConflictException('同一队伍不能重复添加同一位队员');
    }
    return uniqueIds;
  }

  private async ensureRosterEditable(teamCompetitionId: string) {
    if (await this.prisma.teamMatch.count({ where: { teamCompetitionId } })) {
      throw new ConflictException('已生成对阵后不能增删队伍或变更队员库，可在各子项开赛前调整出场选手');
    }
  }

  private async loadPlayers(playerIds: string[], actor?: AuthActor) {
    const players = await this.prisma.player.findMany({
      where: { id: { in: playerIds }, ...playerScope(actor) },
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

  /**
   * 首轮槽位：每个轮空只与一支队伍配对（不会出现轮空对轮空），
   * 并把有轮空的场次均匀分散到整个签表中。
   */
  private byeSlots(teamIds: string[], size: number, byes: number) {
    const pairs = size / 2;
    const byePairs = new Set<number>();
    for (let i = 0; i < byes; i++) byePairs.add(Math.floor((i * pairs) / byes));
    const slots: Array<{ id: string | null; resolved: boolean }> = [];
    let cursor = 0;
    for (let pair = 0; pair < pairs; pair++) {
      slots.push({ id: teamIds[cursor++], resolved: true });
      slots.push({ id: byePairs.has(pair) ? null : teamIds[cursor++], resolved: true });
    }
    return slots;
  }

  /** 只返回请求中明确给出的赛制字段 */
  private formatData(dto: { format?: TeamCompetitionFormat; groupCount?: number | null; advancePerGroup?: number | null }) {
    return {
      ...(dto.format !== undefined ? { format: dto.format } : {}),
      ...(dto.groupCount !== undefined ? { groupCount: dto.groupCount } : {}),
      ...(dto.advancePerGroup !== undefined ? { advancePerGroup: dto.advancePerGroup } : {}),
    };
  }

  /** 标准种子位：size=4 → [1,4,2,3]，size=8 → [1,8,4,5,2,7,3,6] */
  private seedPositions(size: number) {
    let order = [1];
    while (order.length < size) {
      const total = order.length * 2 + 1;
      order = order.flatMap(seed => [seed, total - seed]);
    }
    return order;
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

  private lineupSlotId(teamId: string, teamCompetitionItemId: string, teamMatchId?: string) {
    return teamMatchId ? `lineup:${teamMatchId}:${teamId}:${teamCompetitionItemId}` : `lineup:${teamId}:${teamCompetitionItemId}`;
  }

  private parseLineupSlotId(value: string) {
    const match = /^lineup:(?:([^:]+):)?([^:]+):([^:]+)$/.exec(value);
    if (!match) {
      throw new BadRequestException(`无效的团体赛出场槽位：${value}`);
    }
    return { teamMatchId: match[1], teamId: match[2], teamCompetitionItemId: match[3] };
  }

  private toCompetitionView(competition: TeamCompetitionDetail) {
    return {
      id: competition.id,
      tournamentId: competition.tournamentId,
      tournament: competition.tournament,
      name: competition.name,
      description: competition.description,
      winThreshold: competition.winThreshold,
      maxPlayerAppearances: competition.maxPlayerAppearances,
      playAllMatches: competition.playAllMatches,
      format: competition.format,
      groupCount: competition.groupCount,
      advancePerGroup: competition.advancePerGroup,
      malePlayerCount: competition.malePlayerCount,
      femalePlayerCount: competition.femalePlayerCount,
      scoringRule: competition.scoringRule,
      scoringMode: competition.scoringMode,
      customGamePoint: competition.customGamePoint,
      customGameCap: competition.customGameCap,
      customGamesToWin: competition.customGamesToWin,
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
        stage: teamMatch.stage,
        groupId: teamMatch.groupId,
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
          lineupLocked: match.lineupLocked,
          teamCompetitionItemId: match.teamCompetitionItemId,
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
      rosterOverrideConfirmed: team.rosterOverrideConfirmed,
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
      slotId: this.lineupSlotId(lineup.teamId, lineup.teamCompetitionItemId, lineup.teamMatchId),
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
      maxPlayerAppearances: competition.maxPlayerAppearances,
      playAllMatches: competition.playAllMatches,
      format: competition.format,
      groupCount: competition.groupCount,
      advancePerGroup: competition.advancePerGroup,
      malePlayerCount: competition.malePlayerCount,
      femalePlayerCount: competition.femalePlayerCount,
      scoringRule: competition.scoringRule,
      scoringMode: competition.scoringMode,
      customGamePoint: competition.customGamePoint,
      customGameCap: competition.customGameCap,
      customGamesToWin: competition.customGamesToWin,
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
        stage: teamMatch.stage,
        groupId: teamMatch.groupId,
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
          lineupLocked: match.lineupLocked,
          teamCompetitionItemId: match.teamCompetitionItemId,
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

  // ==================== 小组赛功能 ====================

  /**
   * 生成小组赛对阵
   */
  async generateGroupDraw(teamCompetitionId: string, dto: GenerateGroupDrawDto) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM TeamCompetition WHERE id = ${teamCompetitionId} FOR UPDATE`;
      
      const competition = await tx.teamCompetition.findUnique({
        where: { id: teamCompetitionId },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      
      if (!competition) {
        throw new NotFoundException('团体赛不存在');
      }

      const teams = await tx.team.findMany({
        where: { teamCompetitionId },
        include: { members: { include: { player: true } } },
        orderBy: { createdAt: 'asc' },
      });

      if (teams.length < 2) {
        throw new BadRequestException('至少需要 2 支队伍才能生成小组赛');
      }

      // 验证队伍名单
      for (const team of teams) {
        validateTeamRoster(team.members.map(m => m.player));
      }

      // 检查是否已有对阵
      const existing = await tx.teamMatch.count({ where: { teamCompetitionId } });
      if (existing && !dto.force) {
        throw new ConflictException('对阵已存在，请使用重新生成');
      }

      // 检查是否有比赛已开始
      const played = await tx.match.count({
        where: {
          teamMatch: { teamCompetitionId },
          OR: [
            { status: { not: MatchStatus.PENDING } },
            { startedAt: { not: null } },
            { games: { some: {} } },
          ],
        },
      });
      
      if (played) {
        throw new ConflictException('已有子项开赛或成绩，不能重新生成对阵');
      }

      // 删除现有对阵和小组
      await tx.teamMatch.deleteMany({ where: { teamCompetitionId } });
      await tx.teamGroup.deleteMany({ where: { teamCompetitionId } });

      const format = dto.format || competition.format;
      if (format === TeamCompetitionFormat.SINGLE_ELIMINATION) {
        throw new BadRequestException('单淘汰赛请使用淘汰赛抽签');
      }
      const groupCount = format === TeamCompetitionFormat.ROUND_ROBIN ? 1 : (dto.groupCount ?? competition.groupCount ?? 2);
      if (groupCount < 1 || teams.length < groupCount * 2) {
        throw new BadRequestException(`${teams.length} 支队伍不能分成 ${groupCount} 组（每组至少 2 队）`);
      }
      const advancePerGroup = dto.advancePerGroup ?? competition.advancePerGroup ?? null;
      if (format === TeamCompetitionFormat.GROUP_PLUS_KNOCKOUT) {
        const minGroupSize = Math.floor(teams.length / groupCount);
        if (!advancePerGroup || advancePerGroup < 1 || advancePerGroup > minGroupSize) {
          throw new BadRequestException(`每组出线数须在 1 到 ${minGroupSize} 之间`);
        }
        if (advancePerGroup * groupCount < 2) {
          throw new BadRequestException('出线队伍总数至少为 2 才能进行淘汰赛');
        }
      }

      const slots: TeamSlot[] = this.shuffle(teams).map(t => ({ id: t.id, name: t.name }));
      const distribution = groupCount === 1
        ? [{ groupNo: 1, groupName: '循环赛', teams: slots }]
        : distributeTeamsToGroups(slots, groupCount);
      await this.createGroupsWithFixtures(tx, competition.id, competition.items, distribution);

      await tx.teamCompetition.update({
        where: { id: teamCompetitionId },
        data: { format, groupCount, advancePerGroup },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return this.findOne(teamCompetitionId);
  }

  /**
   * 创建小组、组员及组内单循环对阵。
   * 同一轮次的对阵跨组连续编号，保证 (teamCompetitionId, roundNo, matchNo) 唯一。
   */
  private async createGroupsWithFixtures(
    tx: Prisma.TransactionClient,
    teamCompetitionId: string,
    items: TeamCompetitionItem[],
    distribution: Array<{ groupNo: number; groupName: string; teams: TeamSlot[] }>,
  ) {
    const nextMatchNo = new Map<number, number>();
    for (const groupDist of distribution) {
      const group = await tx.teamGroup.create({
        data: { teamCompetitionId, groupNo: groupDist.groupNo, groupName: groupDist.groupName },
      });
      await tx.teamGroupMember.createMany({
        data: groupDist.teams.map((team, index) => ({ groupId: group.id, teamId: team.id!, seedOrder: index + 1 })),
      });

      const rounds = generateRoundRobin(groupDist.teams);
      const validation = validateRoundRobin(groupDist.teams, rounds);
      if (!validation.valid) {
        throw new BadRequestException(`循环赛对阵生成失败：${validation.errors.join('；')}`);
      }

      for (const round of rounds) {
        for (const match of round.matches) {
          const matchNo = (nextMatchNo.get(round.roundNo) ?? 0) + 1;
          nextMatchNo.set(round.roundNo, matchNo);
          const encounter = await tx.teamMatch.create({
            data: {
              teamCompetitionId,
              groupId: group.id,
              stage: 'GROUP',
              round: distribution.length === 1 ? `第${round.roundNo}轮` : `${groupDist.groupName}第${round.roundNo}轮`,
              roundNo: round.roundNo,
              matchNo,
              team1Id: match.team1Id,
              team2Id: match.team2Id,
              status: MatchStatus.PENDING,
            },
          });
          await this.createEncounterMatches(tx, encounter, items);
        }
      }
    }
  }

  /**
   * 获取小组信息
   */
  async getGroups(teamCompetitionId: string) {
    const competition = await this.ensureCompetition(teamCompetitionId);
    
    const groups = await this.prisma.teamGroup.findMany({
      where: { teamCompetitionId },
      include: {
        teams: {
          include: {
            team: {
              include: {
                members: { include: { player: true } },
              },
            },
          },
          orderBy: [{ groupRank: 'asc' }, { wins: 'desc' }],
        },
        matches: {
          include: {
            team1: true,
            team2: true,
            matches: {
              include: {
                teamCompetitionItem: true,
                games: true,
              },
            },
          },
          orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
        },
      },
      orderBy: { groupNo: 'asc' },
    });

    return {
      competition: {
        id: competition.id,
        name: competition.name,
        format: competition.format,
        groupCount: competition.groupCount,
        advancePerGroup: competition.advancePerGroup,
      },
      groups: groups.map(group => ({
        id: group.id,
        groupNo: group.groupNo,
        groupName: group.groupName,
        standings: group.teams.map(member => ({
          teamId: member.teamId,
          teamName: member.team.name,
          wins: member.wins,
          losses: member.losses,
          matchesWon: member.matchesWon,
          matchesLost: member.matchesLost,
          netMatches: member.netMatches,
          groupRank: member.groupRank,
          advanced: member.advanced,
        })),
        matches: group.matches.map(match => ({
          id: match.id,
          round: match.round,
          roundNo: match.roundNo,
          matchNo: match.matchNo,
          team1: match.team1,
          team2: match.team2,
          team1Wins: match.team1Wins,
          team2Wins: match.team2Wins,
          status: match.status,
          winnerTeamId: match.winnerTeamId,
        })),
      })),
    };
  }

  /**
   * 获取小组积分榜
   */
  async getGroupStandings(teamCompetitionId: string, groupId: string) {
    await this.ensureCompetition(teamCompetitionId);
    
    const group = await this.prisma.teamGroup.findUnique({
      where: { id: groupId },
      include: {
        teams: {
          include: {
            team: true,
          },
          orderBy: [{ groupRank: 'asc' }, { wins: 'desc' }],
        },
      },
    });

    if (!group || group.teamCompetitionId !== teamCompetitionId) {
      throw new NotFoundException('小组不存在');
    }

    return {
      groupId: group.id,
      groupNo: group.groupNo,
      groupName: group.groupName,
      standings: group.teams.map(member => ({
        teamId: member.teamId,
        teamName: member.team.name,
        teamAffiliation: member.team.affiliation,
        wins: member.wins,
        losses: member.losses,
        matchesWon: member.matchesWon,
        matchesLost: member.matchesLost,
        netMatches: member.netMatches,
        groupRank: member.groupRank,
        advanced: member.advanced,
      })),
    };
  }

  /**
   * 重新计算小组积分（对阵结果变化后调用）。
   * 每次都从该组所有已完成对阵重新汇总，改分或重赛不会重复累计。
   */
  async updateGroupStandings(tx: Prisma.TransactionClient, teamMatchId: string) {
    const teamMatch = await tx.teamMatch.findUnique({ where: { id: teamMatchId }, select: { groupId: true } });
    if (!teamMatch?.groupId) return;
    await this.recalculateGroupRankings(tx, teamMatch.groupId);
  }

  private async recalculateGroupRankings(tx: Prisma.TransactionClient, groupId: string) {
    const members = await tx.teamGroupMember.findMany({ where: { groupId }, include: { team: true } });
    const encounters = await tx.teamMatch.findMany({
      where: { groupId, status: MatchStatus.COMPLETED, winnerTeamId: { not: null } },
    });

    const stats = new Map(members.map(m => [m.teamId, {
      teamId: m.teamId, teamName: m.team.name, wins: 0, losses: 0, matchesWon: 0, matchesLost: 0, netMatches: 0,
    }]));
    const h2h = new Map<string, { teamId: string; opponentId: string; wins: number; losses: number; matchesWon: number; matchesLost: number }>();
    const record = (teamId: string, opponentId: string, won: boolean, forCount: number, againstCount: number) => {
      const row = stats.get(teamId);
      if (row) {
        row.wins += won ? 1 : 0;
        row.losses += won ? 0 : 1;
        row.matchesWon += forCount;
        row.matchesLost += againstCount;
        row.netMatches += forCount - againstCount;
      }
      const key = `${teamId}:${opponentId}`;
      const pair = h2h.get(key) ?? { teamId, opponentId, wins: 0, losses: 0, matchesWon: 0, matchesLost: 0 };
      pair.wins += won ? 1 : 0;
      pair.losses += won ? 0 : 1;
      pair.matchesWon += forCount;
      pair.matchesLost += againstCount;
      h2h.set(key, pair);
    };
    for (const e of encounters) {
      if (!e.team1Id || !e.team2Id) continue;
      record(e.team1Id, e.team2Id, e.winnerTeamId === e.team1Id, e.team1Wins, e.team2Wins);
      record(e.team2Id, e.team1Id, e.winnerTeamId === e.team2Id, e.team2Wins, e.team1Wins);
    }

    const ranked = calculateGroupStandings([...stats.values()], [...h2h.values()]);
    const hasResults = encounters.length > 0;
    for (const row of ranked) {
      await tx.teamGroupMember.update({
        where: { groupId_teamId: { groupId, teamId: row.teamId } },
        data: {
          wins: row.wins, losses: row.losses, matchesWon: row.matchesWon, matchesLost: row.matchesLost,
          netMatches: row.netMatches, groupRank: hasResults ? row.groupRank : null,
        },
      });
    }
  }

  /**
   * 管理员手动调整分组（抽签编排），只能在任何小组对阵开赛前进行。
   * 调整后按新分组重新生成组内单循环对阵。
   */
  async adjustGroups(teamCompetitionId: string, dto: AdjustGroupsDto) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM TeamCompetition WHERE id = ${teamCompetitionId} FOR UPDATE`;
      const competition = await tx.teamCompetition.findUnique({
        where: { id: teamCompetitionId }, include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!competition) throw new NotFoundException('团体赛不存在');
      if (competition.format === TeamCompetitionFormat.SINGLE_ELIMINATION) {
        throw new BadRequestException('单淘汰赛没有小组，请先把赛制改为小组赛');
      }

      const played = await tx.match.count({ where: { teamMatch: { teamCompetitionId }, OR: [
        { status: { not: MatchStatus.PENDING } }, { startedAt: { not: null } }, { games: { some: {} } },
      ] } });
      if (played) throw new ConflictException('已有子项开赛或成绩，不能调整分组');

      const teams = await tx.team.findMany({ where: { teamCompetitionId }, select: { id: true, name: true } });
      const teamById = new Map(teams.map(t => [t.id, t]));
      const groupNos = new Set<number>();
      const assigned = new Set<string>();
      for (const group of dto.groups) {
        if (groupNos.has(group.groupNo)) throw new BadRequestException(`组号 ${group.groupNo} 重复`);
        groupNos.add(group.groupNo);
        if (group.teamIds.length < 2) throw new BadRequestException('每组至少 2 支队伍');
        for (const teamId of group.teamIds) {
          if (!teamById.has(teamId)) throw new BadRequestException('存在不属于本团体赛的队伍');
          if (assigned.has(teamId)) throw new BadRequestException(`队伍「${teamById.get(teamId)!.name}」被分到了多个组`);
          assigned.add(teamId);
        }
      }
      if (assigned.size !== teams.length) throw new BadRequestException('所有队伍都必须分配到小组');
      if (competition.format === TeamCompetitionFormat.GROUP_PLUS_KNOCKOUT && competition.advancePerGroup) {
        const smallest = Math.min(...dto.groups.map(g => g.teamIds.length));
        if (competition.advancePerGroup > smallest) {
          throw new BadRequestException(`每组出线 ${competition.advancePerGroup} 队，但最小的组只有 ${smallest} 队`);
        }
      }

      await tx.teamMatch.deleteMany({ where: { teamCompetitionId } });
      await tx.teamGroup.deleteMany({ where: { teamCompetitionId } });

      const sorted = [...dto.groups].sort((a, b) => a.groupNo - b.groupNo);
      const distribution = sorted.map((group, index) => ({
        groupNo: index + 1,
        groupName: sorted.length === 1 ? '循环赛' : `${String.fromCharCode(65 + index)}组`,
        teams: group.teamIds.map(id => ({ id, name: teamById.get(id)!.name })),
      }));
      await this.createGroupsWithFixtures(tx, teamCompetitionId, competition.items, distribution);
      await tx.teamCompetition.update({ where: { id: teamCompetitionId }, data: { groupCount: distribution.length } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return this.getGroups(teamCompetitionId);
  }

  /**
   * 生成淘汰赛（小组赛后）
   */
  async generateKnockoutFromGroups(teamCompetitionId: string, dto: GenerateKnockoutFromGroupsDto) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM TeamCompetition WHERE id = ${teamCompetitionId} FOR UPDATE`;
      
      const competition = await tx.teamCompetition.findUnique({
        where: { id: teamCompetitionId },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });

      if (!competition) {
        throw new NotFoundException('团体赛不存在');
      }

      if (competition.format !== TeamCompetitionFormat.GROUP_PLUS_KNOCKOUT) {
        throw new BadRequestException('只有小组+淘汰赛模式才能生成淘汰赛');
      }

      // 获取所有小组
      const groups = await tx.teamGroup.findMany({
        where: { teamCompetitionId },
        include: {
          teams: {
            orderBy: [{ groupRank: 'asc' }],
          },
        },
        orderBy: { groupNo: 'asc' },
      });

      if (groups.length === 0) {
        throw new BadRequestException('未找到小组，请先生成小组赛');
      }

      // 检查小组赛是否全部完成
      const pendingGroupMatches = await tx.teamMatch.count({
        where: {
          teamCompetitionId,
          stage: 'GROUP',
          status: { in: [MatchStatus.PENDING, MatchStatus.LIVE] },
        },
      });

      if (pendingGroupMatches > 0) {
        throw new ConflictException('小组赛尚未全部完成，不能生成淘汰赛');
      }

      // 检查是否已有淘汰赛
      const existingKnockout = await tx.teamMatch.count({
        where: { teamCompetitionId, stage: 'KNOCKOUT' },
      });

      if (existingKnockout > 0 && !dto.force) {
        throw new ConflictException('淘汰赛已存在');
      }
      const knockoutPlayed = await tx.match.count({ where: { teamMatch: { teamCompetitionId, stage: 'KNOCKOUT' }, OR: [
        { status: { not: MatchStatus.PENDING } }, { startedAt: { not: null } }, { games: { some: {} } },
      ] } });
      if (knockoutPlayed) throw new ConflictException('淘汰赛已有子项开赛或成绩，不能重新生成');

      // 删除现有淘汰赛
      await tx.teamMatch.deleteMany({
        where: { teamCompetitionId, stage: 'KNOCKOUT' },
      });

      // 确定晋级队伍：先按名次、再按组号排成种子序列（A1, B1, ..., A2, B2, ...）
      const advancePerGroup = competition.advancePerGroup || 2;
      await tx.teamGroupMember.updateMany({ where: { group: { teamCompetitionId } }, data: { advanced: false } });
      const seeds: string[] = [];
      for (let rank = 1; rank <= advancePerGroup; rank++) {
        for (const group of groups) {
          const member = group.teams.find(m => m.groupRank === rank);
          if (!member) continue;
          seeds.push(member.teamId);
          await tx.teamGroupMember.update({ where: { id: member.id }, data: { advanced: true } });
        }
      }

      if (seeds.length < 2) {
        throw new BadRequestException('晋级队伍不足，无法生成淘汰赛');
      }

      // 标准种子位：同组的第一、二名分在两个半区，小组第一优先获得轮空
      const size = this.nextPowerOfTwo(seeds.length);
      let slots: Array<{ id: string | null; resolved: boolean }> = this.seedPositions(size).map(seed => ({ id: seeds[seed - 1] ?? null, resolved: true }));

      // 淘汰赛轮次编号接在小组赛之后，避免与小组赛 (roundNo, matchNo) 冲突，
      // 也让 advanceTeamWinner 的 roundNo + 1 查找停留在淘汰赛内部。
      const lastGroupRound = await tx.teamMatch.aggregate({
        where: { teamCompetitionId, stage: 'GROUP' },
        _max: { roundNo: true },
      });
      let roundNo = (lastGroupRound._max.roundNo ?? 0) + 1;
      while (slots.length >= 2) {
        const next: typeof slots = [];
        for (let i = 0; i < slots.length; i += 2) {
          const a = slots[i], b = slots[i + 1];
          const bye = a.resolved && b.resolved && Boolean(a.id) !== Boolean(b.id);
          const winner = bye ? a.id ?? b.id : null;
          
          const encounter = await tx.teamMatch.create({
            data: {
              teamCompetitionId,
              round: this.roundLabel(slots.length),
              roundNo,
              matchNo: i / 2 + 1,
              team1Id: a.id,
              team2Id: b.id,
              winnerTeamId: winner,
              status: bye ? MatchStatus.COMPLETED : MatchStatus.PENDING,
              stage: 'KNOCKOUT',
            },
          });

          if (a.id && b.id) {
            await this.createEncounterMatches(tx, encounter, competition.items);
          }
          
          next.push({ id: winner, resolved: bye });
        }
        slots = next;
        roundNo++;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return this.findOne(teamCompetitionId);
  }
}

