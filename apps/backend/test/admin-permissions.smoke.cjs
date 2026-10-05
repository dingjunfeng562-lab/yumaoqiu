// Build first: pnpm --filter backend build:prod
// Uses disposable local database fixtures; always cleans them up. No email is sent.
require('dotenv/config');
require('reflect-metadata');
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { AppModule } = require('../dist/app.module');
const { EmailReminderService } = require('../dist/mail/email-reminder.service');
const bcrypt = require('bcryptjs');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1', '::1'].includes(url.hostname), 'Only run against a local database');
  const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
  const prefix = `qa${Date.now().toString(36)}`;
  const password = 'QaPass2026Only';
  const tournaments = [];
  let sequence = 0;
  let app;
  let checks = 0;
  const credentials = () => {
    const name = `${prefix}${++sequence}`;
    return { username: name, email: `${name}@example.test`, password };
  };
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailReminderService).useValue({}).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.enableCors({ origin: true, credentials: true });
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api`;
    const jwt = app.get(JwtService);
    const root = await db.user.create({ data: {
      ...credentials(), password: undefined, passwordHash: await bcrypt.hash(password, 4), role: 'ROOT',
    } });
    const token = (user) => jwt.sign({ sub: user.id, role: user.role });
    const request = async (actor, method, path, body, status = 200) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${token(actor)}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const contentType = res.headers.get('content-type') ?? '';
      const data = contentType.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
      assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data).slice(0, 500)}`);
      checks++;
      return data;
    };
    const rootPeer = await request(root, 'POST', '/auth/users/root', credentials(), 201);
    const adminA = await request(rootPeer, 'POST', '/auth/users/admin', credentials(), 201);
    const adminB = await request(root, 'POST', '/auth/users/admin', credentials(), 201);
    const restrictedCredentials = credentials();
    const restrictedPlayer = await db.user.create({ data: {
      ...restrictedCredentials, password: undefined, passwordHash: await bcrypt.hash(password, 4),
      role: 'PLAYER', permissions: ['INVITES'],
    } });
    await request(restrictedPlayer, 'GET', '/auth/invite-codes', undefined, 403);
    await request(restrictedPlayer, 'GET', '/auth/invite-quota', undefined, 403);
    await request(restrictedPlayer, 'POST', '/auth/invite-codes', { role: 'PLAYER', maxUses: 1 }, 403);
    await request(root, 'PATCH', `/auth/users/${restrictedPlayer.id}/permissions`, { permissions: ['INVITES'] }, 400);
    assert.equal((await request(adminA, 'GET', '/auth/invite-quota')).limit, 50);
    for (const role of ['admin', 'root']) await request(adminA, 'POST', `/auth/users/${role}`, credentials(), 403);
    await request(adminA, 'POST', '/v1/auth/users/admin', credentials(), 403);
    await request(adminA, 'POST', '/auth/invite-codes', { role: 'ADMIN', maxUses: 1 }, 403);
    await request(adminA, 'PATCH', `/auth/users/${adminB.id}/role`, { role: 'ROOT' }, 403);
    await request(adminA, 'PATCH', `/auth/users/${adminA.id}/invite-quota`, { limit: 500 }, 403);
    await request(root, 'PATCH', `/auth/users/${root.id}/permissions`, { permissions: [] }, 400);

    const tournamentInput = (name) => ({
      name, organizer: prefix, startDate: '2026-12-01', endDate: '2026-12-02',
      eventTypes: ['MENS_SINGLES'], includeTeamCompetition: false, maxRegistrationEvents: 1,
      allowCrossEventRegistration: false, needsRegistrationReview: true, venueNames: ['Court 1'],
      defaultMatchMinutes: 20, breakMinutes: 5, dailyStartTime: '08:00', dailyEndTime: '18:00',
    });
    const ta = await request(adminA, 'POST', '/tournaments', tournamentInput(`${prefix}-A`), 201); tournaments.push(ta.id);
    const tb = await request(adminB, 'POST', '/tournaments', tournamentInput(`${prefix}-B`), 201); tournaments.push(tb.id);
    assert.equal(ta.submittedById, adminA.id);
    assert.equal(ta.approvalStatus, 'PENDING');
    const own = await request(adminA, 'GET', '/tournaments');
    assert.deepEqual(own.map((t) => t.id), [ta.id]);
    assert.deepEqual((await request(adminA, 'GET', '/admin/competitions')).map((t) => t.id), [ta.id]);
    await request(adminA, 'GET', `/tournaments/${tb.id}`, undefined, 404);
    await request(adminA, 'PATCH', `/tournaments/${tb.id}`, { name: 'denied' }, 404);
    await request(adminA, 'POST', `/tournaments/${ta.id}/approve`, {}, 403);
    await request(adminA, 'PATCH', `/tournaments/${ta.id}/archive`, {}, 403);
    await request(adminA, 'PATCH', `/tournaments/${ta.id}`, { isArchived: true }, 403);
    await request(adminA, 'DELETE', `/tournaments/${ta.id}`, undefined, 403);
    await request(adminA, 'GET', `/admin/competitions/${tb.id}/players`, undefined, 404);
    await request(adminA, 'GET', `/admin/competitions/${tb.id}/registrations`, undefined, 404);
    await request(adminA, 'GET', `/events?tournamentId=${tb.id}`, undefined, 404);
    await request(adminA, 'GET', `/events/${tb.events[0].id}`, undefined, 404);
    assert((await request(adminA, 'GET', '/events')).every((event) => event.tournamentId === ta.id));
    await request(adminA, 'GET', `/exports/tournaments/${tb.id}/orderbook`, undefined, 404);
    await request(adminA, 'GET', `/exports/tournaments/${ta.id}/results`, undefined, 403);
    const orderbook = await request(adminA, 'GET', `/exports/tournaments/${ta.id}/orderbook`);
    assert(Buffer.isBuffer(orderbook) && orderbook.subarray(0, 2).toString() === 'PK', 'Real XLSX export must succeed');

    for (const path of ['/admin/ai-config', '/admin/announcements', '/admin/image-moderation', '/admin/email/settings', '/scoring/referees', '/team-competitions', '/usage-metrics/summary']) {
      await request(adminA, 'GET', path, undefined, 403);
    }
    // Dashboard: admins see only their own tournaments' photo stats; AI usage is ROOT-only.
    await db.photo.create({ data: { tournamentId: tb.id, uploaderId: adminB.id, category: 'MATCH', originalPath: 'qa', fullPath: 'qa', thumbnailPath: 'qa', fileSize: 1, width: 1, height: 1 } });
    assert.deepEqual((await request(adminA, 'GET', '/admin/photos/tournaments')).map((t) => t.id), []);
    assert.deepEqual((await request(adminB, 'GET', '/admin/photos/tournaments')).map((t) => t.id), [tb.id]);
    assert((await request(rootPeer, 'GET', '/admin/photos/tournaments')).some((t) => t.id === tb.id));
    await request(rootPeer, 'GET', '/usage-metrics/summary');
    for (const path of ['/admin/ai-config', '/admin/image-moderation', '/admin/email/settings']) await request(rootPeer, 'GET', path);
    assert((await request(rootPeer, 'GET', '/tournaments')).some((t) => t.id === tb.id));

    const catalog = await request(root, 'GET', '/auth/permission-options');
    assert(catalog.options.some((item) => item.key === 'AI_CONFIG'));
    const defaults = await request(root, 'GET', `/auth/users/${adminA.id}/permissions`);
    assert.equal(defaults.customized, false);
    assert(defaults.permissions.includes('TOURNAMENTS') && !defaults.permissions.includes('AI_CONFIG'));
    await request(root, 'PATCH', `/auth/users/${adminA.id}/permissions`, { permissions: ['AI_CONFIG'] });
    assert.equal((await request(root, 'GET', `/auth/users/${adminA.id}/permissions`)).customized, true);
    await request(adminA, 'GET', '/admin/ai-config');
    await request(adminA, 'GET', '/auth/invite-codes');
    await request(adminA, 'GET', '/auth/invite-quota');
    await request(adminA, 'GET', '/tournaments', undefined, 403);
    await request(root, 'PATCH', `/auth/users/${adminA.id}/permissions`, { permissions: null });
    await request(adminA, 'GET', '/tournaments');
    await request(adminA, 'GET', '/admin/ai-config', undefined, 403);

    await request(rootPeer, 'POST', `/tournaments/${ta.id}/approve`, {}, 201);
    await request(rootPeer, 'POST', `/tournaments/${tb.id}/approve`, {}, 201);
    for (const actor of [null, adminA, adminB, rootPeer, root]) {
      const lobby = await request(actor, 'GET', '/public/lobby');
      assert(lobby.competitions.some((t) => t.id === ta.id) && lobby.competitions.some((t) => t.id === tb.id), 'Public homepage must include both administrators');
      const list = await request(actor, 'GET', '/competitions');
      assert(list.some((t) => t.id === ta.id) && list.some((t) => t.id === tb.id));
    }

    const playerA = await request(adminA, 'POST', '/players', { name: `${prefix}-PA`, gender: 'MALE', affiliation: prefix }, 201);
    const playerB = await request(adminB, 'POST', '/players', { name: `${prefix}-PB`, gender: 'MALE', affiliation: prefix }, 201);
    assert.deepEqual((await request(adminA, 'GET', '/players')).map((p) => p.id), [playerA.id]);
    await request(adminA, 'GET', `/players/${playerB.id}`, undefined, 404);
    await request(adminA, 'PATCH', `/players/${playerB.id}`, { name: 'denied' }, 404);
    await request(adminA, 'POST', `/admin/competitions/${ta.id}/players/from-library`, { eventId: ta.events[0].id, player1Id: playerB.id }, 404);

    const createInvite = (actor, role, maxUses = 5) => request(actor, 'POST', '/auth/invite-codes', { role, maxUses }, 201);
    const refereeInvite = await createInvite(adminA, 'REFEREE');
    const photoInvite = await createInvite(adminA, 'PHOTOGRAPHER');
    const playerInvite = await createInvite(adminA, 'PLAYER', 100);
    const otherInvite = await createInvite(adminB, 'REFEREE');
    await request(restrictedPlayer, 'PATCH', `/auth/invite-codes/${refereeInvite.id}`, { isEnabled: false }, 403);
    await request(restrictedPlayer, 'DELETE', `/auth/invite-codes/${refereeInvite.id}`, undefined, 403);
    assert.equal((await request(adminA, 'GET', '/auth/invite-quota')).used, 0, 'Unused invitations do not reserve quota');
    assert((await request(adminA, 'GET', '/auth/invite-codes')).every((i) => i.createdById === adminA.id));
    await request(adminA, 'DELETE', `/auth/invite-codes/${otherInvite.id}`, undefined, 403);
    await request(adminA, 'PATCH', `/auth/invite-codes/${otherInvite.id}`, { isEnabled: false }, 403);
    await request(rootPeer, 'PATCH', `/auth/users/${adminA.id}/invite-quota`, { limit: 2 });
    const register = (invite, info = credentials(), status = 201) => request(null, 'POST', '/auth/register', { inviteCode: invite.code, ...info }, status);
    const staff1 = (await register(refereeInvite)).user;
    const staff2 = (await register(photoInvite)).user;
    assert.equal((await request(adminA, 'GET', '/auth/invite-quota')).used, 2);
    await register(refereeInvite, credentials(), 400);
    const freePlayer = (await register(playerInvite)).user;
    assert.equal((await request(adminA, 'GET', '/auth/invite-quota')).used, 2);
    await request(adminA, 'POST', '/auth/users/player', credentials(), 201);
    await request(adminA, 'POST', '/auth/users/referee', credentials(), 400);
    await request(adminB, 'PATCH', `/auth/users/${staff1.id}/status`, { status: 'DISABLED' }, 403);
    await request(adminB, 'POST', `/auth/users/${staff1.id}/reset-password`, {}, 403);
    await request(adminB, 'DELETE', `/auth/users/${staff1.id}`, undefined, 403);
    await request(adminB, 'DELETE', '/auth/users', { ids: [staff1.id] }, 403);
    await request(adminA, 'DELETE', `/auth/users/${staff1.id}`);
    await request(adminA, 'DELETE', '/auth/users', { ids: [staff2.id] });
    assert.equal((await request(adminA, 'GET', '/auth/invite-quota')).used, 2, 'Deleting accounts must not restore quota');
    await request(adminA, 'DELETE', `/auth/invite-codes/${refereeInvite.id}`);
    assert.equal((await request(adminA, 'GET', '/auth/invite-quota')).used, 2, 'Deleting consumed invites must not restore quota');
    await request(rootPeer, 'PATCH', `/auth/users/${adminA.id}/invite-quota`, { limit: 1 }, 400);
    await request(rootPeer, 'PATCH', `/auth/users/${adminA.id}/invite-quota`, { limit: 3 });
    const direct = await request(adminA, 'POST', '/auth/users/photographer', credentials(), 201);
    assert.equal((await request(adminA, 'GET', '/auth/invite-quota')).used, 3, 'Direct account creation must consume quota');
    await request(adminA, 'DELETE', `/auth/users/${direct.id}`);
    await request(rootPeer, 'PATCH', `/auth/users/${adminA.id}/invite-quota`, { limit: 4 });
    // One remaining place, two concurrent registrations using different codes.
    const raceInvite = await createInvite(adminA, 'REFEREE');
    const race = await Promise.all([raceInvite, photoInvite].map(async (invite) => {
      const res = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteCode: invite.code, ...credentials() }) });
      return res.status;
    }));
    assert.deepEqual(race.sort(), [201, 400], 'Concurrent registrations must not overspend the final place'); checks++;
    assert.equal((await request(adminA, 'GET', '/auth/invite-quota')).used, 4);
    // Failed account creation rolls the quota increment back.
    await request(rootPeer, 'PATCH', `/auth/users/${adminA.id}/invite-quota`, { limit: 5 });
    const singleUse = await createInvite(adminA, 'REFEREE', 1);
    await db.inviteCode.update({ where: { id: singleUse.id }, data: { isEnabled: false } });
    await register(singleUse, credentials(), 400);
    assert.equal((await request(adminA, 'GET', '/auth/invite-quota')).used, 4);
    await request(root, 'PATCH', `/auth/users/${freePlayer.id}/permissions`, { permissions: ['AI_CONFIG'] });
    await request(root, 'PATCH', `/auth/users/${freePlayer.id}/role`, { role: 'REFEREE' });
    const resetPermissions = await request(root, 'GET', `/auth/users/${freePlayer.id}/permissions`);
    assert.equal(resetPermissions.customized, false, 'Changing role restores role defaults');
    assert.deepEqual(resetPermissions.permissions, ['REFEREE']);
    assert.equal((await request(adminA, 'GET', '/auth/invite-quota')).used, 5, 'Promotion cannot create free staff');
    await request(root, 'PATCH', `/auth/users/${freePlayer.id}/role`, { role: 'PLAYER' });
    await request(root, 'PATCH', `/auth/users/${freePlayer.id}/role`, { role: 'PHOTOGRAPHER' });
    assert.equal((await request(adminA, 'GET', '/auth/invite-quota')).used, 5, 'A charged account is not charged twice');
    const managed = await request(adminA, 'GET', '/auth/users');
    assert(managed.every((u) => u.managerId === adminA.id && ['PLAYER', 'REFEREE', 'PHOTOGRAPHER'].includes(u.role)));
    assert((await request(rootPeer, 'GET', '/auth/users')).some((u) => u.id === root.id));
    // Remaining public roles see both administrators' published tournaments too.
    const player = await request(adminA, 'POST', '/auth/users/player', credentials(), 201);
    const photographer = await request(rootPeer, 'POST', '/auth/users/photographer', credentials(), 201);
    for (const actor of [player, photographer, { ...freePlayer, role: 'PHOTOGRAPHER' }]) {
      const lobby = await request(actor, 'GET', '/public/lobby');
      assert(lobby.competitions.some((t) => t.id === ta.id) && lobby.competitions.some((t) => t.id === tb.id));
    }
    if (process.argv.includes('--browser')) {
      const { browserChecks } = require('./admin-permissions.browser.cjs');
      checks += await browserChecks({ base, token, adminA, rootPeer, root, ta, tb, request, prefix });
    }
    console.log(`PASS: ${checks} permission, ownership, quota, public visibility and export checks.`);
  } finally {
    if (app) await app.close();
    await db.tournament.deleteMany({ where: { id: { in: tournaments } } });
    const users = await db.user.findMany({ where: { username: { startsWith: prefix } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await db.player.deleteMany({ where: { ownerId: { in: ids } } });
    await db.inviteCode.deleteMany({ where: { createdById: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
