import { BadRequestException } from '@nestjs/common';
import { Format } from '@prisma/client';
import { GROUP_COUNT_MAX } from '../draws/draw-algorithm.service';

/** 只有「小组循环+淘汰」两种赛制使用「每组人数 / 手动小组数量」配置。 */
export function usesGroupConfig(format: Format) {
  return format === Format.GROUP_PLUS_KNOCKOUT || format === Format.GROUP_PLUS_KNOCKOUT_STD;
}

/**
 * 分组的两个字段互斥：手动「小组数量」优先，否则用「每组人数」（留空按默认 4 人）。
 * 其他赛制一律清空，避免切赛制后残留旧配置。单项管理和抽签编排页保存分组设置共用这一份校验。
 */
export function resolveGroupConfig(
  format: Format,
  groupSize?: number | null,
  groupCount?: number | null,
  qualifiersPerGroup?: number | null,
): { groupSize: number | null; groupCount: number | null } {
  if (!usesGroupConfig(format)) return { groupSize: null, groupCount: null };
  if (groupCount != null) {
    if (groupCount < 1 || groupCount > GROUP_COUNT_MAX) {
      throw new BadRequestException(`小组数量需在 1–${GROUP_COUNT_MAX} 之间`);
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
