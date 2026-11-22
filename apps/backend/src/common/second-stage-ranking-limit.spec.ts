import { MatchStatus, Prisma, SecondStageStatus } from '@prisma/client';
import { ConfirmSecondStageDto } from '../draws/dto/draw.dto';
import { validateSync } from 'class-validator';
import { includesSecondStageMatch, secondStageRankingLimit, SECOND_STAGE_SLOT_CODES } from './second-stage-bracket';
import { SecondStageProgressService } from './second-stage-progress.service';
import { PublicService } from '../public/public.service';

describe('A-H second-stage ranking limits', () => {
  it.each([
    [1, 7], [2, 7], [3, 8], [4, 8], [5, 11], [6, 11], [7, 12], [8, 12],
  ])('uses only the matches needed to award the top %i', (limit, last) => {
    expect(Array.from({ length: 12 }, (_, index) => index + 1).filter((no) => includesSecondStageMatch(no, limit)))
      .toEqual(Array.from({ length: last }, (_, index) => index + 1));
  });

  it('reads legacy rows and validates the integer on new requests', () => {
    expect(secondStageRankingLimit({ rankingMode: 'TOP_6', rankingLimit: null })).toBe(6);
    expect(secondStageRankingLimit({ rankingMode: 'TOP_8' })).toBe(8);
    expect(secondStageRankingLimit({ rankingMode: 'TOP_8', rankingLimit: 5 })).toBe(5);
    for (const value of [0, 2.5, 9, '5']) {
      const request = Object.assign(new ConfirmSecondStageDto(), { rankingLimit: value, slots: [] });
      expect(validateSync(request).map((issue) => issue.property)).toContain('rankingLimit');
    }
  });

  it('honors manual rankings for any registered entrant within the custom range', () => {
    const service = Object.create(PublicService.prototype) as {
      eventStandings: (event: unknown, registrationMap: Map<string, unknown>) => Array<{ id: string; rank: number }>;
    };
    const registration = (id: string, finalRank: number | null) => ({
      id, finalRank, player1: { name: id, affiliation: '测试单位' }, player2: null,
    });
    const registrations = [registration('auto', null), registration('manual', 1), registration('outside', 4)];
    const stage = {
      rankingLimit: 3, rankingMode: 'TOP_6', status: 'FINISHED',
      slots: [{ entrantId: 'auto' }],
      rankings: [{ entrantId: 'auto', rank: 1 }],
    };
    const rows = service.eventStandings(
      { registrations, matches: [], secondStage: stage },
      new Map(registrations.map((item) => [item.id, item])),
    );
    expect(rows.map(({ id, rank }) => ({ id, rank }))).toEqual([{ id: 'manual', rank: 1 }]);
  });

  it.each([1, 3, 5, 7])('awards only the first %i ranks even when the last match has two entrants', async (rankingLimit) => {
    const matches = [
      { matchNo: 7, first: 1 }, { matchNo: 8, first: 3 },
      { matchNo: 11, first: 5 }, { matchNo: 12, first: 7 },
    ].filter(({ first }) => first <= rankingLimit).map(({ matchNo, first }) => ({
      matchNo, status: MatchStatus.COMPLETED, winnerSide: 1,
      side1Id: String(first), side2Id: String(first + 1),
    }));
    const prisma = {
      secondStageSlot: { findMany: jest.fn().mockResolvedValue(SECOND_STAGE_SLOT_CODES.map((slot) => ({ slot, entrantId: slot }))) },
      secondStageMatch: { findMany: jest.fn().mockResolvedValue(matches) },
      secondStageRanking: { deleteMany: jest.fn(), createMany: jest.fn() },
      secondStage: { update: jest.fn() },
    };
    await new SecondStageProgressService().progress(prisma as unknown as Prisma.TransactionClient, {
      secondStageId: 'stage', eventId: 'event', rankingLimit,
    });
    const ranks = prisma.secondStageRanking.createMany.mock.calls[0][0].data;
    expect(ranks.map((row: { rank: number }) => row.rank)).toEqual(Array.from({ length: rankingLimit }, (_, i) => i + 1));
    expect(prisma.secondStage.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: SecondStageStatus.FINISHED }),
    }));
  });
});
