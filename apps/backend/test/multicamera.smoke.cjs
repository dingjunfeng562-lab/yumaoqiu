// Requires the isolated API on 4010, frontend on 3000 and local LiveKit on 7880.
// Creates/cleans its own database fixtures. Camera feeds are generated in browsers.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { JwtService } = require('@nestjs/jwt');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/baishuwan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
const api = process.env.QA_API_URL || 'http://127.0.0.1:4010/api';
const site = 'http://localhost:3000';
const ids = { root: randomUUID(), director: randomUUID(), outsider: randomUUID(), tournament: randomUUID() };
const frontend = path.resolve(__dirname, '../../frontend');
const localRequire = createRequire(path.join(frontend, 'package.json'));
const jwt = new JwtService({ secret: process.env.JWT_SECRET });
const tokens = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, jwt.sign({ sub: id }, { expiresIn: '20m' })]));
let browser, broadcastId;
const heartbeats = [];

async function call(endpoint, token = tokens.root, body, expected = 200) {
  const response = await fetch(api + endpoint, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  assert.ok(response.status === expected || expected === 200 && response.status === 201, `${endpoint} -> ${response.status}: ${result.message || ''}`);
  return result;
}

async function camera(cameraId, color, master = false, admission) {
  let redeem = admission;
  if (!redeem) {
    const code = await call(`/broadcasts/${broadcastId}/live/cameras/${cameraId}/pair`, tokens.root, {});
    redeem = await call('/live-camera/redeem', null, { code: code.code, deviceId: randomUUID() });
    await call('/live-camera/redeem', null, { code: code.code, deviceId: randomUUID() }, 401);
  }
  if (master) {
    const state = await call(`/broadcasts/${broadcastId}/live`);
    await call(`/broadcasts/${broadcastId}/live/audio`, tokens.root, { sequence: state.sequence, cameraId });
  }
  const config = await call('/live-camera/join', redeem.credential, {});
  const page = await browser.newPage();
  await page.goto(site + '/login');
  await page.addScriptTag({ path: path.join(frontend, 'node_modules/livekit-client/dist/livekit-client.umd.js') });
  await page.evaluate(async ({ config, color }) => {
    const sdk = window.LivekitClient;
    const room = new sdk.Room({ dynacast: true });
    window.cameraRoom = room;
    await room.connect(config.media.url, config.media.token, { autoSubscribe: false });
    room.localParticipant.setTrackSubscriptionPermissions(false, []);
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    document.body.replaceChildren(canvas);
    const context = canvas.getContext('2d');
    setInterval(() => { context.fillStyle = color; context.fillRect(0, 0, 1280, 720); context.fillStyle = '#fff'; context.font = '48px Arial'; context.fillText(config.cameraCode + ' ' + Date.now(), 80, 180); }, 33);
    const track = canvas.captureStream(30).getVideoTracks()[0];
    await room.localParticipant.publishTrack(track, { source: sdk.Track.Source.Camera, simulcast: true });
    if (config.audioEnabled) {
      const ctx = new AudioContext(); const osc = ctx.createOscillator(); const out = ctx.createMediaStreamDestination();
      osc.frequency.value = 440; osc.connect(out); osc.start(); await ctx.resume();
      await room.localParticipant.publishTrack(out.stream.getAudioTracks()[0], { source: sdk.Track.Source.Microphone });
    }
    const permissions = () => {
      const control = JSON.parse(room.metadata || '{}');
      room.localParticipant.setTrackSubscriptionPermissions(false, Array.from(room.remoteParticipants.values()).map((p) => {
        if (p.identity.startsWith('director_')) return { participantIdentity: p.identity, allowAll: true };
        const old = control.previousCameraId === config.cameraId && Date.parse(control.transitionUntil) > Date.now();
        const sids = Array.from(room.localParticipant.trackPublications.values()).filter((pub) => control.live &&
          (pub.kind === 'audio' ? control.audioCameraId === config.cameraId : control.activeCameraId === config.cameraId || old)).map((pub) => pub.trackSid);
        return { participantIdentity: p.identity, allowAll: false, allowedTrackSids: sids };
      }));
    };
    room.on(sdk.RoomEvent.RoomMetadataChanged, permissions); room.on(sdk.RoomEvent.ParticipantConnected, permissions);
    room.on(sdk.RoomEvent.LocalTrackPublished, permissions); permissions(); setInterval(permissions, 1000);
  }, { config, color });
  const report = { state: 'STREAMING', fps: 30, width: 1280, height: 720, battery: 82, networkType: 'WIFI', audioStatus: config.audioEnabled ? 'USB_EXTERNAL' : 'DISABLED' };
  await call('/live-camera/heartbeat', redeem.credential, report);
  const timer = setInterval(() => call('/live-camera/heartbeat', redeem.credential, report).catch(() => {}), 3000);
  heartbeats.push(timer);
  return { page, credential: redeem.credential };
}

async function main() {
  for (const [key, role] of [['root', 'ROOT'], ['director', 'ADMIN'], ['outsider', 'ADMIN']]) await prisma.user.create({ data: {
    id: ids[key], username: `multicam-${key}-${ids[key]}`, email: `${ids[key]}@test.invalid`, passwordHash: 'unused', role,
  } });
  await prisma.tournament.create({ data: { id: ids.tournament, name: '多机位直播联调', startDate: new Date(), endDate: new Date(),
    status: 'ONGOING', approvalStatus: 'APPROVED', isPublished: true, submittedById: ids.root } });
  const created = await call('/broadcasts', tokens.root, { title: '羽动云赛多机位联调', tournamentId: ids.tournament }); broadcastId = created.id;
  let state = await call(`/broadcasts/${broadcastId}/live/enable`, tokens.root, { cameraCount: 3 });
  const cameras = state.cameras;
  await call(`/broadcasts/${broadcastId}/live`, tokens.outsider, undefined, 403);
  await call(`/broadcasts/${broadcastId}/live/directors`, tokens.root, { userId: ids.director, canAudio: false });
  await call(`/broadcasts/${broadcastId}/live/audio`, tokens.director, { sequence: state.sequence, cameraId: cameras[0].id }, 403);
  // Pair before selecting audio: rotating the active master pairing is intentionally refused.
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const firstCamera = cameras[0].id;
  await camera(firstCamera, '#12663c', true);
  await call(`/broadcasts/${broadcastId}/live/join-code`, tokens.outsider, {}, 403);
  const invite = await call(`/broadcasts/${broadcastId}/live/join-code`, tokens.root, {});
  const deviceIds = [randomUUID(), randomUUID()];
  const admissions = await Promise.all(deviceIds.map((deviceId) => call('/live-camera/redeem', null, { code: invite.code, deviceId })));
  assert.equal(new Set(admissions.map((a) => a.cameraId)).size, 2);
  const retry = await call('/live-camera/redeem', null, { code: invite.code, deviceId: deviceIds[0] });
  assert.equal(retry.cameraId, admissions[0].cameraId);
  assert.equal(retry.credential, admissions[0].credential);
  await call('/live-camera/redeem', null, { code: invite.code, deviceId: randomUUID() }, 409);
  await call(`/broadcasts/${broadcastId}/live/join-code`, tokens.root, { rotate: true });
  await call('/live-camera/redeem', null, { code: invite.code, deviceId: randomUUID() }, 401);
  await camera(cameras[1].id, '#235aa5', false, admissions.find((a) => a.cameraId === cameras[1].id));
  const thirdCamera = await camera(cameras[2].id, '#743b86', false, admissions.find((a) => a.cameraId === cameras[2].id));
  console.log('PASS: shared QR concurrent unique CAM allocation, retry recovery, capacity limit, rotation preserves paired phones');
  state = await call(`/broadcasts/${broadcastId}/live`);
  state = await call(`/broadcasts/${broadcastId}/live/preview`, tokens.director, { sequence: state.sequence, cameraId: firstCamera });
  state = await call(`/broadcasts/${broadcastId}/live/take`, tokens.director, { sequence: state.sequence });
  const stale = state.sequence - 1;
  await call(`/broadcasts/${broadcastId}/live/take`, tokens.director, { sequence: stale }, 409);
  state = await call(`/broadcasts/${broadcastId}/live/start`, tokens.root, { sequence: state.sequence });
  assert.equal(state.audioCameraId, firstCamera);
  console.log('PASS: single-use pairing, role isolation, stale sequence rejection, start with media readiness');

  // An audience client deliberately requests every feed, bypassing our player UI.
  const audienceMedia = await call(`/public/broadcasts/${broadcastId}/live/token`, null, {});
  const probe = await browser.newPage();
  await probe.goto(site + '/login');
  await probe.addScriptTag({ path: path.join(frontend, 'node_modules/livekit-client/dist/livekit-client.umd.js') });
  await probe.evaluate(async (media) => {
    const sdk = window.LivekitClient;
    window.probeRoom = new sdk.Room();
    await window.probeRoom.connect(media.url, media.token, { autoSubscribe: true });
  }, audienceMedia);
  await probe.waitForFunction(({ active, hidden }) => {
    const sdk = window.LivekitClient;
    const allowed = window.probeRoom.remoteParticipants.get(`camera_${active}`)?.getTrackPublication(sdk.Track.Source.Camera);
    const denied = window.probeRoom.remoteParticipants.get(`camera_${hidden}`)?.getTrackPublication(sdk.Track.Source.Camera);
    return allowed?.isSubscribed && denied?.permissionStatus === sdk.TrackPublication.PermissionStatus.NotAllowed && !denied?.track;
  }, { active: firstCamera, hidden: cameras[2].id }, { timeout: 20000 });
  await probe.close();
  console.log('PASS: SFU denies audience subscription to a non-PGM camera');

  createRequire(localRequire.resolve('next/package.json'))('@next/env').loadEnvConfig(frontend);
  const { encode } = await import(pathToFileURL(localRequire.resolve('next-auth/jwt')).href);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'authjs.session-token', url: site, value: await encode({ secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
    salt: 'authjs.session-token', token: { sub: ids.root, name: 'ROOT', role: 'ROOT', status: 'ACTIVE', accessToken: tokens.root, accessTokenExpiresAt: Date.now() + 3600000 } }) }]);
  await context.route('**/api/**', async (route) => {
    if (route.request().url().includes('/api/auth/')) return route.continue();
    const url = new URL(route.request().url());
    if (url.port === '4000') return route.continue({ url: api.replace(/\/api$/, '') + url.pathname + url.search });
    return route.continue();
  });
  const director = await context.newPage();
  await director.goto(`${site}/director/${broadcastId}`);
  await director.getByRole('button', { name: 'TAKE → 正式画面' }).waitFor({ timeout: 60000 });
  await director.waitForFunction(() => Array.from(document.querySelectorAll('video')).filter((v) => v.videoWidth > 0).length >= 3, { timeout: 20000 });
  await director.waitForFunction(() => Array.from(document.querySelectorAll('video[data-camera-quality="high"]')).every((v) => v.videoWidth >= 1280), { timeout: 20000 });
  const viewer = await context.newPage();
  await viewer.goto(`${site}/live/${broadcastId}`);
  await viewer.waitForFunction(() => Array.from(document.querySelectorAll('video')).some((v) => v.videoWidth > 0 && getComputedStyle(v).opacity === '1'), { timeout: 30000 });
  await viewer.waitForFunction(() => Array.from(document.querySelectorAll('video')).some((v) => v.videoWidth >= 1280 && getComputedStyle(v).opacity === '1'), { timeout: 20000 });
  await viewer.getByRole('button', { name: '开启声音' }).click();
  await viewer.waitForFunction(() => document.querySelector('audio')?.srcObject?.getAudioTracks().length === 1);
  const originalAudio = await viewer.evaluate(() => document.querySelector('audio').srcObject.getAudioTracks()[0].id);
  state = await call(`/broadcasts/${broadcastId}/live`);
  state = await call(`/broadcasts/${broadcastId}/live/preview`, tokens.director, { sequence: state.sequence, cameraId: cameras[1].id });
  state = await call(`/broadcasts/${broadcastId}/live/take`, tokens.director, { sequence: state.sequence });
  await viewer.waitForFunction(() => {
    const v = Array.from(document.querySelectorAll('video')).find((v) => v.videoWidth > 0 && getComputedStyle(v).opacity === '1');
    if (!v) return false;
    const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 1, 1);
    const p = x.getImageData(0, 0, 1, 1).data; return p[2] > p[1] * 1.3;
  }, { timeout: 20000 });
  assert.equal(await viewer.evaluate(() => document.querySelector('audio').srcObject.getAudioTracks()[0].id), originalAudio);
  assert.equal(state.audioCameraId, firstCamera);
  await director.getByText('PGM · CAM2', { exact: true }).waitFor({ timeout: 10000 });
  await director.screenshot({ path: path.resolve(__dirname, '../../../output/playwright/multicamera-director.png'), fullPage: true });
  await viewer.screenshot({ path: path.resolve(__dirname, '../../../output/playwright/multicamera-viewer.png'), fullPage: true });
  await director.setViewportSize({ width: 390, height: 844 });
  await director.waitForFunction(() => Array.from(document.querySelectorAll('video[data-camera-quality="high"]')).every((v) => v.videoWidth >= 1280), { timeout: 20000 });
  await viewer.setViewportSize({ width: 390, height: 844 });
  await viewer.waitForFunction(() => Array.from(document.querySelectorAll('video')).some((v) => v.videoWidth >= 1280 && getComputedStyle(v).opacity === '1'), { timeout: 20000 });
  assert.equal(await director.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  const takeBounds = await director.getByRole('button', { name: 'TAKE → 正式画面' }).boundingBox();
  assert.ok(takeBounds && takeBounds.y >= 0 && takeBounds.y + takeBounds.height <= 844, 'mobile TAKE must remain visible');
  await director.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
  const scrolledTake = await director.getByRole('button', { name: 'TAKE → 正式画面' }).boundingBox();
  assert.ok(scrolledTake && scrolledTake.y >= 0 && scrolledTake.y + scrolledTake.height <= 844, 'mobile TAKE must remain visible after scrolling');
  await director.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await director.screenshot({ path: path.resolve(__dirname, '../../../output/playwright/multicamera-director-phone.png'), fullPage: true });
  console.log('PASS: browser camera previews, full-resolution PGM/PVW/viewer on desktop and mobile, PGM first-frame switch, master audio track continuity, mobile layout');
  state = await call(`/broadcasts/${broadcastId}/live/preview`, tokens.director, { sequence: state.sequence, cameraId: cameras[2].id });
  await thirdCamera.page.evaluate(() => window.cameraRoom.disconnect());
  await call(`/broadcasts/${broadcastId}/live/take`, tokens.director, { sequence: state.sequence }, 409);
  assert.equal((await call(`/broadcasts/${broadcastId}/live`)).activeCameraId, cameras[1].id);
  await call(`/broadcasts/${broadcastId}/live/cameras/${cameras[2].id}/pair`, tokens.root, {});
  await call('/live-camera/config', thirdCamera.credential, undefined, 401);
  console.log('PASS: missing-video TAKE preserves PGM; re-pairing revokes the prior device credential');
  await call(`/broadcasts/${broadcastId}/live/pause`, tokens.root, { sequence: state.sequence });
  await call(`/public/broadcasts/${broadcastId}/live/token`, null, {}, 404);
  console.log('PASS: audience access revoked on pause');
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  heartbeats.forEach(clearInterval);
  await browser?.close();
  if (broadcastId) await prisma.broadcastSession.deleteMany({ where: { id: broadcastId } });
  await prisma.tournament.deleteMany({ where: { id: ids.tournament } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.root, ids.director, ids.outsider] } } });
  await prisma.$disconnect();
});
