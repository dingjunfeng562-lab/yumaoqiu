import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Format, MatchStatus, Prisma, Role, SecondStageStatus, TeamCompetitionFormat } from '@prisma/client';
import { AuthActor } from '../auth/admin-scope';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { ScoringGateway } from '../scoring/scoring.gateway';
import { isSecondStageFormalRoundNo, SECOND_STAGE_FORMAL_ROUND_NO_BASE } from './second-stage-bracket';
import { resetElimination } from './reset-elimination';

const emptyResult = { status: MatchStatus.PENDING, winnerSide: null, startedAt: null, finishedAt: null,
  forfeitedSide: null, forfeitReason: null };

@Injectable()
export class ResultsResetService {
  private readonly logger = new Logger(ResultsResetService.name);
  constructor(private readonly prisma: PrismaService, private readonly scoring: ScoringService, private readonly gateway: ScoringGateway) {}

  private requireRoot(actor: AuthActor) {
    if (actor.role !== Role.ROOT) throw new ForbiddenException('仅超级管理员可清除比赛成绩');
  }

  private async clearMatches(tx: Prisma.TransactionClient, where: Prisma.MatchWhereInput) {
    await tx.game.deleteMany({ where: { match: where } });
    // Discard old points, serving/paused state, forfeits, cards and undo history.
    await tx.matchEvent.deleteMany({ where: { match: where } });
    await tx.match.updateMany({ where, data: emptyResult });
  }

  async resetTeam(teamCompetitionId: string, actor: AuthActor) {
    this.requireRoot(actor);
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM TeamCompetition WHERE id = ${teamCompetitionId} FOR UPDATE`;
      const competition = await tx.teamCompetition.findUnique({ where: { id: teamCompetitionId } });
      if (!competition) throw new NotFoundException('团体赛不存在');
      await tx.$queryRaw`SELECT id FROM TeamMatch WHERE teamCompetitionId = ${teamCompetitionId} ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT m.id FROM \`Match\` m JOIN TeamMatch t ON m.teamMatchId = t.id WHERE t.teamCompetitionId = ${teamCompetitionId} ORDER BY m.id FOR UPDATE`;
      const encounters = await tx.teamMatch.findMany({ where: { teamCompetitionId }, include: { matches: true } });
      if (!encounters.length) throw new ConflictException('当前没有已生成的对阵');
      const matches = encounters.flatMap(encounter => encounter.matches);
      await this.clearMatches(tx, { teamMatch: { teamCompetitionId } });
      await tx.teamMatch.updateMany({ where: { teamCompetitionId }, data: {
        status: MatchStatus.PENDING, winnerTeamId: null, team1Wins: 0, team2Wins: 0,
      } });
      const knockout = encounters.filter(encounter => encounter.stage !== 'GROUP');
      const plans = competition.format === TeamCompetitionFormat.SINGLE_ELIMINATION
        ? resetElimination(knockout.map(encounter => ({ ...encounter, side1Id: encounter.team1Id, side2Id: encounter.team2Id })))
        : knockout.map(encounter => ({ id: encounter.id, side1Id: null, side2Id: null, winnerSide: null, status: MatchStatus.PENDING }));
      for (const plan of plans) {
        const original = encounters.find(encounter => encounter.id === plan.id)!;
        const sidesChanged = original.team1Id !== plan.side1Id || original.team2Id !== plan.side2Id;
        const hasNoTeams = !plan.side1Id && !plan.side2Id;
        await tx.teamMatch.update({ where: { id: plan.id }, data: {
          team1Id: plan.side1Id, team2Id: plan.side2Id, status: plan.status,
          winnerTeamId: plan.winnerSide === 1 ? plan.side1Id : plan.winnerSide === 2 ? plan.side2Id : null,
          ...(sidesChanged || hasNoTeams ? { lineupLocked: false } : {}),
        } });
        if (sidesChanged || hasNoTeams) {
          await tx.teamLineup.deleteMany({ where: { teamMatchId: plan.id } });
          await tx.match.updateMany({ where: { teamMatchId: plan.id }, data: { side1Id: null, side2Id: null, lineupLocked: false } });
        }
      }
      await tx.teamGroupMember.updateMany({ where: { group: { teamCompetitionId } }, data: {
        wins: 0, losses: 0, matchesWon: 0, matchesLost: 0, netMatches: 0, groupRank: null, advanced: false,
      } });
      await tx.team.updateMany({ where: { teamCompetitionId }, data: { finalRank: null } });
      await tx.teamDrawClearRequest.updateMany({ where: { teamCompetitionId, status: 'PENDING' }, data: {
        status: 'CANCELLED', decidedById: actor.id, decidedAt: new Date(), decisionRemark: '比赛成绩已清除，原取消申请作废',
      } });
      return { matchesReset: matches.length, matchIds: matches.map(match => match.id), tournamentId: competition.tournamentId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 });
    await this.notify(result.matchIds, result.tournamentId);
    return { matchesReset: result.matchesReset };
  }

  async resetEvent(eventId: string, actor: AuthActor) {
    this.requireRoot(actor);
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event) throw new NotFoundException('单项不存在');
      await tx.$queryRaw`SELECT id FROM \`Match\` WHERE eventId = ${eventId} ORDER BY id FOR UPDATE`;
      const matches = await tx.match.findMany({ where: { eventId } });
      if (!matches.length) throw new ConflictException('当前没有已生成的对阵');
      await this.clearMatches(tx, { eventId });
      const pureElimination = event.format === Format.SINGLE_ELIMINATION || event.format === Format.SINGLE_ELIMINATION_PLUS_GROUP_RANKING;
      const knockout = matches.filter(match => match.roundNo > 0 && !isSecondStageFormalRoundNo(match.roundNo));
      if (pureElimination) {
        for (const plan of resetElimination(knockout)) {
          const { id, ...data } = plan;
          await tx.match.update({ where: { id }, data });
        }
      } else {
        await tx.match.updateMany({ where: { eventId, roundNo: { gt: 0 } }, data: { side1Id: null, side2Id: null } });
      }
      // The A-H stage depends on results of the preceding stage. Retain its
      // skeleton and formal Match IDs/schedules, but require entrants to be confirmed again.
      await tx.match.updateMany({ where: { eventId, roundNo: { gte: SECOND_STAGE_FORMAL_ROUND_NO_BASE } }, data: { side1Id: null, side2Id: null } });
      const stage = await tx.secondStage.findUnique({ where: { eventId } });
      if (stage) {
        await tx.secondStageSlot.updateMany({ where: { secondStageId: stage.id }, data: { entrantId: null, entrantNameSnapshot: null } });
        await tx.secondStageMatch.updateMany({ where: { secondStageId: stage.id }, data: {
          side1Id: null, side2Id: null, side1NameSnapshot: null, side2NameSnapshot: null,
          score: null, status: MatchStatus.PENDING, winnerSide: null, winnerId: null, winnerNameSnapshot: null,
        } });
        await tx.secondStageRanking.deleteMany({ where: { secondStageId: stage.id } });
        await tx.secondStage.update({ where: { id: stage.id }, data: {
          status: SecondStageStatus.NOT_STARTED, confirmedAt: null, finishedAt: null, updatedBy: actor.id,
        } });
      }
      await tx.registration.updateMany({ where: { eventId }, data: { finalRank: null } });
      await tx.drawGroupMember.updateMany({ where: { drawGroup: { drawBracket: { eventItemId: eventId } } }, data: { groupRank: null, isQualified: false } });
      await tx.drawRedrawRequest.updateMany({ where: { eventItemId: eventId, status: 'PENDING' }, data: {
        status: 'CANCELLED', decidedById: actor.id, decidedAt: new Date(), decisionRemark: '比赛成绩已清除，原重抽申请作废',
      } });
      return { matchIds: matches.map(match => match.id), tournamentId: event.tournamentId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 });
    await this.notify(result.matchIds, result.tournamentId, eventId);
    return { matchesReset: result.matchIds.length };
  }

  private async notify(matchIds: string[], tournamentId: string, eventId?: string) {
    // A notification failure must not report an already-committed reset as failed.
    for (const matchId of matchIds) {
      try { this.gateway.emitMatchState(matchId, await this.scoring.getMatchState(matchId)); }
      catch (error) { this.logger.warn(`清除成绩后通知场次 ${matchId} 失败: ${String(error)}`); }
    }
    try { this.gateway.emitBracketUpdate({ tournamentId, eventId }); }
    catch (error) { this.logger.warn(`清除成绩后通知对阵失败: ${String(error)}`); }
  }
}
