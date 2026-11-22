import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCompetitionsService, normalizeContact } from './team-competitions.service';

type Reuse = (
  db: unknown,
  teamCompetitionId: string,
  input: { name: string; gender?: string | null; contact?: string | null },
  actor?: { id: string; role: Role },
  rowLabel?: string,
) => Promise<{ id: string } | null>;

describe('导入队员复用选手库已有档案（同名 + 同联系方式）', () => {
  const admin = { id: 'admin1', role: Role.ADMIN };

  function setup(players: Array<{ id: string; gender: string | null; contact: string | null }>, member: unknown = null) {
    const db = {
      player: { findMany: jest.fn().mockResolvedValue(players), update: jest.fn().mockResolvedValue({}) },
      teamMember: { findFirst: jest.fn().mockResolvedValue(member) },
    };
    const service = new TeamCompetitionsService({} as PrismaService) as unknown as { reusablePlayer: Reuse };
    return { db, reuse: service.reusablePlayer.bind(service) as Reuse };
  }

  it('联系方式比较时忽略空格、横线、+86，邮箱不分大小写', () => {
    expect(normalizeContact('+86 138-0000-0000')).toBe('13800000000');
    expect(normalizeContact('8613800000000')).toBe('13800000000');
    expect(normalizeContact(' A@B.com ')).toBe('a@b.com');
    expect(normalizeContact(null)).toBe('');
  });

  it('同名同电话时复用；普通管理员只在自己建的、非临时选手里找；补上原档案缺的性别', async () => {
    const { db, reuse } = setup([{ id: 'p1', gender: null, contact: '138 0000 0000' }]);
    await expect(reuse(db, 'comp1', { name: ' 张三 ', gender: 'MALE', contact: '+8613800000000' }, admin)).resolves.toEqual({ id: 'p1' });
    expect(db.player.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { name: '张三', isTemporary: false, contact: { not: null }, ownerId: 'admin1' },
    }));
    expect(db.player.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { gender: 'MALE' } });
  });

  it('超级管理员在全部选手里找', async () => {
    const { db, reuse } = setup([]);
    await reuse(db, 'comp1', { name: '张三', contact: '13800000000' }, { id: 'root', role: Role.ROOT });
    expect(db.player.findMany.mock.calls[0][0].where).not.toHaveProperty('ownerId');
  });

  it('没填联系方式、电话不同、性别不一致时不复用（照常新建档案）', async () => {
    const { db, reuse } = setup([{ id: 'p1', gender: 'FEMALE', contact: '13800000000' }]);
    await expect(reuse(db, 'comp1', { name: '张三' }, admin)).resolves.toBeNull();
    expect(db.player.findMany).not.toHaveBeenCalled();
    await expect(reuse(db, 'comp1', { name: '张三', contact: '13900000000' }, admin)).resolves.toBeNull();
    await expect(reuse(db, 'comp1', { name: '张三', gender: 'MALE', contact: '13800000000' }, admin)).resolves.toBeNull();
    expect(db.player.update).not.toHaveBeenCalled();
  });

  it('这个人已经在本团体赛的某支队里：拦下，提示行号和队名', async () => {
    const { db, reuse } = setup([{ id: 'p1', gender: 'MALE', contact: '13800000000' }], { team: { name: '飞羽队' } });
    await expect(reuse(db, 'comp1', { name: '张三', contact: '13800000000' }, admin, '第 3 行'))
      .rejects.toThrow('第 3 行：张三（联系方式相同）已在团体“飞羽队”中，请勿重复导入');
    expect(db.teamMember.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { playerId: 'p1', team: { teamCompetitionId: 'comp1' } },
    }));
  });
});

describe('团体赛详情页删除队伍', () => {
  it('走缴费管理的删除逻辑（记一条缴费「删除」日志、清空未发布的对阵），返回是否清空了对阵', async () => {
    const prisma = {
      team: { findUnique: jest.fn().mockResolvedValue({ id: 't1', teamCompetitionId: 'comp1', members: [] }) },
      teamCompetition: { findUniqueOrThrow: jest.fn().mockResolvedValue({ tournamentId: 'tour1' }) },
      $transaction: jest.fn(async (callback: (tx: string) => unknown) => callback('tx')),
    };
    const service = new TeamCompetitionsService(prisma as unknown as PrismaService);
    const removeMany = jest.spyOn(service, 'removeTeamsInTx')
      .mockResolvedValue({ deleted: 1, redrawTeamCompetitions: [{ id: 'comp1', name: '甲组团体赛' }] });
    const actor = { id: 'admin1', role: Role.ADMIN, username: 'org' };

    await expect(service.removeTeam('t1', actor)).resolves.toEqual({ deleted: 1, drawCleared: true });
    expect(removeMany).toHaveBeenCalledWith('tx', 'tour1', ['t1'], actor, '团体赛详情页删除队伍');
  });
});
