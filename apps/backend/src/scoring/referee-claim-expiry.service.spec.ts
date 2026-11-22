import { MatchStatus, ScoreSheetStatus } from '@prisma/client';
import { RefereeClaimExpiryService } from './referee-claim-expiry.service';

const now = new Date('2026-11-21T12:00:00Z');

function fixture() {
  const match = {
    status: MatchStatus.LIVE,
    winnerSide: null,
    eventId: null,
    teamMatch: { status: MatchStatus.LIVE, teamCompetition: { tournamentId: 't1' } },
    referee: { username: 'referee' },
    games: [{ side1Score: 15, side2Score: 12 }],
  };
  const tx = {
    match: { findFirst: jest.fn().mockResolvedValue(match), updateMany: jest.fn() },
    game: { deleteMany: jest.fn() },
    matchEvent: { deleteMany: jest.fn() },
    matchScoreSheet: { updateMany: jest.fn() },
    matchOperationLog: { create: jest.fn() },
  };
  const prisma = {
    match: { findMany: jest.fn().mockResolvedValue([{ id: 'm1' }]) },
    $transaction: jest.fn(async work => work(tx)),
  };
  const teams = { lockScoringMatch: jest.fn(), updateTeamMatchAggregate: jest.fn() };
  const gateway = { emitMatchState: jest.fn(), emitBracketUpdate: jest.fn() };
  const scoring = { getMatchState: jest.fn().mockResolvedValue({ id: 'm1', status: MatchStatus.PENDING }) };
  const service = new RefereeClaimExpiryService(prisma as never, teams as never, scoring as never, gateway as never);
  return { service, match, prisma, tx, teams, gateway };
}

describe('referee claim expiry', () => {
  it('releases an overdue unfinished match and voids scoring without changing its schedule', async () => {
    const { service, prisma, tx, teams, gateway } = fixture();
    await service.expireDueClaims(now);
    const due = {
      refereeId: { not: null },
      status: { in: [MatchStatus.PENDING, MatchStatus.LIVE] },
      refereeClaimExpiresAt: { lte: now },
    };
    expect(prisma.match.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: due }));
    expect(tx.match.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { ...due, id: 'm1' } }));
    expect(teams.lockScoringMatch).toHaveBeenCalledWith(tx, 'm1');
    expect(teams.lockScoringMatch.mock.invocationCallOrder[0]).toBeLessThan(tx.match.findFirst.mock.invocationCallOrder[0]);
    expect(tx.game.deleteMany).toHaveBeenCalledWith({ where: { match: { id: 'm1' } } });
    expect(tx.matchEvent.deleteMany).toHaveBeenCalledWith({ where: { match: { id: 'm1' } } });
    expect(tx.matchScoreSheet.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: ScoreSheetStatus.VALID, match: { id: 'm1' } },
      data: expect.objectContaining({ status: ScoreSheetStatus.VOID }),
    }));
    expect(tx.match.updateMany).toHaveBeenCalledWith({ where: { id: 'm1' }, data: {
      status: MatchStatus.PENDING, refereeId: null, refereeClaimExpiresAt: null,
      winnerSide: null, startedAt: null, finishedAt: null, forfeitedSide: null, forfeitReason: null,
    } });
    expect(tx.matchOperationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ beforeData: expect.objectContaining({ score: '15:12' }) }),
    });
    expect(teams.updateTeamMatchAggregate).toHaveBeenCalledWith(tx, 'm1');
    expect(gateway.emitBracketUpdate).toHaveBeenCalledWith({ matchId: 'm1', tournamentId: 't1', eventId: null });
    expect(gateway.emitMatchState).toHaveBeenCalledWith('m1', { id: 'm1', status: MatchStatus.PENDING });
  });

  it('skips a match finished or reassigned before the reset obtains its lock', async () => {
    const { service, tx, gateway } = fixture();
    tx.match.findFirst.mockResolvedValue(null);
    await service.expireDueClaims(now);
    expect(tx.game.deleteMany).not.toHaveBeenCalled();
    expect(tx.match.updateMany).not.toHaveBeenCalled();
    expect(gateway.emitMatchState).not.toHaveBeenCalled();
  });
});
