import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { createHash } from 'node:crypto';
import { Role } from '@prisma/client';
import { Subject } from 'rxjs';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { requiredPermissions } from '../auth/permissions';
import { CheckInService } from './check-in.service';
import { SetCheckInDto } from './check-in.dto';

const key = (id: string, ...players: string[]) => createHash('sha256').update(JSON.stringify([id, ...players])).digest('hex');
const actor = { id: 'staff', role: Role.ADMIN, permissions: ['SCHEDULING'] };
const dto = (side: '1' | '2' | 'both' = '1', checked = true): SetCheckInDto => ({ side, checked, side1Key: key('r1', 'p1', 'p2'), side2Key: key('r2', 'p3', 'p4') });

function setup() {
  const records: any[] = [];
  const match: any = {
    id: 'm1', matchNo: 1, round: 'A组', roundNo: 1, side1Id: 'r1', side2Id: 'r2',
    eventId: 'e1', event: { id: 'e1', tournamentId: 't1', type: 'MENS_DOUBLES', drawPublished: true },
    teamMatch: null, teamCompetitionItem: null, teamCompetitionItemId: null,
    venueId: null, scheduledAt: null, status: 'PENDING', forfeitedSide: null, winnerSide: null,
    checkIns: records, games: [],
  };
  const registrations = [
    { id: 'r1', player1: { id: 'p1', name: '甲一' }, player2: { id: 'p2', name: '甲二' } },
    { id: 'r2', player1: { id: 'p3', name: '乙一' }, player2: { id: 'p4', name: '乙二' } },
  ];
  const db: any = {
    tournament: { findFirst: jest.fn().mockResolvedValue({ id: 't1', name: '测试赛事', isPublished: true, isArchived: false, approvalStatus: 'APPROVED' }), findMany: jest.fn().mockResolvedValue([]) },
    venue: { findMany: jest.fn().mockResolvedValue([]) },
    match: { findUnique: jest.fn().mockResolvedValue(match), findMany: jest.fn().mockResolvedValue([match]) },
    registration: { findMany: jest.fn().mockResolvedValue(registrations) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'm1' }]),
    matchCheckIn: {
      upsert: jest.fn().mockImplementation(async ({ create, update }) => {
        const existing = records.find((r) => r.side === create.side);
        if (existing) Object.assign(existing, update); else records.push(create);
      }),
      deleteMany: jest.fn().mockImplementation(async ({ where }) => {
        const index = records.findIndex((r) => r.side === where.side);
        if (index >= 0) records.splice(index, 1);
      }),
    },
    matchCheckInLog: { create: jest.fn().mockResolvedValue({}) },
  };
  db.$transaction = jest.fn((work) => work(db));
  const gateway = { emitCheckInUpdate: jest.fn(), publicDataChanges: new Subject<void>() };
  const service = new CheckInService(db, gateway as any);
  return { service, db, match, records, registrations, gateway };
}

describe('per-match check-in', () => {
  it('merges separate side sign-ins and keeps repeat requests idempotent', async () => {
    const { service, records, db } = setup();
    await service.set('m1', dto('1'), actor);
    const firstAt = records[0].checkedAt;
    await service.set('m1', dto('2'), actor);
    await service.set('m1', dto('both'), actor);
    expect(records).toHaveLength(2);
    expect(records[0].checkedAt).toBe(firstAt);
    expect(db.matchCheckInLog.create).toHaveBeenCalledTimes(2);
    expect(db.$queryRaw).toHaveBeenCalledTimes(3);
    const board = await service.board('t1', actor);
    expect(board.matches[0].side1.checkedAt).toBeTruthy();
    expect(board.matches[0].side2.checkedAt).toBeTruthy();
  });

  it('undoes only the chosen side and records the actor', async () => {
    const { service, records, db, gateway } = setup();
    await service.set('m1', dto('both'), actor);
    await service.set('m1', dto('1', false), actor);
    expect(records.map((r) => r.side)).toEqual([2]);
    expect(db.matchCheckInLog.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ side: 1, actorId: 'staff', action: 'UNDO' }) });
    expect(gateway.emitCheckInUpdate).toHaveBeenLastCalledWith({ tournamentId: 't1', matchId: 'm1' });
  });

  it.each(['LIVE', 'COMPLETED', 'CANCELLED'])('rejects sign-in and undo on %s matches', async (status) => {
    const { service, match, db, gateway } = setup();
    match.status = status;
    await expect(service.set('m1', dto(), actor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.set('m1', dto('1', false), actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.matchCheckIn.upsert).not.toHaveBeenCalled();
    expect(gateway.emitCheckInUpdate).not.toHaveBeenCalled();
  });

  it('rejects unknown opponents and incomplete doubles', async () => {
    const { service, registrations, match } = setup();
    match.side2Id = null;
    await expect(service.set('m1', dto(), actor)).rejects.toBeInstanceOf(BadRequestException);
    match.side2Id = 'r2';
    registrations[1].player2 = null as any;
    await expect(service.set('m1', dto(), actor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('invalidates a sign-in when the pair changes and rejects stale drawer requests', async () => {
    const { service, registrations, db } = setup();
    await service.set('m1', dto(), actor);
    registrations[0].player2.id = 'replacement';
    const board = await service.board('t1', actor);
    expect(board.matches[0].side1.checkedAt).toBeNull();
    await expect(service.set('m1', dto('both'), actor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.matchCheckIn.upsert).toHaveBeenCalledTimes(1);
  });

  it('resolves team lineups within this match and invalidates changed players', async () => {
    const { service, match } = setup();
    match.event = null;
    match.teamCompetitionItemId = 'item1';
    match.teamCompetitionItem = { eventType: 'MENS_SINGLES' };
    match.side1Id = 'lineup:m1:team1:item1';
    match.side2Id = 'lineup:m1:team2:item1';
    match.teamMatch = {
      team1Id: 'team1', team2Id: 'team2', team1: { name: '一队' }, team2: { name: '二队' },
      teamCompetition: { id: 'tc1', tournamentId: 't1', isPublished: true },
      lineups: [{ teamId: 'team1', teamCompetitionItemId: 'item1', player1: { id: 'p1', name: '甲' }, player2: null },
        { teamId: 'team2', teamCompetitionItemId: 'item1', player1: { id: 'p3', name: '乙' }, player2: null }],
    };
    const board = await service.board('t1', actor);
    await service.set('m1', { ...dto('both'), side1Key: board.matches[0].side1.key, side2Key: board.matches[0].side2.key }, actor);
    match.teamMatch.lineups[0].player1.id = 'replacement';
    const next = await service.board('t1', actor);
    expect(next.matches[0].side1.checkedAt).toBeNull();
    expect(next.matches[0].side2.checkedAt).toBeTruthy();
  });

  it('enforces owner scope even when called directly', async () => {
    const { service, db } = setup();
    db.tournament.findFirst.mockResolvedValue(null);
    await expect(service.set('m1', dto(), actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.tournament.findFirst).toHaveBeenCalledWith({ where: { id: 't1', submittedById: 'staff' }, select: { id: true } });
    expect(db.matchCheckIn.upsert).not.toHaveBeenCalled();
  });

  it('does not expose operator data and filters unpublished public draws', async () => {
    const { service, db } = setup();
    await service.set('m1', dto(), actor);
    const board = await service.publicBoard('t1');
    expect(db.tournament.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 't1', isPublished: true, isArchived: false, approvalStatus: 'APPROVED' } }));
    expect(db.match.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [
      { event: { tournamentId: 't1', drawPublished: true } },
      { teamMatch: { teamCompetition: { tournamentId: 't1', isPublished: true } } },
    ] } }));
    expect(JSON.stringify(board)).not.toContain('actorId');
    expect(JSON.stringify(board)).not.toContain('phone');
    // 选手指纹只给工作人员核对对阵用。
    expect(JSON.stringify(board)).not.toContain(key('r1', 'p1', 'p2'));
    expect(board.matches[0].side1).not.toHaveProperty('key');
    expect(board.matches[0].side1.checkedAt).toBeTruthy();
  });

  it('shares one public load per data version and refreshes after check-in or scoring', async () => {
    const { service, db, gateway } = setup();
    await service.publicBoard('t1');
    await service.publicBoard('t1');
    expect(db.match.findMany).toHaveBeenCalledTimes(1);
    await service.set('m1', dto(), actor);
    const afterCheckIn = await service.publicBoard('t1');
    expect(db.match.findMany).toHaveBeenCalledTimes(2);
    expect(afterCheckIn.matches[0].side1.checkedAt).toBeTruthy();
    gateway.publicDataChanges.next();
    await service.publicBoard('t1');
    expect(db.match.findMany).toHaveBeenCalledTimes(3);
    // 工作人员页不走缓存。
    await service.board('t1', actor);
    await service.board('t1', actor);
    expect(db.match.findMany).toHaveBeenCalledTimes(5);
  });

  it('does not cache a missing public tournament', async () => {
    const { service, db } = setup();
    db.tournament.findFirst.mockResolvedValueOnce(null);
    await expect(service.publicBoard('t1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.publicBoard('t1')).resolves.toHaveProperty('matches');
  });

  it('blocks unavailable public tournaments before loading matches', async () => {
    const { service, db } = setup();
    db.tournament.findFirst.mockResolvedValue(null);
    await expect(service.publicBoard('private')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.match.findMany).not.toHaveBeenCalled();
  });

  it('scopes the staff tournament list and accepts ROOT across owners', async () => {
    const { service, db } = setup();
    await service.list(actor);
    expect(db.tournament.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { submittedById: 'staff', isArchived: false } }));
    await service.list({ id: 'root', role: Role.ROOT });
    expect(db.tournament.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { isArchived: false } }));
    await service.set('m1', dto(), { id: 'root', role: Role.ROOT });
    expect(db.tournament.findFirst).toHaveBeenLastCalledWith({ where: { id: 't1' }, select: { id: true } });
  });

  it('restricts the admin board to its owner while ROOT can read across owners', async () => {
    const { service, db } = setup();
    db.tournament.findFirst.mockImplementation(async ({ where }: { where: { submittedById?: string } }) =>
      where.submittedById && where.submittedById !== 'owner'
        ? null : { id: 't1', name: 'Owned tournament', isPublished: true, approvalStatus: 'APPROVED' });
    await expect(service.board('t1', actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.match.findMany).not.toHaveBeenCalled();
    await expect(service.board('t1', { ...actor, id: 'owner' })).resolves.toHaveProperty('matches');
    await expect(service.board('t1', { id: 'root', role: Role.ROOT })).resolves.toHaveProperty('matches');
  });

  it.each(['forfeitMatch', 'forfeitBoth'])('blocks cross-owner %s even with scoring permission', async (action) => {
    const { db } = setup();
    db.tournament.findFirst.mockResolvedValue(null);
    const guard = new RolesGuard(new Reflector(), db);
    class ScoringController {}
    const req = { user: { ...actor, permissions: ['SCORING'] }, params: { id: 'm1' } };
    const handler = { [action]() {} }[action];
    const context = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => handler, getClass: () => ScoringController } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.tournament.findFirst).toHaveBeenCalledWith({ where: { id: 't1', submittedById: actor.id }, select: { id: true } });
    const rootContext = { ...context, switchToHttp: () => ({ getRequest: () => ({ ...req, user: { id: 'root', role: Role.ROOT } }) }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(rootContext)).resolves.toBe(true);
  });

  it('rejects malformed operation DTOs', async () => {
    const invalid = Object.assign(new SetCheckInDto(), { side: '3', checked: 'true', side1Key: '', side2Key: null });
    expect(await validate(invalid)).toHaveLength(4);
    expect(await validate(Object.assign(new SetCheckInDto(), dto()))).toHaveLength(0);
  });

  it('uses feature permissions and denies a spectator calling staff endpoints', async () => {
    expect(requiredPermissions('CheckInController', 'set')).toEqual(['SCHEDULING', 'SCORING']);
    const { db } = setup();
    const guard = new RolesGuard(new Reflector(), db);
    class CheckInController {}
    const req = { user: { id: 'player', role: Role.PLAYER, permissions: ['REGISTRATION'] }, params: { matchId: 'm1' } };
    const context = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => function set() {}, getClass: () => CheckInController } as unknown as ExecutionContext;
    expect(await guard.canActivate(context)).toBe(false);
    expect(db.match.findUnique).not.toHaveBeenCalled();
  });
});
