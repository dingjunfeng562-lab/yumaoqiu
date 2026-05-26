import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlayerDto, UpdatePlayerDto } from './dto/player.dto';

@Injectable()
export class PlayersService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreatePlayerDto) {
    return this.prisma.player.create({ data: dto });
  }

  findAll(search?: string) {
    return this.prisma.player.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search } },
              { affiliation: { contains: search } },
            ],
          }
        : undefined,
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
    return this.prisma.player.delete({ where: { id } });
  }
}
