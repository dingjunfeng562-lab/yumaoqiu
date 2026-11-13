import { ConflictException } from '@nestjs/common';
import { EventType, RegistrationStatus } from '@prisma/client';
import {
  ensureRegistrationCapacity,
  entryUnit,
  eventEntryCounts,
  groupEntrantCounts,
  remainingSlots,
} from './registration-capacity';

type Where = Record<string, any>;

/** 按查询条件返回假数据：只实现名额统计用到的几个查询。 */
function fakeDb(data: {
  approved?: Array<{ eventId: string; competitionRegistrationId?: string | null }>;
  pendingItems?: Array<{ eventId: string; competitionRegistrationId: string }>;
  applications?: Array<{ groupId: string }>;
  adminEntries?: Array<{ player1Id: string; event: { groupId: string } }>;
}) {
  const registration = {
    findMany: jest.fn(async ({ where }: { where: Where }) => {
      if (where.competitionRegistrationId === null) return data.adminEntries ?? [];
      if (where.competitionRegistrationId?.in) {
        return (data.approved ?? []).filter((row) => where.competitionRegistrationId.in.includes(row.competitionRegistrationId));
      }
      return (data.approved ?? []).filter((row) => where.eventId.in.includes(row.eventId));
    }),
  };
  return {
    registration,
    competitionRegistrationEventItem: {
      findMany: jest.fn(async ({ where }: { where: Where }) =>
        (data.pendingItems ?? []).filter((item) => where.eventId.in.includes(item.eventId))),
    },
    competitionRegistration: {
      findMany: jest.fn(async ({ where }: { where: Where }) =>
        (data.applications ?? []).filter((row) => where.groupId.in.includes(row.groupId))),
    },
  };
}

const singles = { id: 'e1', type: EventType.MENS_SINGLES, groupLabel: 'U12', maxEntries: 2 };
const doubles = { id: 'e2', type: EventType.MIXED_DOUBLES, groupLabel: 'U12', maxEntries: 1 };
const group = { id: 'g1', name: 'U12', maxEntrants: 3 };

describe('报名名额统计', () => {
  it('单打按人、双打按队；没设上限时剩余为 null，超额时剩余按 0', () => {
    expect(entryUnit(EventType.MENS_SINGLES)).toBe('人');
    expect(entryUnit(EventType.WOMENS_DOUBLES)).toBe('队');
    expect(remainingSlots(null, 5)).toBeNull();
    expect(remainingSlots(10, 4)).toBe(6);
    expect(remainingSlots(3, 5)).toBe(0);
  });

  it('项目名额 = 已通过 + 待审核里还没有参赛记录的项目；追加项目回到待审核时原有项目不重复算', async () => {
    const db = fakeDb({
      approved: [
        { eventId: 'e1', competitionRegistrationId: 'appA' },
        { eventId: 'e1', competitionRegistrationId: null },
      ],
      pendingItems: [
        { eventId: 'e1', competitionRegistrationId: 'appA' },
        { eventId: 'e1', competitionRegistrationId: 'appB' },
        { eventId: 'e2', competitionRegistrationId: 'appA' },
      ],
    });
    const counts = await eventEntryCounts(db as never, ['e1', 'e2', 'e3']);
    expect(counts.get('e1')).toBe(3);
    expect(counts.get('e2')).toBe(1);
    expect(counts.get('e3')).toBe(0);
  });

  it('组别人数 = 待审核和已通过的报名表 + 后台录入的选手（同一人只算一次）', async () => {
    const db = fakeDb({
      applications: [{ groupId: 'g1' }, { groupId: 'g1' }, { groupId: 'g2' }],
      adminEntries: [
        { player1Id: 'p1', event: { groupId: 'g1' } },
        { player1Id: 'p1', event: { groupId: 'g1' } },
        { player1Id: 'p2', event: { groupId: 'g1' } },
      ],
    });
    const counts = await groupEntrantCounts(db as never, ['g1', 'g2']);
    expect(counts.get('g1')).toBe(4);
    expect(counts.get('g2')).toBe(1);
  });

  it('没有要统计的项目或组别时不查库', async () => {
    const db = fakeDb({});
    expect((await eventEntryCounts(db as never, [])).size).toBe(0);
    expect((await groupEntrantCounts(db as never, [])).size).toBe(0);
    expect(db.registration.findMany).not.toHaveBeenCalled();
  });
});

describe('扫码报名提交时的名额检查', () => {
  it('没设上限时不查库', async () => {
    const db = fakeDb({});
    await ensureRegistrationCapacity(db as never, {
      group: { id: 'g1', name: 'U12', maxEntrants: null },
      newPerson: true,
      events: [{ ...singles, maxEntries: null }],
    });
    expect(db.registration.findMany).not.toHaveBeenCalled();
    expect(db.competitionRegistration.findMany).not.toHaveBeenCalled();
  });

  it('项目满了返回 409，写明哪一项、已报多少；多选时提示去掉已满的项目', async () => {
    const db = fakeDb({ approved: [{ eventId: 'e1' }, { eventId: 'e1' }, { eventId: 'e2' }] });
    await expect(ensureRegistrationCapacity(db as never, { newPerson: false, events: [singles] }))
      .rejects.toThrow('「U12 · 男子单打」名额已满（2/2 人）');
    await expect(ensureRegistrationCapacity(db as never, { newPerson: false, events: [singles, doubles] }))
      .rejects.toThrow('「U12 · 男子单打」名额已满（2/2 人）；「U12 · 混合双打」名额已满（1/1 队），请去掉已满的项目后再提交');
  });

  it('还有名额时通过', async () => {
    const db = fakeDb({ approved: [{ eventId: 'e1' }] });
    await expect(ensureRegistrationCapacity(db as never, { group, newPerson: true, events: [singles] })).resolves.toBeUndefined();
  });

  it('组别人数满了：新报名被拦，已通过的选手追加项目不受影响', async () => {
    const db = fakeDb({ applications: [{ groupId: 'g1' }, { groupId: 'g1' }, { groupId: 'g1' }] });
    const error = await ensureRegistrationCapacity(db as never, { group, newPerson: true, events: [singles] }).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe('「U12」报名人数已满（3/3 人）');
    await expect(ensureRegistrationCapacity(db as never, { group, newPerson: false, events: [singles] })).resolves.toBeUndefined();
  });

  it('驳回、移除的不算：只统计待审核和已通过的报名表', async () => {
    const db = fakeDb({ applications: [{ groupId: 'g1' }] });
    await ensureRegistrationCapacity(db as never, { group, newPerson: true, events: [] });
    const where = db.competitionRegistration.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual([RegistrationStatus.PENDING, RegistrationStatus.APPROVED]);
  });
});
