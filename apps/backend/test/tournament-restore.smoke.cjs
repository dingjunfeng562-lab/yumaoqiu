// Run after npm run build: node test/tournament-restore.smoke.cjs
// Real controllers, role guards, validation and services; in-memory persistence only.
require('reflect-metadata');
const assert = require('node:assert/strict');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { ValidationPipe, UnauthorizedException } = require('@nestjs/common');
const { TournamentsController } = require('../dist/tournaments/tournaments.controller');
const { TournamentsService } = require('../dist/tournaments/tournaments.service');
const { AdminCompetitionsController } = require('../dist/competitions/admin-competitions.controller');
const { CompetitionsService } = require('../dist/competitions/competitions.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
const { RolesGuard } = require('../dist/auth/roles.guard');

async function main() {
  let state;
  let writes = 0;
  const reset = (extra = {}) => {
    writes = 0;
    state = {
      id: 'fixture', isArchived: true, isPublished: true, showOnHome: false,
      approvalStatus: 'APPROVED', status: 'FINISHED', teamCompetitions: [], events: [],
      startDate: new Date('2026-01-01'), endDate: new Date('2026-01-02'),
      registrationStartDate: null, registrationEndDate: null,
      ...extra,
    };
  };
  const prisma = {
    tournament: {
      findUnique: async () => ({ ...state }),
      findUniqueOrThrow: async () => ({ ...state }),
      update: async ({ data }) => { writes++; state = { ...state, ...data }; return { ...state }; },
    },
    $transaction: async (fn) => fn(prisma),
  };
  const tournaments = new TournamentsService(prisma);
  const competitions = new CompetitionsService(prisma, {});
  // Replace read/projection helpers only; execute actual mutation and authorization code.
  competitions.findCompetition = async () => ({ ...state });
  competitions.toCompetitionView = (value) => value;
  const module = await Test.createTestingModule({
    controllers: [TournamentsController, AdminCompetitionsController],
    providers: [
      { provide: TournamentsService, useValue: tournaments },
      { provide: CompetitionsService, useValue: competitions },
      RolesGuard,
    ],
  }).overrideGuard(JwtAuthGuard).useValue({
    canActivate(context) {
      const req = context.switchToHttp().getRequest();
      const role = req.headers['x-test-role'];
      if (!role) throw new UnauthorizedException();
      req.user = { id: 'test-user', role };
      return true;
    },
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  const client = request(app.getHttpServer());
  const restore = '/tournaments/fixture/restore';
  const update = '/tournaments/fixture';
  const publish = '/admin/competitions/fixture/publish';
  let checks = 0;
  try {
    for (const role of [null, 'ADMIN', 'SUPER_ADMIN', 'PLAYER', 'REFEREE', 'PHOTOGRAPHER']) {
      for (const [url, body] of [[restore, {}], [update, { isArchived: false }], [publish, {}]]) {
        reset();
        const req = client.patch(url);
        if (role) req.set('x-test-role', role);
        await req.send(body).expect(role ? 403 : 401);
        assert.equal(writes, 0);
        assert.equal(state.isArchived, true);
        checks++;
      }
    }
    for (const approvalStatus of ['APPROVED', 'PENDING', 'REJECTED']) {
      for (const isPublished of [true, false]) {
        reset({ approvalStatus, isPublished });
        await client.patch(restore).set('x-test-role', 'ROOT').expect(200);
        assert.equal(state.isArchived, false);
        assert.equal(state.approvalStatus, approvalStatus);
        assert.equal(state.isPublished, isPublished);
        assert.equal(writes, 1);
        checks++;
      }
    }
    reset();
    await client.patch(update).set('x-test-role', 'ROOT').send({ isArchived: false }).expect(200);
    assert.equal(state.isArchived, false);
    checks++;
    for (const role of ['ADMIN', 'SUPER_ADMIN', 'ROOT']) {
      for (const invalid of ['false', 0, '', [], {}]) {
        reset();
        await client.patch(update).set('x-test-role', role).send({ isArchived: invalid }).expect(400);
        assert.equal(writes, 0);
        checks++;
      }
      reset({ isArchived: false, isPublished: false });
      await client.patch(publish).set('x-test-role', role).expect(200);
      assert.equal(state.isPublished, true);
      checks++;
    }
    reset();
    await client.patch(publish).set('x-test-role', 'ROOT').expect(403);
    assert.equal(writes, 0);
    checks++;
    // If a tournament is archived after the publication pre-check, publish
    // must not erase that archive flag (race regression).
    reset({ isArchived: false });
    competitions.findCompetition = async () => {
      const snapshot = { ...state };
      state.isArchived = true;
      return snapshot;
    };
    await client.patch(publish).set('x-test-role', 'ADMIN').expect(200);
    assert.equal(state.isArchived, true);
    checks++;
    console.log(`PASS: ${checks} archive restoration authorization checks (no database writes).`);
  } finally {
    await app.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
