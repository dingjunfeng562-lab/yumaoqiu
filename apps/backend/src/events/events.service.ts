import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { EntrantType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthActor, tournamentScope } from '../auth/admin-scope';
import {
  CreateEventDto,
  STAGE_SCORING_KEYS,
  StageScoringRulesDto,
  UpdateEventDto,
} from './dto/event.dto';

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateEventDto) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: dto.tournamentId },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');

    const entrantType = dto.entrantType ?? EntrantType.SCHOOL;
    const existing = await this.prisma.event.findFirst({
      where: { tournamentId: dto.tournamentId, type: dto.type, entrantType },
    });
    if (existing) throw new ConflictException('该赛事该组别已存在相同类型的单项');

    const { stageScoringRules, ...rest } = dto;
    const created = await this.prisma.event.create({
      data: {
        ...rest,
        entrantType,
        groupLabel: await this.groupLabelFor(dto.tournamentId, entrantType),
        stageScoringRules: this.normalizeStageScoringRules(stageScoringRules),
      },
      include: { tournament: true },
    });
    await this.syncGroupLabels(dto.tournamentId);
    return created;
  }

  findByTournament(tournamentId: string, actor?: AuthActor) {
    return this.prisma.event.findMany({
      where: { tournamentId, tournament: tournamentScope(actor) },
      include: { tournament: true },
      orderBy: [{ entrantType: 'asc' }, { type: 'asc' }],
    });
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { tournament: true },
    });
    if (!event) throw new NotFoundException(`单项 ${id} 不存在`);
    return event;
  }

  async update(id: string, dto: UpdateEventDto) {
    const current = await this.findOne(id);
    const nextType = dto.type ?? current.type;
    const nextEntrantType = dto.entrantType ?? current.entrantType;
    if (nextType !== current.type || nextEntrantType !== current.entrantType) {
      const duplicate = await this.prisma.event.findFirst({
        where: {
          tournamentId: current.tournamentId,
          type: nextType,
          entrantType: nextEntrantType,
          id: { not: id },
        },
      });
      if (duplicate) throw new ConflictException('该赛事该组别已存在相同类型的单项');
    }
    if (nextEntrantType !== current.entrantType) {
      const linked = await this.prisma.event.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              registrations: true,
              competitionRegistrationItems: true,
              matches: true,
              drawBrackets: true,
            },
          },
        },
      });
      const linkedCount = linked
        ? linked._count.registrations +
          linked._count.competitionRegistrationItems +
          linked._count.matches +
          linked._count.drawBrackets
        : 0;
      if (linkedCount > 0) {
        throw new ConflictException('该单项已有报名、抽签或比赛数据，不能修改组别');
      }
    }

    const { stageScoringRules, ...rest } = dto;
    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        ...rest,
        entrantType: nextEntrantType,
        groupLabel: await this.groupLabelFor(current.tournamentId, nextEntrantType),
        ...(stageScoringRules === undefined
          ? {}
          : { stageScoringRules: this.normalizeStageScoringRules(stageScoringRules) }),
      },
      include: { tournament: true },
    });
    await this.syncGroupLabels(current.tournamentId);
    return updated;
  }

  async remove(id: string) {
    const current = await this.findOne(id);
    const removed = await this.prisma.event.delete({ where: { id } });
    await this.syncGroupLabels(current.tournamentId);
    return removed;
  }

  private async groupLabelFor(tournamentId: string, entrantType: EntrantType): Promise<string | null> {
    if (entrantType === EntrantType.SOCIAL) return '社会组';
    const hasSocial = await this.prisma.event.count({
      where: { tournamentId, entrantType: EntrantType.SOCIAL },
    });
    return hasSocial > 0 ? '学生组' : null;
  }

  /** 某个赛事出现/移除社会组后，同步学生组的展示组名。 */
  private async syncGroupLabels(tournamentId: string) {
    const hasSocial = await this.prisma.event.count({
      where: { tournamentId, entrantType: EntrantType.SOCIAL },
    });
    await this.prisma.event.updateMany({
      where: { tournamentId, entrantType: EntrantType.SCHOOL },
      data: { groupLabel: hasSocial > 0 ? '学生组' : null },
    });
    await this.prisma.event.updateMany({
      where: { tournamentId, entrantType: EntrantType.SOCIAL },
      data: { groupLabel: '社会组' },
    });
  }

  /**
   * 清洗分阶段规则：
   * - 丢弃没有任何有效内容的阶段（既无预设规则也无自定义分数）
   * - 自定义分数时校验封顶分不小于每局分数
   * - 可见阶段使用 QF/TOP4/SF/BRONZE/F；BEFORE_TOP4 旧两段键继续兼容
   * - 全部为空时存 JSON null（与"未配置"等价）
   */
  private normalizeStageScoringRules(
    value: StageScoringRulesDto | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (!value) return Prisma.JsonNull;

    const result: Record<string, Record<string, string | number | null>> = {};
    for (const key of STAGE_SCORING_KEYS) {
      const stage = value[key];
      if (!stage) continue;
      if (!stage.scoringRule && !stage.customGamePoint) continue;

      if (stage.customGamePoint) {
        if (stage.customGameCap && stage.customGameCap < stage.customGamePoint) {
          throw new BadRequestException(`阶段 ${key} 的封顶分不能小于每局分数`);
        }
        result[key] = {
          customGamePoint: stage.customGamePoint,
          customGameCap: stage.customGameCap ?? null,
          customGamesToWin: stage.customGamesToWin ?? 1,
        };
      } else if (stage.scoringRule) {
        result[key] = { scoringRule: stage.scoringRule };
      }
    }

    return Object.keys(result).length ? result : Prisma.JsonNull;
  }
}
