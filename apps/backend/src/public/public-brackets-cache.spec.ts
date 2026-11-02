import { Test } from '@nestjs/testing';
import { gunzipSync } from 'node:zlib';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringGateway } from '../scoring/scoring.gateway';
import { PublicModule } from './public.module';
import { PublicService } from './public.service';

// Guards the wiring around the public brackets (the cache itself is covered
// in versioned-cache.spec.ts). PublicService takes the gateway as @Optional(),
// so a DI regression would fail silently: live scores served a TTL late, and
// no bracket:match pushes at all.

const tournament = (id: string) => ({
  id,
  name: `赛事${id}`,
  isPublished: true,
  isArchived: false,
  approvalStatus: 'APPROVED',
});

const registration = (id: string, name: string) => ({
  id,
  teamName: null,
  seedRank: null,
  player1: { name },
  player2: null,
});

function liveMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    eventId: 'e1',
    round: 'R8',
    roundNo: 1,
    matchNo: 1,
    status: 'LIVE',
    side1Id: 'r1',
    side2Id: 'r2',
    winnerSide: null,
    forfeitedSide: null,
    forfeitReason: null,
    venue: { name: '1号场' },
    referee: { username: '裁判甲' },
    scheduledAt: null,
    startedAt: new Date('2026-11-02T01:00:00Z'),
    finishedAt: null,
    durationMinutes: null,
    games: [{ gameNo: 1, side1Score: 11, side2Score: 9, winnerSide: null }],
    events: [],
    ...overrides,
  };
}

function bracketEvent(id: string, tournamentId: string, matches: unknown[] = []) {
  return {
    id,
    type: 'MENS_SINGLES',
    format: 'SINGLE_ELIMINATION',
    drawPublished: true,
    drawGeneratedAt: null,
    qualifiersPerGroup: null,
    tournament: tournament(tournamentId),
    registrations: [registration('r1', '张三'), registration('r2', '李四')],
    matches,
    secondStage: null,
  };
}

async function setup(events: unknown[] = []) {
  const prisma = {
    event: { findMany: jest.fn().mockResolvedValue(events) },
    match: { findUnique: jest.fn() },
    registration: { findMany: jest.fn().mockResolvedValue([registration('r1', '张三'), registration('r2', '李四')]) },
  };
  const moduleRef = await Test.createTestingModule({ imports: [PublicModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();
  const gateway = moduleRef.get(ScoringGateway);
  const emitted: Array<{ event: string; payload: any }> = [];
  gateway.server = {
    emit: jest.fn((event: string, payload: unknown) => emitted.push({ event, payload })),
    to: jest.fn(() => ({ emit: jest.fn() })),
  } as never;
  return { prisma, findMany: prisma.event.findMany, gateway, emitted, service: moduleRef.get(PublicService) };
}

// Let the async bracket:match build (DB reads + emit) settle.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const decode = (payload: { gzip: Buffer }) => JSON.parse(gunzipSync(payload.gzip).toString('utf8'));

describe('PublicService brackets cache wiring', () => {
  it('shares one load between back-to-back requests', async () => {
    const { findMany, service } = await setup();

    await Promise.all([service.getBracketsPayload(), service.getBracketsPayload()]);
    await service.getBracketsPayload();

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('reloads after a score broadcast', async () => {
    const { findMany, gateway, service } = await setup();
    await service.getBracketsPayload();

    gateway.emitMatchState('match-1', {});
    await service.getBracketsPayload();

    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('reloads after a bracket broadcast', async () => {
    const { findMany, gateway, service } = await setup();
    await service.getBracketsPayload();

    gateway.emitBracketUpdate({ tournamentId: 't-1' });
    await service.getBracketsPayload();

    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('invalidates before clients are notified', async () => {
    const { findMany, gateway, service } = await setup();
    await service.getBracketsPayload();
    // Simulate a client that refetches the instant it receives the event.
    let refetch: Promise<unknown> | undefined;
    gateway.server = {
      emit: jest.fn(() => {
        refetch ??= service.getBracketsPayload();
      }),
      to: jest.fn(() => ({ emit: jest.fn() })),
    } as never;

    gateway.emitMatchState('match-1', {});
    await refetch;

    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('serves the same JSON in plain and gzip form', async () => {
    const { service } = await setup();
    const payload = await service.getBracketsPayload();

    expect(JSON.parse(payload.json)).toEqual({ brackets: [] });
    expect(gunzipSync(payload.gzip).toString('utf8')).toBe(payload.json);
  });
});

describe('GET /api/public/brackets?tournamentId=', () => {
  const events = [bracketEvent('e1', 't1'), bracketEvent('e2', 't2'), bracketEvent('e3', 't1')];

  it('returns every bracket when no tournament is given', async () => {
    const { service } = await setup(events);
    const body = decode(await service.getBracketsPayload());

    expect(body.brackets.map((b: { id: string }) => b.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('narrows to one tournament, keeping backend order, from a single load', async () => {
    const { findMany, service } = await setup(events);

    const t1 = decode(await service.getBracketsPayload('t1'));
    const t2 = decode(await service.getBracketsPayload('t2'));

    expect(t1.brackets.map((b: { id: string }) => b.id)).toEqual(['e1', 'e3']);
    expect(t2.brackets.map((b: { id: string }) => b.id)).toEqual(['e2']);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('answers unknown tournaments with one shared empty payload', async () => {
    const { service } = await setup(events);

    const a = await service.getBracketsPayload('nope-1');
    const b = await service.getBracketsPayload('nope-2');

    expect(JSON.parse(a.json)).toEqual({ brackets: [] });
    expect(a).toBe(b);
  });
});

describe('bracket:match push', () => {
  it('pushes the match exactly as the full brackets render it', async () => {
    const match = liveMatch();
    const { prisma, gateway, emitted, service } = await setup([bracketEvent('e1', 't1', [match])]);
    prisma.match.findUnique.mockResolvedValue({ ...match, event: bracketEvent('e1', 't1') });

    gateway.emitMatchState('m1', {});
    await settle();

    const push = emitted.find((item) => item.event === 'bracket:match');
    expect(push?.payload).toMatchObject({ tournamentId: 't1', bracketId: 'e1', matchId: 'm1' });
    const full = decode(await service.getBracketsPayload());
    expect(push?.payload.match).toEqual(full.brackets[0].matches[0]);
    expect(push?.payload.match.score).toBe('11:9');
  });

  it('only resolves names from this event’s approved registrations', async () => {
    const match = liveMatch();
    const { prisma, service } = await setup();
    prisma.match.findUnique.mockResolvedValue({ ...match, event: bracketEvent('e1', 't1') });

    await service.getPublicBracketMatchUpdate('m1');

    expect(prisma.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['r1', 'r2'] }, eventId: 'e1', status: 'APPROVED' },
      }),
    );
  });

  it('asks clients to refetch for second-stage matches', async () => {
    const { prisma, service } = await setup();
    prisma.match.findUnique.mockResolvedValue({ ...liveMatch({ roundNo: 101 }), event: bracketEvent('e1', 't1') });

    await expect(service.getPublicBracketMatchUpdate('m1')).resolves.toEqual({
      tournamentId: 't1',
      bracketId: 'e1',
      matchId: 'm1',
      match: null,
    });
  });

  it.each([
    ['an unpublished tournament', { isPublished: false }],
    ['an archived tournament', { isArchived: true }],
    ['an unapproved tournament', { approvalStatus: 'PENDING' }],
  ])('pushes nothing for %s', async (_label, tournamentOverride) => {
    const { prisma, gateway, emitted } = await setup();
    const event = { ...bracketEvent('e1', 't1'), tournament: { ...tournament('t1'), ...tournamentOverride } };
    prisma.match.findUnique.mockResolvedValue({ ...liveMatch(), event });

    gateway.emitMatchState('m1', {});
    await settle();

    expect(emitted.some((item) => item.event === 'bracket:match')).toBe(false);
  });

  it('pushes nothing when the draw is unpublished or the match has no event', async () => {
    const { prisma, service } = await setup();
    prisma.match.findUnique.mockResolvedValueOnce({ ...liveMatch(), event: { ...bracketEvent('e1', 't1'), drawPublished: false } });
    prisma.match.findUnique.mockResolvedValueOnce({ ...liveMatch(), eventId: null, event: null });

    await expect(service.getPublicBracketMatchUpdate('m1')).resolves.toBeNull();
    await expect(service.getPublicBracketMatchUpdate('m1')).resolves.toBeNull();
  });

  it('keeps pushes for one match in order during a burst of points', async () => {
    const { prisma, gateway, emitted } = await setup();
    let score = 0;
    let release!: () => void;
    const firstReadBlocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    prisma.match.findUnique.mockImplementation(async () => {
      const seen = ++score; // score as of this read
      if (seen === 1) await firstReadBlocked; // first read is slow
      return { ...liveMatch({ games: [{ gameNo: 1, side1Score: seen, side2Score: 0, winnerSide: null }] }), event: bracketEvent('e1', 't1') };
    });

    gateway.emitMatchState('m1', {}); // point 1 (slow read)
    gateway.emitMatchState('m1', {}); // point 2
    gateway.emitMatchState('m1', {}); // point 3 (coalesced with 2)
    release();
    await settle();

    const scores = emitted.filter((item) => item.event === 'bracket:match').map((item) => item.payload.match.score);
    expect(scores).toEqual(['1:0', '2:0']);
  });
});
