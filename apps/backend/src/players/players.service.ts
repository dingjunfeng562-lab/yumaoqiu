import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlayerDto, UpdatePlayerDto } from './dto/player.dto';
import { AuthActor, playerScope } from '../auth/admin-scope';

@Injectable()
export class PlayersService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreatePlayerDto, actor?: AuthActor) {
    return this.prisma.player.create({ data: { ...dto, ownerId: actor?.id } });
  }

  findAll(search?: string, includeTemporary = false, actor?: AuthActor) {
    return this.prisma.player.findMany({
      where: {
        ...playerScope(actor),
        ...(includeTemporary ? {} : { isTemporary: false }),
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { affiliation: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const player = await this.prisma.player.findUnique({ where: { id } });
    if (!player) throw new NotFoundException(`选手 ${id} 不存在`);
    return player;
  }

  async update(id: string, dto: UpdatePlayerDto) {
    const before = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.player.update({ where: { id }, data: dto });

      const contactChanged =
        dto.contact !== undefined && (dto.contact ?? null) !== (before.contact ?? null);
      const nameChanged = dto.name !== undefined && dto.name !== before.name;

      if (contactChanged || nameChanged) {
        const registrationPatch: Record<string, unknown> = {};
        if (contactChanged) registrationPatch.phone = dto.contact ?? null;
        if (nameChanged) registrationPatch.name = dto.name;
        await tx.registration.updateMany({
          where: { player1Id: id },
          data: registrationPatch,
        });
      }

      return updated;
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    // 报名和团体出场名单对选手是 RESTRICT 外键，直接删会报 500；先给出可操作的提示。
    // 不级联删除报名，以免破坏签表和比赛记录。
    const [registrations, lineups] = await Promise.all([
      this.prisma.registration.count({ where: { OR: [{ player1Id: id }, { player2Id: id }] } }),
      this.prisma.teamLineup.count({ where: { OR: [{ player1Id: id }, { player2Id: id }] } }),
    ]);
    if (registrations || lineups) {
      const parts = [
        registrations ? `${registrations} 条报名记录` : '',
        lineups ? `${lineups} 条团体赛出场记录` : '',
      ].filter(Boolean);
      throw new ConflictException(`该选手还有${parts.join('、')}，不能删除。请先在赛事的参赛选手中移除相关报名。`);
    }
    try {
      return await this.prisma.player.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('该选手仍被其他数据引用，不能删除');
      }
      throw error;
    }
  }
}
