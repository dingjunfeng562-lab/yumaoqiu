// Stage-1 acceptance for the OBS scoreboard against real scoring writes.
// Run with the backend running: node --env-file=.env test/broadcast-scoring.smoke.cjs
// Walks start -> points -> undo -> pause/resume -> correction -> pending finish
// -> confirm finish -> court swap -> manual switch, reading the overlay each step.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { JwtService } = require('@nestjs/jwt');

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
const api = process.env.QA_API_URL || 'http://localhost:4000/api';
const rootId = randomUUID();
const tournamentId = randomUUID();
const playerIds = [];
let rootToken;

async function call(endpoint, { method = 'GET', body, token = rootToken, expected } = {}) {
  const response = await fetch(`${api}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const want = expected ?? (method === 'POST' ? 201 : 200);
  assert.equal(response.status, want, `${method} ${endpoint} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const scoreOf = (snapshot) => {
  const game = snapshot.match.games.find((item) => item.gameNo === snapshot.match.currentGameNo)
    ?? snapshot.match.games.at(-1);
  return game ? [game.side1Score, game.side2Score] : [0, 0];
};

async function main() {
  await prisma.user.create({ data: {
    id: rootId, username: `bc-flow-${rootId}`, email: `${rootId}@broadcast.invalid`, passwordHash: 'unused', role: 'ROOT',
  } });
  rootToken = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: rootId }, { expiresIn: '20m' });

  await prisma.tournament.create({ data: {
    id: tournamentId, name: '记分牌流程验收赛事', startDate: new Date(), endDate: new Date(Date.now() + 86400000),
    status: 'ONGOING', approvalStatus: 'APPROVED', isPublished: true, submittedById: rootId,
  } });
  const court = await prisma.venue.create({ data: { tournamentId, name: '中心场地', sortOrder: 0 } });
  const singles = await prisma.event.create({ data: {
    tournamentId, type: 'MENS_SINGLES', format: 'ROUND_ROBIN', scoringRule: 'FIFTEEN_ONE', scoringMode: 'STANDARD_GOLDEN',
  } });
  const doubles = await prisma.event.create({ data: {
    tournamentId, type: 'MIXED_DOUBLES', format: 'ROUND_ROBIN', scoringRule: 'FIFTEEN_ONE', scoringMode: 'STANDARD_GOLDEN',
  } });
  const player = async (name, gender, affiliation) => {
    const created = await prisma.player.create({ data: { name, gender, affiliation } });
    playerIds.push(created.id);
    return created;
  };
  const [a, b] = [await player('张单', 'MALE', '数学学院'), await player('刘单', 'MALE', '物理学院')];
  const [c, d, e, f] = [
    await player('周男', 'MALE', '化学学院'), await player('吴女', 'FEMALE', '化学学院'),
    await player('郑男', 'MALE', '外语学院'), await player('冯女', 'FEMALE', '外语学院'),
  ];
  const regA = await prisma.registration.create({ data: { eventId: singles.id, player1Id: a.id } });
  const regB = await prisma.registration.create({ data: { eventId: singles.id, player1Id: b.id } });
  const regC = await prisma.registration.create({ data: { eventId: doubles.id, player1Id: c.id, player2Id: d.id } });
  const regD = await prisma.registration.create({ data: { eventId: doubles.id, player1Id: e.id, player2Id: f.id } });
  const singlesMatch = await prisma.match.create({ data: {
    eventId: singles.id, venueId: court.id, round: '决赛', roundNo: 1, matchNo: 1, side1Id: regA.id, side2Id: regB.id,
  } });
  const doublesMatch = await prisma.match.create({ data: {
    eventId: doubles.id, venueId: court.id, round: '小组赛', roundNo: 1, matchNo: 2, side1Id: regC.id, side2Id: regD.id,
  } });

  const created = await call('/broadcasts', { method: 'POST', body: { title: '流程验收直播', tournamentId, venueId: court.id } });
  let detail = await call(`/broadcasts/${created.id}`, {
    method: 'PATCH', body: { configVersion: created.configVersion, currentMatchId: singlesMatch.id },
  });
  const overlay = () => call(`/broadcast-overlays/${created.overlayToken}`, { token: null });
  const point = (side) => call(`/matches/${singlesMatch.id}/point`, { method: 'POST', body: { side } });

  // 未开赛：显示双方，没有局分。
  let snap = await overlay();
  assert.equal(snap.match.status, 'PENDING');
  assert.equal(snap.match.side1.players[0].name, '张单');
  assert.equal(snap.match.side1.players[0].affiliation, '数学学院');
  assert.equal(snap.match.eventTypeLabel, '男子单打');
  assert.equal(snap.match.gamesToWin, 1, '沿用阶段计分规则');
  let seq = snap.seq;

  // 开赛 + 加分 + 发球方。
  await call(`/matches/${singlesMatch.id}/start`, {
    method: 'POST', body: { servingSide: 1, serverPlayerIndex: 1, receiverPlayerIndex: 1 },
  });
  for (const side of [1, 1, 1, 2]) await point(side);
  snap = await overlay();
  assert.equal(snap.match.status, 'LIVE');
  assert.deepEqual(scoreOf(snap), [3, 1]);
  assert.equal(snap.match.servingSide, 2, '得分方获得发球权');
  assert.ok(snap.seq > seq, '序号单调递增'); seq = snap.seq;

  // 撤销是新的权威状态，比分可以变小。
  await call(`/matches/${singlesMatch.id}/undo`, { method: 'POST' });
  snap = await overlay();
  assert.deepEqual(scoreOf(snap), [3, 0]);
  assert.equal(snap.match.servingSide, 1);

  // 暂停期间禁止加分，记分牌显示暂停。
  await call(`/matches/${singlesMatch.id}/pause`, { method: 'POST', body: { reason: '擦地' } });
  assert.equal((await overlay()).match.paused, true);
  await call(`/matches/${singlesMatch.id}/point`, { method: 'POST', body: { side: 1 }, expected: 400 });
  await call(`/matches/${singlesMatch.id}/resume`, { method: 'POST' });
  assert.equal((await overlay()).match.paused, false);

  // 纠错：直接改为 14:9。
  await call(`/matches/${singlesMatch.id}/score`, { method: 'PATCH', body: { games: [{ side1Score: 14, side2Score: 9 }] } });
  snap = await overlay();
  assert.deepEqual(scoreOf(snap), [14, 9]);

  // 赛点得分：进入待确认完赛，不由直播端自行判定结束。
  await point(1);
  snap = await overlay();
  assert.equal(snap.match.pendingFinish, true);
  assert.equal(snap.match.status, 'LIVE');
  assert.deepEqual(scoreOf(snap), [15, 9]);

  // 交换场地：记分牌上下顺序不变（side1 仍在上）。
  await call(`/matches/${singlesMatch.id}/swap-court`, { method: 'POST' });
  snap = await overlay();
  assert.equal(snap.match.side1.players[0].name, '张单');
  assert.deepEqual(scoreOf(snap), [15, 9]);

  // 裁判确认后结束，最终比分保留。
  await call(`/matches/${singlesMatch.id}/finish`, { method: 'POST' });
  snap = await overlay();
  assert.equal(snap.match.status, 'COMPLETED');
  assert.equal(snap.match.pendingFinish, false);
  assert.equal(snap.match.winnerSide, 1);
  assert.equal(snap.match.side1Games, 1);
  assert.deepEqual(scoreOf(snap), [15, 9]);

  // 手动切换到混双：配置版本递增，记分牌立即换场。
  const before = snap.configVersion;
  detail = await call(`/broadcasts/${created.id}`, {
    method: 'PATCH', body: { configVersion: detail.configVersion, currentMatchId: doublesMatch.id },
  });
  snap = await overlay();
  assert.equal(snap.match.id, doublesMatch.id);
  assert.ok(snap.configVersion > before);
  assert.equal(snap.match.eventTypeLabel, '混合双打');
  assert.deepEqual(snap.match.side1.players.map((item) => item.name), ['周男', '吴女']);
  assert.deepEqual(snap.match.side2.players.map((item) => item.name), ['郑男', '冯女']);
  assert.deepEqual(scoreOf(snap), [0, 0], '不残留上一场比分');

  // 管理界面的比赛下拉包含两场，且标签正确。
  const labels = detail.matches.map((item) => `${item.eventName}|${item.side1Name}|${item.side2Name}`);
  assert.ok(labels.includes('男子单打|张单|刘单'));
  assert.ok(labels.includes('混合双打|周男 / 吴女|郑男 / 冯女'));

  // 团体赛单项：选手来自本场阵容，显示队名。
  const teamCompetition = await prisma.teamCompetition.create({ data: { tournamentId, name: '学院团体赛' } });
  const item = await prisma.teamCompetitionItem.create({
    data: { teamCompetitionId: teamCompetition.id, eventType: 'MENS_DOUBLES', sortOrder: 0 },
  });
  const team1 = await prisma.team.create({ data: { teamCompetitionId: teamCompetition.id, name: '数学队', affiliation: '数学学院' } });
  const team2 = await prisma.team.create({ data: { teamCompetitionId: teamCompetition.id, name: '物理队', affiliation: '物理学院' } });
  const [g, h, i, j] = [
    await player('孙甲', 'MALE', '数学学院'), await player('钱乙', 'MALE', '数学学院'),
    await player('赵丙', 'MALE', '物理学院'), await player('何丁', 'MALE', '物理学院'),
  ];
  const teamMatch = await prisma.teamMatch.create({ data: {
    teamCompetitionId: teamCompetition.id, round: '决赛', roundNo: 1, matchNo: 1, team1Id: team1.id, team2Id: team2.id,
  } });
  await prisma.teamLineup.create({ data: {
    teamMatchId: teamMatch.id, teamCompetitionItemId: item.id, teamId: team1.id, player1Id: g.id, player2Id: h.id,
  } });
  await prisma.teamLineup.create({ data: {
    teamMatchId: teamMatch.id, teamCompetitionItemId: item.id, teamId: team2.id, player1Id: i.id, player2Id: j.id,
  } });
  const teamGame = await prisma.match.create({ data: {
    teamMatchId: teamMatch.id, teamCompetitionItemId: item.id, venueId: court.id, round: '决赛', roundNo: 1, matchNo: 3,
    side1Id: `lineup:${team1.id}:${item.id}`, side2Id: `lineup:${team2.id}:${item.id}`,
    status: 'LIVE', games: { create: { gameNo: 1, side1Score: 6, side2Score: 4, server: 1 } },
  } });
  detail = await call(`/broadcasts/${created.id}`, { method: 'GET' });
  const teamOption = detail.matches.find((option) => option.id === teamGame.id);
  assert.ok(teamOption, '团体单项出现在比赛列表');
  assert.equal(teamOption.eventName, '团体赛·男子双打');
  assert.equal(teamOption.side1Name, '数学队：孙甲 / 钱乙');
  detail = await call(`/broadcasts/${created.id}`, {
    method: 'PATCH', body: { configVersion: detail.configVersion, currentMatchId: teamGame.id },
  });
  snap = await overlay();
  assert.equal(snap.match.id, teamGame.id);
  assert.deepEqual(snap.match.side1.players.map((p) => p.name), ['孙甲', '钱乙']);
  assert.deepEqual(snap.match.side2.players.map((p) => p.name), ['赵丙', '何丁']);
  assert.equal(snap.match.side1.teamName, '数学队');
  assert.deepEqual(scoreOf(snap), [6, 4]);

  // Socket path for the frontend overlay page.
  const { io } = createRequire(path.resolve(__dirname, '../../frontend/package.json'))('socket.io-client');
  const socket = io(`${api.replace(/\/api\/?$/, '')}/broadcasts`, { transports: ['websocket'] });
  try {
    const joined = await socket.timeout(5000).emitWithAck('joinOverlay', { token: created.overlayToken });
    assert.equal(joined.ok, true);
    const configEvent = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('未收到 broadcast:config')), 5000);
      socket.on('broadcast:config', (payload) => { clearTimeout(timer); resolve(payload); });
    });
    await call(`/broadcasts/${created.id}`, {
      method: 'PATCH', body: { configVersion: detail.configVersion, overlaySettings: { ...detail.overlaySettings, position: 'bottom-right' } },
    });
    assert.equal((await configEvent).settings.position, 'bottom-right', '样式变更即时推送');

    const revoked = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('未收到 broadcast:revoked')), 5000);
      socket.on('broadcast:revoked', () => { clearTimeout(timer); resolve(true); });
    });
    await call(`/broadcasts/${created.id}/rotate-overlay-token`, { method: 'POST' });
    assert.equal(await revoked, true, '重置令牌时关闭旧订阅');
  } finally {
    socket.disconnect();
  }

  console.log('broadcast scoring flow: OK');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    await prisma.broadcastSession.deleteMany({ where: { tournamentId } });
    await prisma.tournament.deleteMany({ where: { id: tournamentId } });
    await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.user.deleteMany({ where: { id: rootId } });
    await prisma.$disconnect();
  });
