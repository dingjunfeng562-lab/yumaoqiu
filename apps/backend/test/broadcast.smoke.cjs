// Run with the backend running: node --env-file=.env test/broadcast.smoke.cjs
// Covers ROOT-only management, overlay token isolation, public viewer gating
// and match-switch validation. All writes use UUID fixtures, cleaned up in finally.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { JwtService } = require('@nestjs/jwt');

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
const api = process.env.QA_API_URL || 'http://localhost:4000/api';
const jwt = new JwtService({ secret: process.env.JWT_SECRET });

const rootId = randomUUID();
const adminId = randomUUID();
const tournamentIds = [randomUUID(), randomUUID()];
const playerIds = [];
let rootToken;
let adminToken;

// NestJS answers successful POST with 201 and other methods with 200.
async function call(endpoint, { method = 'GET', body, token, expected = method === 'POST' ? 201 : 200 } = {}) {
  const response = await fetch(`${api}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  assert.equal(response.status, expected, `${method} ${endpoint} -> ${response.status}: ${text}`);
  return parsed;
}

async function main() {
  for (const [id, role, username] of [[rootId, 'ROOT', 'bc-root'], [adminId, 'ADMIN', 'bc-admin']]) {
    await prisma.user.create({ data: {
      id, username: `${username}-${id}`, email: `${id}@broadcast.invalid`, passwordHash: 'unused', role,
    } });
  }
  rootToken = jwt.sign({ sub: rootId }, { expiresIn: '20m' });
  adminToken = jwt.sign({ sub: adminId }, { expiresIn: '20m' });

  for (const [index, id] of tournamentIds.entries()) {
    await prisma.tournament.create({ data: {
      id, name: index ? '直播隔离赛事' : '直播记分牌验收赛事',
      startDate: new Date(), endDate: new Date(Date.now() + 86400000),
      status: 'ONGOING', approvalStatus: 'APPROVED', isPublished: true, submittedById: adminId,
    } });
  }

  const courts = [];
  for (let i = 0; i < 2; i++) {
    courts.push(await prisma.venue.create({ data: {
      tournamentId: tournamentIds[0], name: `${i + 1} 号场地`, sortOrder: i,
    } }));
  }
  const event = await prisma.event.create({ data: {
    tournamentId: tournamentIds[0], type: 'MENS_DOUBLES', format: 'ROUND_ROBIN',
    scoringRule: 'TWENTYONE_BO3', scoringMode: 'CAPPED_30',
  } });
  const otherEvent = await prisma.event.create({ data: {
    tournamentId: tournamentIds[1], type: 'MENS_SINGLES', format: 'ROUND_ROBIN',
    scoringRule: 'TWENTYONE_BO3', scoringMode: 'CAPPED_30',
  } });

  const players = [];
  for (const [index, name] of ['林一', '陈二', '王三', '李四'].entries()) {
    const player = await prisma.player.create({ data: {
      name, gender: 'MALE', affiliation: index < 2 ? '信息工程学院' : '体育学院',
      contact: 'PRIVATE-CONTACT', notes: 'PRIVATE-NOTES',
    } });
    players.push(player);
    playerIds.push(player.id);
  }
  const registrations = [];
  for (let i = 0; i < 2; i++) {
    registrations.push(await prisma.registration.create({ data: {
      eventId: event.id, player1Id: players[i * 2].id, player2Id: players[i * 2 + 1].id,
    } }));
  }

  const liveMatch = await prisma.match.create({ data: {
    eventId: event.id, venueId: courts[0].id, round: '小组赛', roundNo: 1, matchNo: 1,
    side1Id: registrations[0].id, side2Id: registrations[1].id,
    status: 'LIVE', startedAt: new Date(),
    games: { create: { gameNo: 1, side1Score: 11, side2Score: 7, server: 1 } },
  } });
  const otherCourtMatch = await prisma.match.create({ data: {
    eventId: event.id, venueId: courts[1].id, round: '小组赛', roundNo: 1, matchNo: 2,
    side1Id: registrations[0].id, side2Id: registrations[1].id,
  } });
  const otherTournamentMatch = await prisma.match.create({ data: {
    eventId: otherEvent.id, round: '小组赛', roundNo: 1, matchNo: 1, status: 'LIVE',
  } });

  // --- Management is ROOT-only -------------------------------------------
  await call('/broadcasts', { token: adminToken, expected: 403 });
  await call('/broadcasts', { expected: 401 });
  const created = await call('/broadcasts', {
    method: 'POST', token: rootToken,
    body: { title: '中心场地直播', tournamentId: tournamentIds[0], venueId: courts[0].id },
  });
  assert.ok(created.overlayToken, '创建时返回一次性记分牌令牌');
  assert.equal(created.status, 'READY');
  const broadcastId = created.id;
  const firstToken = created.overlayToken;

  await call(`/broadcasts/${broadcastId}`, { token: adminToken, expected: 403 });
  let detail = await call(`/broadcasts/${broadcastId}`, { token: rootToken });
  assert.ok(!JSON.stringify(detail).includes('overlayToken'), '详情不回传令牌');
  assert.equal(detail.venues.length, 2);

  // --- Match binding validation ------------------------------------------
  await call(`/broadcasts/${broadcastId}`, {
    method: 'PATCH', token: rootToken, expected: 400,
    body: { configVersion: detail.configVersion, currentMatchId: otherTournamentMatch.id },
  });
  await call(`/broadcasts/${broadcastId}`, {
    method: 'PATCH', token: rootToken, expected: 400,
    body: { configVersion: detail.configVersion, currentMatchId: otherCourtMatch.id },
  });
  detail = await call(`/broadcasts/${broadcastId}`, {
    method: 'PATCH', token: rootToken,
    body: { configVersion: detail.configVersion, currentMatchId: liveMatch.id },
  });
  assert.equal(detail.currentMatchId, liveMatch.id);
  // Stale version is rejected instead of silently overwriting.
  await call(`/broadcasts/${broadcastId}`, {
    method: 'PATCH', token: rootToken, expected: 409,
    body: { configVersion: detail.configVersion - 1, title: '并发写入' },
  });

  // --- Overlay token read -------------------------------------------------
  const overlay = await call(`/broadcast-overlays/${firstToken}`);
  assert.equal(overlay.match.id, liveMatch.id);
  assert.equal(overlay.match.side1.players.length, 2);
  assert.equal(overlay.match.games[0].side1Score, 11);
  assert.equal(overlay.settings.scoreDelaySeconds, 0);
  assert.ok(!JSON.stringify(overlay).includes('PRIVATE-'), '不泄露联系方式和备注');
  assert.ok(!JSON.stringify(overlay).includes('referee'), '不泄露裁判账号字段');
  assert.ok(!JSON.stringify(overlay).includes('events'), '不泄露内部事件记录');
  await call('/broadcast-overlays/not-a-real-token', { expected: 404 });

  // Style changes reach the overlay; delay is capped by the DTO.
  detail = await call(`/broadcasts/${broadcastId}`, {
    method: 'PATCH', token: rootToken,
    body: { configVersion: detail.configVersion, overlaySettings: { ...detail.overlaySettings, scoreDelaySeconds: 3, swapSides: true } },
  });
  assert.equal((await call(`/broadcast-overlays/${firstToken}`)).settings.scoreDelaySeconds, 3);
  await call(`/broadcasts/${broadcastId}`, {
    method: 'PATCH', token: rootToken, expected: 400,
    body: { configVersion: detail.configVersion, overlaySettings: { ...detail.overlaySettings, scoreDelaySeconds: 99 } },
  });

  // --- Rotating the token invalidates the old link -----------------------
  const rotated = await call(`/broadcasts/${broadcastId}/rotate-overlay-token`, { method: 'POST', token: rootToken });
  assert.notEqual(rotated.overlayToken, firstToken);
  await call(`/broadcast-overlays/${firstToken}`, { expected: 404 });
  assert.equal((await call(`/broadcast-overlays/${rotated.overlayToken}`)).match.id, liveMatch.id);

  // --- Realtime: a scoring write pushes a filtered snapshot ---------------
  {
    const path = require('node:path');
    const { createRequire } = require('node:module');
    const frontendRequire = createRequire(path.resolve(__dirname, '../../frontend/package.json'));
    const { io } = frontendRequire('socket.io-client');
    const socket = io(`${api.replace(/\/api\/?$/, '')}/broadcasts`, { transports: ['websocket'] });
    try {
      const rejected = await socket.timeout(5000).emitWithAck('joinOverlay', { token: firstToken });
      assert.equal(rejected.ok, false, '旧令牌不能加入实时房间');
      const joined = await socket.timeout(5000).emitWithAck('joinOverlay', { token: rotated.overlayToken });
      assert.equal(joined.ok, true);
      assert.equal(joined.snapshot.match.id, liveMatch.id);
      const pushed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('未收到 broadcast:update 推送')), 5000);
        socket.on('broadcast:update', (snapshot) => { clearTimeout(timer); resolve(snapshot); });
      });
      // Same emit path as referee scoring (ScoringController -> emitMatchState).
      await call(`/matches/${liveMatch.id}/score`, {
        method: 'PATCH', token: rootToken, body: { games: [{ side1Score: 12, side2Score: 7 }] },
      });
      const snapshot = await pushed;
      assert.equal(snapshot.match.games[0].side1Score, 12);
      assert.ok(snapshot.seq > joined.snapshot.seq, '推送序号递增');
      assert.ok(!JSON.stringify(snapshot).includes('PRIVATE-'));
      assert.ok(!JSON.stringify(snapshot).includes('referee'));
    } finally {
      socket.disconnect();
    }
  }

  // --- Website viewers ----------------------------------------------------
  detail = await call(`/broadcasts/${broadcastId}`, { token: rootToken });
  await call(`/public/broadcasts/${broadcastId}`, { expected: 404 });
  detail = await call(`/broadcasts/${broadcastId}`, {
    method: 'PATCH', token: rootToken,
    body: {
      configVersion: detail.configVersion, isPublic: true, status: 'LIVE',
      playbackUrl: 'https://live.example.com/live/qa.m3u8',
    },
  });
  const publicView = await call(`/public/broadcasts/${broadcastId}`);
  assert.equal(publicView.status, 'LIVE');
  assert.equal(publicView.playbackUrl, 'https://live.example.com/live/qa.m3u8');
  assert.equal(publicView.currentMatch.side1Name, '林一 / 陈二');
  assert.ok(!JSON.stringify(publicView).includes('overlayToken'));
  assert.ok(!JSON.stringify(publicView).includes('streamName'));
  assert.equal((await call('/public/broadcasts')).some((item) => item.id === broadcastId), true);

  // Viewer scorecard: the same filtered snapshot, no token required.
  const viewerScore = await call(`/public/broadcasts/${broadcastId}/score`);
  assert.equal(viewerScore.match.id, liveMatch.id);
  assert.equal(viewerScore.match.side1.players[0].name, '林一');
  assert.equal(viewerScore.match.eventTypeLabel, '男子双打');
  assert.equal(viewerScore.settings.visible, true);
  assert.ok(!JSON.stringify(viewerScore).includes('PRIVATE-'), '观众端不泄露联系方式');
  assert.ok(!JSON.stringify(viewerScore).includes('overlayToken'));
  assert.equal((await fetch(`${api}/public/broadcasts/does-not-exist/score`)).status, 404);
  // http playback addresses are rejected: viewers are served over https.
  await call(`/broadcasts/${broadcastId}`, {
    method: 'PATCH', token: rootToken, expected: 400,
    body: { configVersion: detail.configVersion, playbackUrl: 'http://insecure.example.com/live.m3u8' },
  });

  // --- Realtime for website viewers, with no token at all ------------------
  {
    const path = require('node:path');
    const { createRequire } = require('node:module');
    const frontendRequire = createRequire(path.resolve(__dirname, '../../frontend/package.json'));
    const { io } = frontendRequire('socket.io-client');
    const socket = io(`${api.replace(/\/api\/?$/, '')}/broadcasts`, { transports: ['websocket'] });
    try {
      const unknown = await socket.timeout(5000).emitWithAck('joinViewer', { broadcastId: 'no-such-broadcast' });
      assert.equal(unknown.ok, false, '不存在的直播间不能加入');
      const joined = await socket.timeout(5000).emitWithAck('joinViewer', { broadcastId });
      assert.equal(joined.ok, true);
      assert.equal(joined.snapshot.match.id, liveMatch.id);
      assert.ok(!JSON.stringify(joined.snapshot).includes('PRIVATE-'));

      const pushed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('观众端未收到比分推送')), 5000);
        socket.on('broadcast:update', (snapshot) => { clearTimeout(timer); resolve(snapshot); });
      });
      await call(`/matches/${liveMatch.id}/score`, {
        method: 'PATCH', token: rootToken, body: { games: [{ side1Score: 13, side2Score: 7 }] },
      });
      assert.equal((await pushed).match.games[0].side1Score, 13, '裁判计分实时到达观众端');

      // Rotating the OBS token must not interrupt the website audience: the
      // viewer page is keyed by broadcast id, not by the overlay token.
      const afterRotate = new Promise((resolve) => {
        const timer = setTimeout(() => resolve('silent'), 6000);
        socket.on('broadcast:revoked', () => { clearTimeout(timer); resolve('revoked'); });
      });
      const newToken = await call(`/broadcasts/${broadcastId}/rotate-overlay-token`, { method: 'POST', token: rootToken });
      await call(`/matches/${liveMatch.id}/score`, {
        method: 'PATCH', token: rootToken, body: { games: [{ side1Score: 14, side2Score: 7 }] },
      });
      assert.equal((await call(`/public/broadcasts/${broadcastId}/score`)).match.games[0].side1Score, 14);
      assert.notEqual(await afterRotate, 'revoked', '重置记分牌链接不影响观众端');
      assert.ok(newToken.overlayToken);

      // Switching the broadcast off drops the audience and clears the board.
      const revoked = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('停用直播后观众端未收到撤销')), 5000);
        socket.on('broadcast:revoked', () => { clearTimeout(timer); resolve(true); });
      });
      let state = await call(`/broadcasts/${broadcastId}`, { token: rootToken });
      state = await call(`/broadcasts/${broadcastId}`, {
        method: 'PATCH', token: rootToken, body: { configVersion: state.configVersion, enabled: false },
      });
      assert.equal(await revoked, true, '停用直播时清空观众端并断开');
      assert.equal((await fetch(`${api}/public/broadcasts/${broadcastId}/score`)).status, 404);
      await call(`/broadcasts/${broadcastId}`, {
        method: 'PATCH', token: rootToken, body: { configVersion: state.configVersion, enabled: true },
      });
    } finally {
      socket.disconnect();
    }
  }

  // --- Publication state gates both overlay and viewer -------------------
  for (const update of [{ isPublished: false }, { isArchived: true }, { approvalStatus: 'PENDING' }]) {
    await prisma.tournament.update({ where: { id: tournamentIds[0] }, data: update });
    await call(`/broadcast-overlays/${rotated.overlayToken}`, { expected: 404 });
    await call(`/public/broadcasts/${broadcastId}`, { expected: 404 });
    // The logged-in ROOT preview keeps working for rehearsal.
    assert.ok(await call(`/broadcasts/${broadcastId}/preview`, { token: rootToken }));
    await prisma.tournament.update({
      where: { id: tournamentIds[0] },
      data: { isPublished: true, isArchived: false, approvalStatus: 'APPROVED' },
    });
  }

  // --- Disabling and ending ----------------------------------------------
  detail = await call(`/broadcasts/${broadcastId}`, { token: rootToken });
  detail = await call(`/broadcasts/${broadcastId}`, {
    method: 'PATCH', token: rootToken, body: { configVersion: detail.configVersion, enabled: false },
  });
  await call(`/broadcast-overlays/${rotated.overlayToken}`, { expected: 404 });
  await call(`/public/broadcasts/${broadcastId}`, { expected: 404 });
  detail = await call(`/broadcasts/${broadcastId}`, {
    method: 'PATCH', token: rootToken, body: { configVersion: detail.configVersion, enabled: true },
  });
  const ended = await call(`/broadcasts/${broadcastId}/end`, { method: 'POST', token: rootToken });
  assert.equal(ended.status, 'ENDED');
  assert.equal((await call(`/public/broadcasts/${broadcastId}`)).playbackUrl, null, '结束后不再下发播放地址');

  await call(`/broadcasts/${broadcastId}`, { method: 'DELETE', token: adminToken, expected: 403 });
  await call(`/broadcasts/${broadcastId}`, { method: 'DELETE', token: rootToken });
  await call(`/broadcasts/${broadcastId}`, { token: rootToken, expected: 404 });
  // Deleting a broadcast must not touch the match or its scores.
  assert.ok(await prisma.match.findUnique({ where: { id: liveMatch.id } }));
  assert.equal((await prisma.game.findFirst({ where: { matchId: liveMatch.id } })).side1Score, 14);

  console.log('broadcast smoke: OK');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    await prisma.broadcastSession.deleteMany({ where: { tournamentId: { in: tournamentIds } } });
    await prisma.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
    await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [rootId, adminId] } } });
    await prisma.$disconnect();
  });
