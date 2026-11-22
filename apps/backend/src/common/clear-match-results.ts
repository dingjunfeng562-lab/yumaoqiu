import { MatchStatus, Prisma, ScoreSheetStatus } from '@prisma/client';

export async function clearMatchResults(
  tx: Prisma.TransactionClient,
  where: Prisma.MatchWhereInput,
  voidReason: string,
) {
  await tx.game.deleteMany({ where: { match: where } });
  await tx.matchEvent.deleteMany({ where: { match: where } });
  await tx.matchScoreSheet.updateMany({
    where: { status: ScoreSheetStatus.VALID, match: where },
    data: { status: ScoreSheetStatus.VOID, voidedAt: new Date(), voidReason },
  });
  await tx.match.updateMany({
    where,
    data: {
      status: MatchStatus.PENDING,
      refereeId: null,
      refereeClaimExpiresAt: null,
      winnerSide: null,
      startedAt: null,
      finishedAt: null,
      forfeitedSide: null,
      forfeitReason: null,
    },
  });
}
