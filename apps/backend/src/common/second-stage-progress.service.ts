import { ConflictException, Injectable } from '@nestjs/common';
import { MatchStatus, Prisma, SecondStageRankingMode, SecondStageStatus } from '@prisma/client';
import {
  SECOND_STAGE_PROPAGATION_EDGES,
  SecondStageSlotCode,
  computeSecondStageSideByes,
  secondStageFormalRoundNo,
} from './second-stage-bracket';

type SecondStageEntrant = { id: string | null; name: string | null };

/** 轮空(不战而胜)场次写入 planning 表的比分文案。 */
const WALKOVER_SCORE = '轮空';

/**
 * 第二阶段统一推进服务（draws 确认生成 与 scoring 裁判记分 共用）。
 *
 * 职责：把已完成场次的胜/负者填入下游两侧，自动判定并「完成」轮空场（一侧轮空、另一侧
 * 有真实选手时不战而胜），把幽灵场（双方皆轮空）标记为 CANCELLED，最后重建最终排名。
 * planning（SecondStageMatch）与正式赛（Match，roundNo ≥ 100）两表始终保持一致。
 *
 * 轮空位的分类只由 A-H 签位静态决定（见 computeSecondStageSideByes），与谁赢真实比赛无关；
 * 但「不战而胜」会随上游真实比赛完成而级联，因此 progress 迭代至稳定，且幂等——可在确认生成
 * 时调用一次解析初始轮空，并在每次记分后再次调用继续推进。
 */
@Injectable()
export class SecondStageProgressService {
  async progress(
    tx: Prisma.TransactionClient,
    params: { secondStageId: string; eventId: string; rankingMode: SecondStageRankingMode },
  ) {
    const { secondStageId, eventId, rankingMode } = params;

    const slots = await tx.secondStageSlot.findMany({ where: { secondStageId } });
    const byeBySlot = new Map<string, boolean>(slots.map((slot) => [slot.slot, !slot.entrantId]));
    const sideByes = computeSecondStageSideByes(
      (slot: SecondStageSlotCode) => byeBySlot.get(slot) ?? true,
    );

    // 迭代直到稳定：一次轮空完成会产生新的胜者，需再次向下推进/判定。12 场，少数轮即收敛。
    for (let guard = 0; guard < 24; guard += 1) {
      const matches = await tx.secondStageMatch.findMany({
        where: { secondStageId },
        orderBy: { matchNo: 'asc' },
      });
      const byNo = new Map(matches.map((match) => [match.matchNo, match]));
      let changed = false;

      // 1) 推进已完成场次的胜/负者到下游两侧（planning + 正式 Match）
      for (const edge of SECOND_STAGE_PROPAGATION_EDGES) {
        if (edge.top8Only && rankingMode !== SecondStageRankingMode.TOP_8) continue;
        const entrant = this.outcome(byNo.get(edge.sourceNo), edge.outcome);
        const target = byNo.get(edge.targetNo);
        if (!entrant || !target) continue;
        const currentId = edge.targetSide === 1 ? target.side1Id : target.side2Id;
        if (currentId === entrant.id) continue;
        await this.updatePlanningSide(tx, target, edge.targetSide, entrant);
        await this.updateFormalSide(tx, eventId, edge.targetNo, edge.targetSide, entrant);
        changed = true;
      }

      // 2) 解析轮空（一侧空、一侧有人 → 不战而胜）与幽灵场（两侧皆空 → 取消）
      const refreshed = await tx.secondStageMatch.findMany({
        where: { secondStageId },
        orderBy: { matchNo: 'asc' },
      });
      for (const match of refreshed) {
        if (match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED) continue;
        const byes = sideByes.get(match.matchNo);
        if (!byes) continue;
        if (byes.side1 && byes.side2) {
          await this.markPhantom(tx, eventId, match.matchNo, match.id);
          changed = true;
        } else if (byes.side1 !== byes.side2) {
          const realSide: 1 | 2 = byes.side1 ? 2 : 1;
          const realId = realSide === 1 ? match.side1Id : match.side2Id;
          const realName = realSide === 1 ? match.side1NameSnapshot : match.side2NameSnapshot;
          if (realId) {
            await this.completeWalkover(tx, eventId, match, realSide, realId, realName);
            changed = true;
          }
        }
      }

      if (!changed) break;
    }

    await this.rebuildRankings(tx, secondStageId, rankingMode);
  }

  /** 取某场次的胜者/负者参赛者；未完成或轮空（无真实选手）返回 null。 */
  private outcome(
    match:
      | {
          status: MatchStatus;
          winnerSide: number | null;
          side1Id: string | null;
          side2Id: string | null;
          side1NameSnapshot: string | null;
          side2NameSnapshot: string | null;
        }
      | undefined,
    outcome: 'winner' | 'loser',
  ): SecondStageEntrant | null {
    if (!match || match.status !== MatchStatus.COMPLETED || !match.winnerSide) return null;
    const winnerSide = match.winnerSide === 1 ? 1 : match.winnerSide === 2 ? 2 : null;
    if (!winnerSide) return null;
    const side = outcome === 'winner' ? winnerSide : winnerSide === 1 ? 2 : 1;
    const id = side === 1 ? match.side1Id : match.side2Id;
    const name = side === 1 ? match.side1NameSnapshot : match.side2NameSnapshot;
    if (!id) return null; // 轮空侧无真实选手
    return { id, name };
  }

  /** 填充 planning 场次的某一侧。 */
  private async updatePlanningSide(
    tx: Prisma.TransactionClient,
    match: { id: string; status: MatchStatus; side1Id: string | null; side2Id: string | null },
    side: 1 | 2,
    entrant: SecondStageEntrant,
  ) {
    const idKey = side === 1 ? 'side1Id' : 'side2Id';
    const nameKey = side === 1 ? 'side1NameSnapshot' : 'side2NameSnapshot';
    const currentId = match[idKey];
    if (match.status !== MatchStatus.PENDING && currentId && currentId !== entrant.id) {
      throw new ConflictException('下游场次已有结果，不能修改上游胜负关系');
    }
    if (currentId === entrant.id) return;
    await tx.secondStageMatch.update({
      where: { id: match.id },
      data: { [idKey]: entrant.id, [nameKey]: entrant.name },
    });
  }

  /** 填充对应正式赛 Match 的某一侧（PENDING 时一并清空已排场地/时间）。 */
  private async updateFormalSide(
    tx: Prisma.TransactionClient,
    eventId: string,
    matchNo: number,
    side: 1 | 2,
    entrant: SecondStageEntrant,
  ) {
    const match = await tx.match.findFirst({
      where: { eventId, roundNo: secondStageFormalRoundNo(matchNo), matchNo },
    });
    if (!match) return;
    const idKey = side === 1 ? 'side1Id' : 'side2Id';
    const currentId = match[idKey] as string | null;
    if (match.status !== MatchStatus.PENDING && currentId !== entrant.id) {
      throw new ConflictException('第二阶段正式赛已开始或结束，不能修改对阵');
    }
    if (currentId === entrant.id) return;
    const data: Prisma.MatchUncheckedUpdateInput = { [idKey]: entrant.id };
    if (match.status === MatchStatus.PENDING) {
      data.venueId = null;
      data.scheduledAt = null;
    }
    await tx.match.update({ where: { id: match.id }, data });
  }

  /** 不战而胜：planning 与正式赛同时记为 COMPLETED + 胜方。 */
  private async completeWalkover(
    tx: Prisma.TransactionClient,
    eventId: string,
    match: { id: string; matchNo: number },
    winnerSide: 1 | 2,
    winnerId: string,
    winnerName: string | null,
  ) {
    await tx.secondStageMatch.update({
      where: { id: match.id },
      data: {
        status: MatchStatus.COMPLETED,
        winnerSide,
        winnerId,
        winnerNameSnapshot: winnerName,
        score: WALKOVER_SCORE,
      },
    });
    const formal = await tx.match.findFirst({
      where: { eventId, roundNo: secondStageFormalRoundNo(match.matchNo), matchNo: match.matchNo },
    });
    if (formal && formal.status !== MatchStatus.COMPLETED) {
      await tx.match.update({
        where: { id: formal.id },
        data: { status: MatchStatus.COMPLETED, winnerSide, finishedAt: new Date() },
      });
    }
  }

  /** 幽灵场（双方皆轮空，永不进行）：planning 与正式赛同时记为 CANCELLED。 */
  private async markPhantom(
    tx: Prisma.TransactionClient,
    eventId: string,
    matchNo: number,
    planningId: string,
  ) {
    await tx.secondStageMatch.update({
      where: { id: planningId },
      data: { status: MatchStatus.CANCELLED, winnerSide: null, winnerId: null, winnerNameSnapshot: null },
    });
    const formal = await tx.match.findFirst({
      where: { eventId, roundNo: secondStageFormalRoundNo(matchNo), matchNo },
    });
    if (formal && formal.status !== MatchStatus.CANCELLED) {
      await tx.match.update({ where: { id: formal.id }, data: { status: MatchStatus.CANCELLED } });
    }
  }

  /** 由 7/8/11/12 名次场重建最终排名（与原逻辑一致；轮空导致的缺额自然留空）。 */
  private async rebuildRankings(
    tx: Prisma.TransactionClient,
    secondStageId: string,
    rankingMode: SecondStageRankingMode,
  ) {
    const matches = await tx.secondStageMatch.findMany({
      where: { secondStageId },
      orderBy: { matchNo: 'asc' },
    });
    const byNo = new Map(matches.map((match) => [match.matchNo, match]));
    const ranks = new Map<number, SecondStageEntrant>();

    const rankFrom = (matchNo: number, winnerRank: number, loserRank: number) => {
      const winner = this.outcome(byNo.get(matchNo), 'winner');
      const loser = this.outcome(byNo.get(matchNo), 'loser');
      if (winner) ranks.set(winnerRank, winner);
      if (loser) ranks.set(loserRank, loser);
    };

    rankFrom(7, 1, 2);
    rankFrom(8, 3, 4);
    rankFrom(11, 5, 6);
    if (rankingMode === SecondStageRankingMode.TOP_8) {
      rankFrom(12, 7, 8);
    }

    const maxRank = rankingMode === SecondStageRankingMode.TOP_6 ? 6 : 8;
    const rows = [...ranks.entries()]
      .filter(([rank]) => rank <= maxRank)
      .sort(([a], [b]) => a - b)
      .map(([rank, entrant]) => ({
        secondStageId,
        rank,
        entrantId: entrant.id,
        entrantNameSnapshot: entrant.name,
      }));

    await tx.secondStageRanking.deleteMany({ where: { secondStageId } });
    if (rows.length) {
      await tx.secondStageRanking.createMany({ data: rows });
    }

    await tx.secondStage.update({
      where: { id: secondStageId },
      data: {
        status: rows.length === maxRank ? SecondStageStatus.FINISHED : SecondStageStatus.CONFIRMED,
        finishedAt: rows.length === maxRank ? new Date() : null,
      },
    });
  }
}
