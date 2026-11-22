import { ConflictException, ForbiddenException } from '@nestjs/common';
import { MatchEventType, MatchStatus, Role } from '@prisma/client';
import { ScoringService } from './scoring.service';

const referee = { id: 'ref-b', role: Role.REFEREE };

function fixture(courtRefereeIds = ['ref-a', 'ref-b']) {
  const match = {
    id: 'match',
    refereeId: 'ref-a',
    refereeClaimExpiresAt: null as Date | null,
    status: MatchStatus.LIVE,
    side1Id: 'side-1',
    side2Id: 'side-2',
    event: { tournamentId: 'event' },
  };
  const txCreateEvent = jest.fn();
  const prisma = {
    tournament: { findFirst: jest.fn().mockResolvedValue({ isArchived: false }) },
    venue: { findFirst: jest.fn().mockResolvedValue({
      id: 'court',
      refereeAssignments: courtRefereeIds.map(userId => ({ userId })),
    }) },
    match: {
      findFirst: jest.fn().mockResolvedValue(match),
      findUnique: jest.fn().mockResolvedValue({ ...match, refereeId: referee.id }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async work => work({
      $queryRaw: jest.fn().mockResolvedValue([{ refereeId: 'ref-c' }]),
      matchEvent: { create: txCreateEvent },
    })),
  };
  return { service: new ScoringService(prisma as never, {} as never, {} as never, {} as never), prisma, match, txCreateEvent };
}

describe('fixed court referee handover', () => {
  it('lets another referee from the same court take over a live match with a conditional update', async () => {
    const { service, prisma } = fixture();
    await expect(service.claimCourtMatch('event', 'court', 'match', referee, 'ref-a')).resolves.toEqual({ id: 'match' });
    expect(prisma.match.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ refereeId: 'ref-a', status: { in: ['PENDING', 'LIVE'] } }),
      data: { refereeId: 'ref-b', refereeClaimExpiresAt: expect.any(Date) },
    }));
  });

  it('records three hours on a new self-claim and keeps that deadline during a handover', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-21T09:00:00Z'));
    try {
      const { service, prisma, match } = fixture();
      prisma.match.findFirst.mockResolvedValue({ ...match, refereeId: null, status: MatchStatus.PENDING });
      await service.claimCourtMatch('event', 'court', 'match', referee);
      const expiresAt = new Date('2026-11-21T12:00:00Z');
      expect(prisma.match.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
        data: { refereeId: referee.id, refereeClaimExpiresAt: expiresAt },
      }));

      jest.setSystemTime(new Date('2026-11-21T10:00:00Z'));
      prisma.match.findFirst.mockResolvedValue({ ...match, refereeClaimExpiresAt: expiresAt });
      await service.claimCourtMatch('event', 'court', 'match', referee, 'ref-a');
      expect(prisma.match.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
        data: { refereeId: referee.id, refereeClaimExpiresAt: expiresAt },
      }));

      prisma.match.findFirst.mockResolvedValue({ ...match, refereeId: referee.id, refereeClaimExpiresAt: expiresAt });
      prisma.match.updateMany.mockClear();
      await service.claimCourtMatch('event', 'court', 'match', referee);
      expect(prisma.match.updateMany).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([MatchStatus.PENDING, MatchStatus.LIVE])('starts the timer when the assigned referee enters a %s match', async status => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-21T09:00:00Z'));
    try {
      const { service, prisma, match } = fixture();
      prisma.match.findFirst.mockResolvedValue({ ...match, refereeId: referee.id, status });

      await expect(service.claimCourtMatch('event', 'court', 'match', referee)).resolves.toEqual({ id: 'match' });
      expect(prisma.match.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ refereeId: referee.id, refereeClaimExpiresAt: null, status: { in: ['PENDING', 'LIVE'] } }),
        data: { refereeClaimExpiresAt: new Date('2026-11-21T12:00:00Z') },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('lets the assigned referee review a completed match without starting a timer', async () => {
    const { service, prisma, match } = fixture();
    prisma.match.findFirst.mockResolvedValue({ ...match, refereeId: referee.id, status: MatchStatus.COMPLETED });

    await expect(service.claimCourtMatch('event', 'court', 'match', referee)).resolves.toEqual({ id: 'match' });
    expect(prisma.match.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the original referee when the request has no handover confirmation', async () => {
    const { service, prisma } = fixture();
    await expect(service.claimCourtMatch('event', 'court', 'match', referee)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.match.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a referee outside the court roster', async () => {
    const { service, prisma } = fixture(['ref-a', 'ref-c']);
    await expect(service.claimCourtMatch('event', 'court', 'match', referee, 'ref-a')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.match.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a handover if another assignment won the race', async () => {
    const { service, prisma } = fixture();
    prisma.match.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.claimCourtMatch('event', 'court', 'match', referee, 'ref-a')).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks an in-flight referee event once the match belongs to a different account', async () => {
    const { service, txCreateEvent } = fixture();
    await expect(service.logMatchEvent('match', MatchEventType.WARNING, referee, 1)).rejects.toBeInstanceOf(ForbiddenException);
    expect(txCreateEvent).not.toHaveBeenCalled();
  });
});
