import { ConflictException, ForbiddenException } from '@nestjs/common';
import { EventType, Role } from '@prisma/client';
import {
  checkEventsForEntrantChange,
  deleteOrphanPlayers,
  ensureRegistrationEditable,
  requireAdminActor,
} from './registration-changes';

function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: EventType.MENS_SINGLES,
    groupLabel: '学生组',
    drawLocked: false,
    drawPublished: false,
    drawGeneratedAt: null,
    _count: { matches: 0, drawBrackets: 0 },
    ...overrides,
  };
}

function db(events: unknown[], startedEventIds: string[] = []) {
  return {
    event: { findMany: jest.fn().mockResolvedValue(events) },
    match: {
      findMany: jest
        .fn()
        .mockResolvedValue(startedEventIds.map((eventId) => ({ eventId }))),
    },
  } as never;
}

describe('checkEventsForEntrantChange', () => {
  it('还没抽签的项目不需要重新抽签', async () => {
    await expect(
      checkEventsForEntrantChange(db([event('e1')]), ['e1'], '删除报名'),
    ).resolves.toEqual([]);
  });

  it('已生成签表或对阵的项目改完要重新抽签', async () => {
    const result = await checkEventsForEntrantChange(
      db([
        event('e1', { drawGeneratedAt: new Date() }),
        event('e2', { _count: { matches: 3, drawBrackets: 0 } }),
      ]),
      ['e1', 'e2', 'e1'],
      '删除报名',
    );
    expect(result.map((item) => item.id)).toEqual(['e1', 'e2']);
    expect(result[0].label).toContain('男子单打');
  });

  it('签表已冻结或已发布时拒绝，并说明是哪个项目', async () => {
    await expect(
      checkEventsForEntrantChange(
        db([event('e1', { drawLocked: true })]),
        ['e1'],
        '删除报名',
      ),
    ).rejects.toThrow(/不能删除报名：.*男子单打签表已冻结或已发布/);
  });

  it('已有比赛开始或结束时拒绝，批量里有一条不行就整体拒绝', async () => {
    const promise = checkEventsForEntrantChange(
      db(
        [
          event('e1', { drawGeneratedAt: new Date() }),
          event('e2', { type: EventType.WOMENS_SINGLES }),
        ],
        ['e2'],
      ),
      ['e1', 'e2'],
      '删除报名',
    );
    await expect(promise).rejects.toBeInstanceOf(ConflictException);
    await expect(promise).rejects.toThrow(/女子单打已有比赛开始或结束/);
  });

  it('没有项目时不查询', async () => {
    const client = db([]);
    await expect(
      checkEventsForEntrantChange(client, [], '删除报名'),
    ).resolves.toEqual([]);
    expect(
      (client as unknown as { event: { findMany: jest.Mock } }).event.findMany,
    ).not.toHaveBeenCalled();
  });
});

describe('ensureRegistrationEditable', () => {
  const now = new Date('2026-11-02T10:00:00Z');

  it('没设截止时间或还没到截止时间可以修改', () => {
    expect(() =>
      ensureRegistrationEditable({ registrationEditDeadline: null }, now),
    ).not.toThrow();
    expect(() =>
      ensureRegistrationEditable(
        { registrationEditDeadline: new Date('2026-11-02T10:00:01Z') },
        now,
      ),
    ).not.toThrow();
  });

  it('过了截止时间不能修改，提示里带北京时间', () => {
    expect(() =>
      ensureRegistrationEditable(
        { registrationEditDeadline: new Date('2026-11-02T09:00:00Z') },
        now,
      ),
    ).toThrow(/已过报名信息修改截止时间（2026\/11\/02 17:00）/);
  });
});

describe('requireAdminActor', () => {
  it('只允许管理员和超级管理员', () => {
    expect(() =>
      requireAdminActor({ role: Role.ADMIN }, '删除报名'),
    ).not.toThrow();
    expect(() =>
      requireAdminActor({ role: Role.ROOT }, '删除报名'),
    ).not.toThrow();
    expect(() => requireAdminActor({ role: Role.REFEREE }, '删除报名')).toThrow(
      ForbiddenException,
    );
    expect(() => requireAdminActor(undefined, '删除报名')).toThrow(
      '只有管理员可以删除报名',
    );
  });
});

describe('deleteOrphanPlayers', () => {
  it('线上报名生成的档案不论是否临时都可删，但仍要求没有被别处引用', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
    await deleteOrphanPlayers(
      { player: { deleteMany } } as never,
      ['p1', null, 'p2', 'p1'],
      { registrationOwned: true },
    );
    const where = deleteMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ['p1', 'p2'] });
    expect(where.isTemporary).toBeUndefined();
    expect(where.registrationsAsP1).toEqual({ none: {} });
    expect(where.teamMembers).toEqual({ none: {} });
    expect(where.teamLineupsAsP2).toEqual({ none: {} });
  });

  it('后台录入的报名只删临时档案，选手库里的正式选手保留', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    await deleteOrphanPlayers({ player: { deleteMany } } as never, ['p1'], {
      registrationOwned: false,
    });
    expect(deleteMany.mock.calls[0][0].where.isTemporary).toBe(true);
  });

  it('没有档案时不执行删除', async () => {
    const deleteMany = jest.fn();
    await expect(
      deleteOrphanPlayers(
        { player: { deleteMany } } as never,
        [null, undefined],
        { registrationOwned: true },
      ),
    ).resolves.toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
