import { legacyGroupId } from '../registration-groups/registration-groups.service';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { EntrantType, Format, Prisma } from '@prisma/client';
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

    const groupId = dto.groupId ?? legacyGroupId(dto.tournamentId, dto.entrantType ?? EntrantType.SCHOOL);
    const group = await this.prisma.tournamentGroup.findFirst({ where: { id: groupId, tournamentId: dto.tournamentId } });
    if (!group) throw new BadRequestException('赛事组别不存在，请先配置组别');
    const entrantType = group.fieldTemplate === 'SCHOOL' ? EntrantType.SCHOOL : EntrantType.SOCIAL;
    const existing = await this.prisma.event.findFirst({
      where: { tournamentId: dto.tournamentId, type: dto.type, groupId },
    });
    if (existing) throw new ConflictException('该赛事该组别已存在相同类型的单项');

    const { stageScoringRules, ...rest } = dto;
    const groupConfig = this.groupConfigFor(
      dto.format,
      dto.groupSize,
      dto.groupCount,
      dto.qualifiersPerGroup,
    );
    const created = await this.prisma.event.create({
      data: {
        ...rest,
        ...groupConfig,
        entrantType, groupId,
        groupLabel: group.name,
        stageScoringRules: this.normalizeStageScoringRules(stageScoringRules),
      },
      include: { tournament: true },
    });
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
    const nextGroupId = dto.groupId ?? (dto.entrantType && dto.entrantType !== current.entrantType ? legacyGroupId(current.tournamentId, dto.entrantType) : current.groupId ?? legacyGroupId(current.tournamentId, current.entrantType));
    const group = await this.prisma.tournamentGroup.findFirst({ where: { id: nextGroupId, tournamentId: current.tournamentId } });
    if (!group) throw new BadRequestException('赛事组别不存在');
    const nextEntrantType = group.fieldTemplate === 'SCHOOL' ? EntrantType.SCHOOL : EntrantType.SOCIAL;
    if (nextType !== current.type || nextGroupId !== current.groupId) {
      const duplicate = await this.prisma.event.findFirst({
        where: {
          tournamentId: current.tournamentId,
          type: nextType,
          groupId: nextGroupId,
          id: { not: id },
        },
      });
      if (duplicate) throw new ConflictException('该赛事该组别已存在相同类型的单项');
    }
    if (nextGroupId !== current.groupId) {
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
    const nextFormat = dto.format ?? current.format;
    // 分组配置三个字段任一被提交就整体重算：手动组数与每组人数互斥，切换赛制时清空旧配置。
    const groupConfig =
      dto.format !== undefined ||
      dto.groupSize !== undefined ||
      dto.groupCount !== undefined ||
      dto.qualifiersPerGroup !== undefined
        ? this.groupConfigFor(
            nextFormat,
            dto.groupSize !== undefined ? dto.groupSize : current.groupSize,
            dto.groupCount !== undefined ? dto.groupCount : current.groupCount,
            dto.qualifiersPerGroup !== undefined ? dto.qualifiersPerGroup : current.qualifiersPerGroup,
          )
        : null;
    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        ...rest,
        ...(groupConfig ?? {}),
        entrantType: nextEntrantType,
        groupId: nextGroupId,
        groupLabel: group.name,
        ...(stageScoringRules === undefined
          ? {}
          : { stageScoringRules: this.normalizeStageScoringRules(stageScoringRules) }),
      },
      include: { tournament: true },
    });
    return updated;
  }

  /**
   * 分组的两个字段互斥：手动「小组数量」优先，否则用「每组人数」（留空按默认 4 人）。
   * 只有「小组循环+淘汰」两种赛制使用分组配置，其他赛制一律清空，避免切赛制后残留旧配置。
   */
  private groupConfigFor(
    format: Format,
    groupSize?: number | null,
    groupCount?: number | null,
    qualifiersPerGroup?: number | null,
  ): { groupSize: number | null; groupCount: number | null } {
    const usesGroups =
      format === Format.GROUP_PLUS_KNOCKOUT || format === Format.GROUP_PLUS_KNOCKOUT_STD;
    if (!usesGroups) return { groupSize: null, groupCount: null };
    if (groupCount != null) {
      if (groupCount < 1 || groupCount > 26) {
        throw new BadRequestException('小组数量需在 1–26 之间');
      }
      return { groupSize: null, groupCount };
    }
    if (groupSize != null) {
      if (groupSize < 2 || groupSize > 8) {
        throw new BadRequestException('每组人数需在 2–8 之间');
      }
      if (qualifiersPerGroup != null && qualifiersPerGroup > groupSize) {
        throw new BadRequestException('每组出线数不能大于每组人数');
      }
      return { groupSize, groupCount: null };
    }
    return { groupSize: null, groupCount: null };
  }

  async remove(id: string) {
    await this.findOne(id);
    // 组名随所属组别保存（groupLabel = 组别名），删除单项不需要再同步其它单项的组名。
    return this.prisma.event.delete({ where: { id } });
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
