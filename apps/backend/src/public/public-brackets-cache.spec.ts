import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringGateway } from '../scoring/scoring.gateway';
import { PublicModule } from './public.module';
import { PublicService } from './public.service';

// Guards the wiring, not the cache itself (see versioned-cache.spec.ts).
// PublicService takes the gateway as @Optional(), so a DI regression would
// fail silently and every live score would be served up to one TTL late.
describe('PublicService brackets cache wiring', () => {
  async function setup() {
    const findMany = jest.fn().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({ imports: [PublicModule] })
      .overrideProvider(PrismaService)
      .useValue({ event: { findMany } })
      .compile();
    const gateway = moduleRef.get(ScoringGateway);
    gateway.server = { emit: jest.fn(), to: jest.fn(() => ({ emit: jest.fn() })) } as never;
    return { findMany, gateway, service: moduleRef.get(PublicService) };
  }

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
    expect((await import('node:zlib')).gunzipSync(payload.gzip).toString('utf8')).toBe(payload.json);
  });
});
