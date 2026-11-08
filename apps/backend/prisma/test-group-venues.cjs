// Real local DB + Socket.IO integration. Creates/removes only its own fixtures.
require('dotenv').config({ quiet: true });
require('ts-node').register({ transpileOnly: true, project: 'tsconfig.json' });
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Server } = require('socket.io');
const { io } = require('../../frontend/node_modules/socket.io-client');
const { PrismaService } = require('../src/prisma/prisma.service');
const { SchedulingService } = require('../src/scheduling/scheduling.service');
const { ScoringGateway } = require('../src/scoring/scoring.gateway');
const { ScoringService } = require('../src/scoring/scoring.service');
const { TournamentScreenService } = require('../src/public/tournament-screen.service');
const { PublicService } = require('../src/public/public.service');
const { TeamCompetitionsService } = require('../src/team-competitions/team-competitions.service');
assert(['localhost', '127.0.0.1', '::1'].includes(new URL(process.env.DATABASE_URL).hostname), 'Only local databases allowed');
const db = new PrismaService();
const id = `venue-test-${randomUUID()}`;
const gateway = new ScoringGateway();
const socketServer = new Server();
gateway.server = socketServer.of('/scores');
const service = new SchedulingService(db, gateway);
const screen = new TournamentScreenService(db, new ScoringService(db, new TeamCompetitionsService(db), gateway, {}));
const publicService = new PublicService(db, new TeamCompetitionsService(db), {}, gateway);
let client;
let broadcasts = 0;
const at = time => new Date(`2027-01-01T${time}:00+08:00`);
const match = n => `${id}-m${n}`;
const court = n => `${id}-v${n}`;
const group = n => `${id}-g${n}`;
const event = n => `${id}-e${n}`;
const options = { tournamentId: id, startAt: at('08:00').toISOString(), dailyStartTime: '08:00', dailyEndTime: '12:00', matchMinutes: 20, breakMinutes: 5 };
async function check(name, work) { await work(); console.log(`PASS ${name}`); }
async function main() {
  try {
    socketServer.listen(0, { serveClient: false });
    const address = socketServer.httpServer.address();
    client = io(`http://127.0.0.1:${address.port}/scores`, { transports: ['websocket'], reconnection: false });
    await once(client, 'connect');
    client.on('bracket:update', () => broadcasts++);
    await db.tournament.create({ data: { id, name: id, startDate: at('00:00'), endDate: at('23:59'), dailyStartTime: '08:00', dailyEndTime: '12:00', defaultMatchMinutes: 20, breakMinutes: 5, isPublished: true, approvalStatus: 'APPROVED' } });
    for (let n = 1; n <= 3; n++) {
      await db.venue.create({ data: { id: court(n), tournamentId: id, name: `${n}号场`, sortOrder: n } });
      await db.tournamentGroup.create({ data: { id: group(n), tournamentId: id, name: `U${n * 2 + 6}` } });
      await db.event.create({ data: { id: event(n), tournamentId: id, groupId: group(n), type: 'MENS_SINGLES', format: 'ROUND_ROBIN', scoringRule: 'TWENTYONE_BO3', scoringMode: 'CAPPED_30', drawPublished: true } });
      await db.match.create({ data: { id: match(n), eventId: event(n), round: 'A', roundNo: 0, matchNo: 1, durationMinutes: 20 } });
    }
    await check('group rules persist, shared courts accepted, configuration does not broadcast', async () => {
      await service.saveGroupVenues(id, { groups: [1, 2, 3].map(n => ({ groupId: group(n), restrictVenues: true, venueIds: [court(n === 2 ? 2 : 1)] })) }, 'fixture-operator');
      assert.equal((await service.getGroupVenues(id))[0].restrictVenues, true);
      assert.equal(broadcasts, 0);
      await assert.rejects(service.saveGroupVenues(id, { groups: [{ groupId: group(1), restrictVenues: true, venueIds: [] }] }), /至少选择/);
      await assert.rejects(service.saveGroupVenues(id, { groups: [{ groupId: group(1), restrictVenues: true, venueIds: ['foreign'] }] }), /当前赛事/);
    });
    await check('preview writes nothing; applying respects group courts and shared occupancy', async () => {
      const result = await service.autoSchedule({ ...options, preview: true });
      assert.equal(result.preview.scheduledCount, 3);
      assert.equal(await db.match.count({ where: { eventId: { in: [event(1), event(2), event(3)] }, scheduledAt: { not: null } } }), 0);
      assert.equal(broadcasts, 0);
      const notified = once(client, 'bracket:update');
      await service.autoSchedule({ ...options, fingerprint: result.preview.fingerprint }, 'fixture-operator');
      await notified;
      const rows = await service.getSchedule(id);
      assert.equal(rows.matches.find(m => m.id === match(1)).venueId, court(1));
      assert.equal(rows.matches.find(m => m.id === match(2)).venueId, court(2));
      assert.equal(rows.matches.find(m => m.id === match(3)).venueId, court(1));
      assert.equal(rows.conflicts.filter(c => c.type === 'VENUE').length, 0);
      assert.equal(broadcasts, 1);
    });
    await check('manual conflict is rejected atomically and temporary borrowing needs explicit confirmation', async () => {
      await assert.rejects(service.updateMatchSchedule(match(1), { venueId: court(2), allowOutsideGroup: true }), /同一时间段/);
      await assert.rejects(service.updateMatchSchedule(match(1), { venueId: court(3) }), /临时借场/);
      assert.equal((await db.match.findUniqueOrThrow({ where: { id: match(1) } })).venueId, court(1));
    });
    await check('socket notification follows commit; public screen and cached brackets move to new court', async () => {
      // Warm the actual public cache before changing the placement.
      await publicService.getBracketsPayload(id);
      const notified = once(client, 'bracket:update');
      await service.updateMatchSchedule(match(1), { venueId: court(3), allowOutsideGroup: true }, 'fixture-operator');
      const [notice] = await notified;
      assert.equal(notice.tournamentId, id);
      const row = await db.match.findUniqueOrThrow({ where: { id: match(1) } });
      assert.equal(row.venueId, court(3)); assert.equal(row.scheduleLocked, true); assert.equal(row.scheduleOverride, true);
      const board = await screen.getScreen(id);
      assert.equal(board.courts.find(c => c.id === court(3)).match?.id, match(1));
      assert.notEqual(board.courts.find(c => c.id === court(1)).match?.id, match(1));
      const payload = await publicService.getBracketsPayload(id);
      const brackets = JSON.parse(payload.json.toString());
      const moved = brackets.brackets.flatMap(b => b.matches).find(m => m.id === match(1));
      assert.equal(moved.venueName, '3号场');
    });
    await check('automatic rebuild and clear preserve manual placements; unlocking releases them', async () => {
      const fixed = await db.match.findUniqueOrThrow({ where: { id: match(1) } });
      await service.autoSchedule({ ...options, startAt: at('09:00').toISOString() });
      let row = await db.match.findUniqueOrThrow({ where: { id: match(1) } });
      assert.equal(row.venueId, fixed.venueId); assert.equal(+row.scheduledAt, +fixed.scheduledAt);
      await service.clearSchedule({ tournamentId: id });
      row = await db.match.findUniqueOrThrow({ where: { id: match(1) } });
      assert.equal(row.venueId, court(3));
      assert.equal((await db.match.findUniqueOrThrow({ where: { id: match(2) } })).venueId, null);
      await service.updateMatchSchedule(match(1), { scheduleLocked: false });
      await service.autoSchedule(options);
      assert.equal((await db.match.findUniqueOrThrow({ where: { id: match(1) } })).venueId, court(1));
    });
    await check('no intersection and capacity overflow remain unscheduled; never borrow outside group', async () => {
      let result = await service.autoSchedule({ ...options, venueIds: [court(3)], preview: true });
      assert.equal(result.preview.scheduledCount, 0); assert.equal(result.preview.unscheduled.length, 3);
      result = await service.autoSchedule({ ...options, dailyEndTime: '08:20', breakMinutes: 0, preview: true });
      assert.equal(result.preview.unscheduled.length, 1);
      assert.equal(result.preview.matches.filter(m => m.venueId === court(3)).length, 0);
    });
    await check('outdated previews are rejected and nearest-time lookup writes nothing', async () => {
      const result = await service.autoSchedule({ ...options, preview: true });
      await service.updateMatchSchedule(match(1), { venueId: court(3), allowOutsideGroup: true });
      await assert.rejects(service.autoSchedule({ ...options, fingerprint: result.preview.fingerprint }), /重新预览/);
      const before = await db.match.findUniqueOrThrow({ where: { id: match(3) } });
      const preview = await service.previewMatchSchedule(match(3), { venueId: court(2), scheduledAt: at('08:00').toISOString(), findNextAvailable: true });
      assert.equal(preview.conflicts.length, 0); assert(new Date(preview.changes[0].scheduledAt) >= at('08:25'));
      assert.equal(+(await db.match.findUniqueOrThrow({ where: { id: match(3) } })).scheduledAt, +before.scheduledAt);
    });
    await check('rule changes do not move matches; started matches reject manual changes and survive clear', async () => {
      const before = await db.match.findUniqueOrThrow({ where: { id: match(3) } });
      const saved = await service.saveGroupVenues(id, { groups: [{ groupId: group(3), restrictVenues: true, venueIds: [court(3)] }] });
      assert.equal(saved.affectedMatchCount, 1);
      assert.equal((await db.match.findUniqueOrThrow({ where: { id: match(3) } })).venueId, before.venueId);
      await db.match.update({ where: { id: match(2) }, data: { status: 'LIVE', startedAt: at('08:00') } });
      await assert.rejects(service.updateMatchSchedule(match(2), { venueId: court(3) }), /尚未开始/);
      await service.clearSchedule({ tournamentId: id, includeLocked: true });
      assert.equal((await db.match.findUniqueOrThrow({ where: { id: match(2) } })).venueId, court(2));
      const logs = await service.getScheduleLogs(id);
      assert(logs.some(log => log.action === 'MANUAL' && log.actorId === 'fixture-operator'));
    });
    await check('team encounter moves and locks every pending child; a started child pins the court', async () => {
      const competitionId = `${id}-team`, encounterId = `${id}-encounter`;
      await db.teamCompetition.create({ data: { id: competitionId, tournamentId: id, groupId: group(1), name: 'test team event' } });
      await db.teamMatch.create({ data: { id: encounterId, teamCompetitionId: competitionId, round: 'F', roundNo: 1, matchNo: 1 } });
      for (let n = 0; n < 3; n++) await db.match.create({ data: {
        id: `${id}-child${n}`, teamMatchId: encounterId, round: 'F', roundNo: 1, matchNo: n + 1,
        venueId: court(1), scheduledAt: at(`09:${n * 10 || '00'}`), durationMinutes: 10,
      } });
      await service.updateMatchSchedule(`${id}-child0`, { venueId: court(3), allowOutsideGroup: true });
      const children = await db.match.findMany({ where: { teamMatchId: encounterId }, orderBy: { matchNo: 'asc' } });
      assert(children.every(m => m.venueId === court(3) && m.scheduleLocked));
      assert.equal(+children[1].scheduledAt - +children[0].scheduledAt, 600000);
      await db.match.update({ where: { id: children[0].id }, data: { status: 'LIVE', startedAt: at('09:00') } });
      await assert.rejects(service.updateMatchSchedule(children[1].id, { venueId: court(1) }), /继续使用同一场地/);
      await service.updateMatchSchedule(children[1].id, { scheduleLocked: false });
      await service.autoSchedule(options);
      assert((await db.match.findMany({ where: { teamMatchId: encounterId } })).every(m => m.venueId === court(3)));
    });
    await check('an unplaced upstream leaves its final unscheduled', async () => {
      const eid = `${id}-dependency-event`;
      await db.event.create({ data: { id: eid, tournamentId: id, groupId: group(2), type: 'WOMENS_SINGLES', format: 'SINGLE_ELIMINATION', scoringRule: 'TWENTYONE_BO3', scoringMode: 'CAPPED_30' } });
      for (const [suffix, roundNo, matchNo] of [['semi1',1,1],['semi2',1,2],['final',2,1]]) await db.match.create({ data: {
        id: `${id}-${suffix}`, eventId: eid, round: roundNo === 1 ? 'SF' : 'F', roundNo, matchNo, durationMinutes: 20,
      } });
      const result = await service.autoSchedule({ ...options, eventId: eid, startAt: at('10:00').toISOString(), dailyStartTime: '10:00', dailyEndTime: '10:20', breakMinutes: 0, preview: true });
      assert.equal(result.preview.scheduledCount, 1);
      assert(result.preview.unscheduled.some(m => m.matchId === `${id}-final` && m.reason.includes('前置')));
    });
    await check('单项场地精确到男子单打：覆盖组别、继承、不限制、校验与预览指纹', async () => {
      const t2 = `${id}-ev`;
      const v = n => `${t2}-v${n}`;
      const gid = `${t2}-g`;
      const eMS = `${t2}-e-ms`, eWS = `${t2}-e-ws`;
      const mMS = `${t2}-m-ms`, mWS = `${t2}-m-ws`;
      const opts2 = { ...options, tournamentId: t2 };
      try {
        await db.tournament.create({ data: { id: t2, name: t2, startDate: at('00:00'), endDate: at('23:59'), dailyStartTime: '08:00', dailyEndTime: '12:00', defaultMatchMinutes: 20, breakMinutes: 5, isPublished: true, approvalStatus: 'APPROVED' } });
        await db.venue.create({ data: { id: v(1), tournamentId: t2, name: '1号场', sortOrder: 1 } });
        await db.venue.create({ data: { id: v(2), tournamentId: t2, name: '2号场', sortOrder: 2 } });
        await db.tournamentGroup.create({ data: { id: gid, tournamentId: t2, name: '大学组' } });
        await db.event.create({ data: { id: eMS, tournamentId: t2, groupId: gid, type: 'MENS_SINGLES', format: 'ROUND_ROBIN', scoringRule: 'TWENTYONE_BO3', scoringMode: 'CAPPED_30', drawPublished: true } });
        await db.event.create({ data: { id: eWS, tournamentId: t2, groupId: gid, type: 'WOMENS_SINGLES', format: 'ROUND_ROBIN', scoringRule: 'TWENTYONE_BO3', scoringMode: 'CAPPED_30', drawPublished: true } });
        await db.match.create({ data: { id: mMS, eventId: eMS, round: 'A', roundNo: 0, matchNo: 1, durationMinutes: 20 } });
        await db.match.create({ data: { id: mWS, eventId: eWS, round: 'A', roundNo: 0, matchNo: 1, durationMinutes: 20 } });

        // 组别限制 1 号场；男子单打单独指定 2 号场；女子单打继承组别。
        await service.saveGroupVenues(t2, {
          groups: [{ groupId: gid, restrictVenues: true, venueIds: [v(1)] }],
          events: [{ eventId: eMS, venueRule: 'SPECIFIED', venueIds: [v(2)] }, { eventId: eWS, venueRule: 'INHERIT', venueIds: [] }],
        }, 'fixture-operator');
        let rows = await service.getSchedule(t2);
        const ms = rows.matches.find(m => m.id === mMS), ws = rows.matches.find(m => m.id === mWS);
        assert.deepEqual(ms.allowedVenueIds, [v(2)]); assert.equal(ms.venueRuleScope, 'EVENT');
        assert.deepEqual(ws.allowedVenueIds, [v(1)]); assert.equal(ws.venueRuleScope, 'GROUP');
        assert.equal(rows.groups[0].events.find(e => e.eventId === eMS).venueRule, 'SPECIFIED');

        const preview = await service.autoSchedule({ ...opts2, preview: true });
        assert.equal(preview.preview.matches.find(m => m.id === mMS).venueId, v(2));
        assert.equal(preview.preview.matches.find(m => m.id === mWS).venueId, v(1));
        // 预览汇总精确到单项，而不是只到组别。
        const summary = preview.preview.groups.find(g => g.groupId === gid);
        assert.equal(summary.events.find(e => e.eventId === eMS).scheduled, 1);
        assert.equal(summary.events.find(e => e.eventId === eWS).scheduled, 1);

        await service.autoSchedule({ ...opts2, fingerprint: preview.preview.fingerprint }, 'fixture-operator');
        assert.equal((await db.match.findUniqueOrThrow({ where: { id: mMS } })).venueId, v(2));
        assert.equal((await db.match.findUniqueOrThrow({ where: { id: mWS } })).venueId, v(1));

        // 单项「不限制」可越过组别限制；组别规则保持不变。
        await service.saveGroupVenues(t2, { groups: [], events: [{ eventId: eMS, venueRule: 'ALL', venueIds: [] }] });
        rows = await service.getSchedule(t2);
        assert.equal(rows.matches.find(m => m.id === mMS).allowedVenueIds, null);
        assert.equal(rows.matches.find(m => m.id === mMS).venueRuleScope, 'EVENT');
        assert.deepEqual(rows.matches.find(m => m.id === mWS).allowedVenueIds, [v(1)]);

        // 校验：指定场地不能为空；单项必须属于本赛事。
        await assert.rejects(service.saveGroupVenues(t2, { groups: [], events: [{ eventId: eMS, venueRule: 'SPECIFIED', venueIds: [] }] }), /至少选择/);
        await assert.rejects(service.saveGroupVenues(t2, { groups: [], events: [{ eventId: 'foreign-event', venueRule: 'ALL', venueIds: [] }] }), /当前赛事/);
        // 旧客户端只传 groups 时，单项规则保持不变（向后兼容）。
        await service.saveGroupVenues(t2, { groups: [], events: [{ eventId: eMS, venueRule: 'SPECIFIED', venueIds: [v(2)] }] });
        await service.saveGroupVenues(t2, { groups: [{ groupId: gid, restrictVenues: true, venueIds: [v(1)] }] });
        assert.equal((await service.getSchedule(t2)).matches.find(m => m.id === mMS).venueRuleScope, 'EVENT');

        // 单项规则变化后，旧预览指纹必须失效。
        const stale = await service.autoSchedule({ ...opts2, preview: true });
        await service.saveGroupVenues(t2, { groups: [], events: [{ eventId: eMS, venueRule: 'INHERIT', venueIds: [] }] });
        await assert.rejects(service.autoSchedule({ ...opts2, fingerprint: stale.preview.fingerprint }), /重新预览/);

        // 单项指定场地与本次启用场地无交集时，未排原因要指名男子单打。
        await service.saveGroupVenues(t2, { groups: [], events: [{ eventId: eMS, venueRule: 'SPECIFIED', venueIds: [v(2)] }] });
        const noIntersection = await service.autoSchedule({ ...opts2, venueIds: [v(1)], preview: true });
        assert(noIntersection.preview.unscheduled.some(item => item.matchId === mMS && item.reason.includes('男子单打')));

        // 规则收紧后，已排在他处的未开始比赛计入需调整场次，但不自动移动。
        const placed = await db.match.findUniqueOrThrow({ where: { id: mMS } });
        const saved = await service.saveGroupVenues(t2, { groups: [], events: [{ eventId: eMS, venueRule: 'SPECIFIED', venueIds: [v(1)] }] });
        assert.equal(saved.affectedMatchCount, placed.venueId === v(1) ? 0 : 1);
        assert.equal((await db.match.findUniqueOrThrow({ where: { id: mMS } })).venueId, placed.venueId);
      } finally { await db.tournament.deleteMany({ where: { id: t2 } }); }
    });
    console.log('All local group venue integration checks passed.');
  } finally {
    client?.disconnect();
    await new Promise(resolve => socketServer.close(resolve));
    await db.tournament.deleteMany({ where: { id } });
    await db.$disconnect();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
