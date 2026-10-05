// Local API + browser acceptance. Creates and removes only its own fixtures.
// node --env-file=.env test/broadcast-lifecycle.smoke.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { JwtService } = require('@nestjs/jwt');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/baishuwan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
if (!['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Local database required');
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
const api = process.env.QA_API_URL || 'http://localhost:4000/api';
const site = process.env.QA_SITE_URL || 'http://localhost:3000';
const frontend = path.resolve(__dirname, '../../frontend');
const localRequire = createRequire(path.join(frontend, 'package.json'));
const shots = path.resolve(__dirname, '../../../output/playwright');
const ids = { user: randomUUID(), director: randomUUID(), tournament: randomUUID() };
const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: ids.user }, { expiresIn: '20m' });
let browser, broadcastId;

async function call(endpoint, body, auth = token, expected = 200) {
  const response = await fetch(api + endpoint, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  assert.ok(response.status === expected || expected === 200 && response.status === 201, `${endpoint}: ${response.status} ${result.message || ''}`);
  return result;
}
async function until(check, label) {
  const end = Date.now() + 25000;
  do { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 500)); } while (Date.now() < end);
  throw new Error(`Timed out: ${label}`);
}
async function main() {
  await mkdir(shots, { recursive: true });
  await db.user.create({ data: { id: ids.user, username: `lifecycle-${ids.user}`, email: `${ids.user}@test.invalid`, passwordHash: 'unused', role: 'ROOT' } });
  await db.user.create({ data: { id: ids.director, username: `lifecycle-${ids.director}`, email: `${ids.director}@test.invalid`, passwordHash: 'unused', role: 'ADMIN' } });
  await db.tournament.create({ data: { id: ids.tournament, name: '直播重新开始验收', startDate: new Date(), endDate: new Date(),
    status: 'ONGOING', approvalStatus: 'APPROVED', isPublished: true, submittedById: ids.user } });
  broadcastId = (await call('/broadcasts', { title: '重新开播验收直播间', tournamentId: ids.tournament })).id;
  const base = `/broadcasts/${broadcastId}/live`;
  const publicPath = `/public/broadcasts/${broadcastId}`;
  await call(publicPath, undefined, null, 404);
  const directorToken = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: ids.director }, { expiresIn: '20m' });
  const enabled = await call(base + '/enable', { cameraCount: 1 });
  await call(base + '/directors', { userId: ids.director, canAudio: false });
  let restricted = await call(base + '/start', { sequence: enabled.sequence }, directorToken);
  assert.equal(restricted.audioCameraId, null, 'a video-only director cannot select master audio by starting');
  await call(base + '/pause', { sequence: restricted.sequence }, directorToken);
  createRequire(localRequire.resolve('next/package.json'))('@next/env').loadEnvConfig(frontend);
  const { encode } = await import(pathToFileURL(localRequire.resolve('next-auth/jwt')).href);
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'authjs.session-token', url: site, value: await encode({
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET, salt: 'authjs.session-token', token: {
      sub: ids.user, name: 'ROOT', role: 'ROOT', status: 'ACTIVE', accessToken: token, accessTokenExpiresAt: Date.now() + 3600000,
    },
  }) }]);
  const admin = await context.newPage();
  const errors = [];
  admin.on('pageerror', (e) => errors.push(e.message));
  await admin.goto(`${site}/admin/broadcasts?tournamentId=${ids.tournament}`);
  await admin.getByText('重新开播验收直播间', { exact: true }).click();
  await admin.getByRole('button', { name: '开始直播', exact: true }).click();
  await until(async () => (await call(base)).waiting, 'start without a phone');
  let state = await call(base);
  assert.equal(state.status, 'READY');
  assert.equal(state.cameras.length, 1);
  assert.equal(state.activeCameraId, state.cameras[0].id);
  assert.equal(state.audioCameraId, state.cameras[0].id);
  assert.equal((await call(publicPath, undefined, null)).playbackUrl, null);
  await call(publicPath + '/live/token', {}, null, 404);
  const viewer = await browser.newPage({ viewport: { width: 390, height: 844 } });
  viewer.on('pageerror', (e) => errors.push(e.message));
  await viewer.goto(`${site}/live/${broadcastId}`);
  await viewer.locator('[data-broadcast-player]').getByText('待开始', { exact: true }).waitFor();
  assert.equal(await viewer.locator('video').count(), 0);
  assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await viewer.screenshot({ path: path.join(shots, 'broadcast-waiting-phone.png'), fullPage: true });
  const invite = await call(base + '/join-code', {});
  const oldPhone = await call('/live-camera/redeem', { code: invite.code, deviceId: randomUUID() }, null);
  await call('/live-camera/heartbeat', { state: 'STREAMING', fps: 30, width: 1280, height: 720 }, oldPhone.credential);
  assert.equal((await call(base)).status, 'READY', 'heartbeat cannot publish without media');
  console.log('PASS: management start without camera; anonymous mobile waiting page; video access denied; heartbeat is not video readiness');

  await admin.getByRole('button', { name: /结束直播间/ }).click();
  await admin.locator('.ant-popconfirm').getByRole('button', { name: /结\s*束/ }).click();
  await until(async () => (await call(base)).status === 'ENDED', 'management end');
  await viewer.locator('[data-broadcast-player]').getByText('直播已结束', { exact: true }).waitFor({ timeout: 15000 });
  await call('/live-camera/config', undefined, oldPhone.credential, 401);
  await admin.getByRole('button', { name: '开始直播', exact: true }).click();
  await until(async () => (await call(base)).waiting, 'management restart');
  state = await call(base);
  assert.ok(state.cameras.every((c) => !c.paired && !c.online));
  const reopened = await call(publicPath, undefined, null);
  assert.equal(reopened.endedAt, null);
  assert.equal(reopened.startedAt, null);
  await call(base + '/start', { sequence: state.sequence - 1 }, token, 409);
  await viewer.locator('[data-broadcast-player]').getByText('待开始', { exact: true }).waitFor({ timeout: 15000 });
  await call('/live-camera/redeem', { code: invite.code, deviceId: randomUUID() }, null, 401);
  console.log('PASS: management end/restart; same viewer recovers without reload; old device and QR revoked; stale commands rejected');

  const newInvite = await call(base + '/join-code', {});
  const phone = await call('/live-camera/redeem', { code: newInvite.code, deviceId: randomUUID() }, null);
  const config = await call('/live-camera/join', {}, phone.credential);
  assert.equal(config.audioEnabled, true);
  const camera = await browser.newPage();
  await camera.goto(site + '/login');
  await camera.addScriptTag({ path: path.join(frontend, 'node_modules/livekit-client/dist/livekit-client.umd.js') });
  await camera.evaluate(async (config) => {
    const sdk = window.LivekitClient;
    const room = new sdk.Room();
    await room.connect(config.media.url, config.media.token, { autoSubscribe: false });
    room.localParticipant.setTrackSubscriptionPermissions(false, []);
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    document.body.replaceChildren(canvas);
    const ctx = canvas.getContext('2d');
    setInterval(() => { ctx.fillStyle = '#235aa5'; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = '#fff'; ctx.font = '48px sans-serif'; ctx.fillText('Live camera ' + Date.now(), 100, 200); }, 33);
    await room.localParticipant.publishTrack(canvas.captureStream(30).getVideoTracks()[0], { source: sdk.Track.Source.Camera });
    const audio = new AudioContext(); const osc = audio.createOscillator(); const out = audio.createMediaStreamDestination();
    osc.connect(out); osc.start(); await audio.resume();
    // Publish audio separately so the test can verify that video alone stays READY.
    window.publishAudio = () => room.localParticipant.publishTrack(out.stream.getAudioTracks()[0], { source: sdk.Track.Source.Microphone });
    const permissions = () => {
      const control = JSON.parse(room.metadata || '{}');
      room.localParticipant.setTrackSubscriptionPermissions(false, Array.from(room.remoteParticipants.values()).map((p) => ({
        participantIdentity: p.identity, allowAll: p.identity.startsWith('director_'),
        allowedTrackSids: Array.from(room.localParticipant.trackPublications.values()).filter((pub) => control.live &&
          (pub.kind === 'audio' ? control.audioCameraId === config.cameraId : control.activeCameraId === config.cameraId)).map((pub) => pub.trackSid),
      })));
    };
    room.on(sdk.RoomEvent.RoomMetadataChanged, permissions); room.on(sdk.RoomEvent.ParticipantConnected, permissions);
    room.on(sdk.RoomEvent.LocalTrackPublished, permissions); permissions(); setInterval(permissions, 1000);
  }, config);
  await camera.waitForTimeout(4000);
  assert.equal((await call(base)).status, 'READY', 'video alone must wait for main audio');
  await camera.evaluate(() => window.publishAudio());
  await until(async () => (await call(base)).status === 'LIVE', 'automatic start with actual video and audio');
  await viewer.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.videoWidth >= 1280 && getComputedStyle(v).opacity === '1'), { timeout: 30000 });
  await viewer.screenshot({ path: path.join(shots, 'broadcast-restarted-live-phone.png'), fullPage: true });
  state = await call(base);
  await call(base + '/end', { sequence: state.sequence });
  await viewer.locator('[data-broadcast-player]').getByText('直播已结束', { exact: true }).waitFor({ timeout: 15000 });
  state = await call(base);
  state = await call(base + '/start', { sequence: state.sequence });
  assert.equal(state.waiting, true);
  await call(publicPath + '/live/token', {}, null, 404);
  state = await call(base + '/pause', { sequence: state.sequence });
  await call(publicPath, undefined, null, 404);
  await call(base + '/end', { sequence: state.sequence });
  assert.deepEqual(errors, []);
  console.log('PASS: real video plus audio auto-start; same anonymous viewer plays; director end/restart; pause remains private; no browser exceptions');
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (broadcastId) {
    await call(`/broadcasts/${broadcastId}/end`, {}).catch(() => {});
    await db.broadcastSession.deleteMany({ where: { id: broadcastId } });
  }
  await db.tournament.deleteMany({ where: { id: ids.tournament } });
  await db.user.deleteMany({ where: { id: { in: [ids.user, ids.director] } } });
  await db.$disconnect();
});
