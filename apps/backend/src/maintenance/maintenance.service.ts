import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeAnnouncementContent } from '../announcements/announcement-content';
import { UpdateMaintenanceDto } from './dto/maintenance.dto';

const MAINTENANCE_ID = 'default';
// 中间件每个写请求都要看一眼开关，这里只缓存很短时间。本进程内开关变化会立即
// 刷新缓存；直接改库（应急关闭）最多 5 秒后生效。
const CACHE_TTL_MS = 5_000;

export const DEFAULT_MAINTENANCE_TITLE = '系统维护中';

export type MaintenanceState = {
  enabled: boolean;
  title: string;
  content: string;
  startedAt: Date | null;
  expectedEndAt: Date | null;
  updatedBy: string | null;
  updatedAt: Date | null;
};

const DISABLED_STATE: MaintenanceState = {
  enabled: false,
  title: DEFAULT_MAINTENANCE_TITLE,
  content: '',
  startedAt: null,
  expectedEndAt: null,
  updatedBy: null,
  updatedAt: null,
};

// 维护期间仍可登录、浏览的角色；其中只有超级管理员能做写操作。
export function canEnterDuringMaintenance(role?: string | null) {
  return role === Role.ROOT || role === Role.ADMIN;
}

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private cached: { state: MaintenanceState; loadedAt: number } | null = null;
  private loading: Promise<MaintenanceState> | null = null;
  // 每次保存加一；保存前发出的读库结果回来时不再覆盖缓存，免得刚开启又被旧结果改回去。
  private version = 0;

  constructor(private readonly prisma: PrismaService) {}

  async getState(options: { fresh?: boolean } = {}): Promise<MaintenanceState> {
    if (options.fresh) return this.load();
    if (this.cached && Date.now() - this.cached.loadedAt < CACHE_TTL_MS)
      return this.cached.state;
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  async getPublicStatus() {
    const state = await this.getState();
    const serverTime = new Date().toISOString();
    // 未开启时不把草稿内容暴露给前台。
    if (!state.enabled) return { enabled: false, serverTime };
    return {
      enabled: true,
      title: state.title,
      content: state.content,
      startedAt: state.startedAt?.toISOString() ?? null,
      expectedEndAt: state.expectedEndAt?.toISOString() ?? null,
      serverTime,
    };
  }

  async getAdminConfig() {
    return this.serializeAdmin(await this.getState({ fresh: true }));
  }

  async update(dto: UpdateMaintenanceDto, actor?: string | null) {
    const current = await this.getState({ fresh: true });
    const enabled = dto.enabled ?? current.enabled;
    const title =
      dto.title !== undefined
        ? dto.title.trim() || DEFAULT_MAINTENANCE_TITLE
        : current.title;
    const content =
      dto.content !== undefined
        ? sanitizeAnnouncementContent(dto.content)
        : current.content;
    const expectedEndAt =
      dto.expectedEndAt !== undefined
        ? dto.expectedEndAt
          ? new Date(dto.expectedEndAt)
          : null
        : current.expectedEndAt;
    // 开始时间在"关 → 开"时记录；维护中再次保存内容不重置。关闭后保留，后台可看到上次维护时间。
    const startedAt =
      enabled && !current.enabled ? new Date() : current.startedAt;
    const data = {
      enabled,
      title,
      content,
      expectedEndAt,
      startedAt,
      updatedBy: actor ?? null,
    };
    const row = await this.prisma.systemMaintenance.upsert({
      where: { id: MAINTENANCE_ID },
      create: { id: MAINTENANCE_ID, ...data },
      update: data,
    });
    if (enabled !== current.enabled) {
      this.logger.warn(
        `全服维护已${enabled ? '开启' : '关闭'}（操作人：${actor ?? '未知'}）`,
      );
    }
    const state = this.toState(row);
    this.version += 1;
    this.cached = { state, loadedAt: Date.now() };
    return this.serializeAdmin(state);
  }

  private async load(): Promise<MaintenanceState> {
    const version = this.version;
    try {
      const row = await this.prisma.systemMaintenance.findUnique({
        where: { id: MAINTENANCE_ID },
      });
      const state = row ? this.toState(row) : { ...DISABLED_STATE };
      if (version === this.version)
        this.cached = { state, loadedAt: Date.now() };
      return state;
    } catch (error) {
      // 读库失败时沿用上一次的状态；从没读到过就按未开启处理，不能因为一次读库失败把所有人锁在外面。
      this.logger.error(
        `读取全服维护状态失败：${error instanceof Error ? error.message : String(error)}`,
      );
      const fallback = this.cached?.state ?? { ...DISABLED_STATE };
      if (version === this.version)
        this.cached = { state: fallback, loadedAt: Date.now() };
      return fallback;
    }
  }

  private toState(row: {
    enabled: boolean;
    title: string;
    content: string;
    startedAt: Date | null;
    expectedEndAt: Date | null;
    updatedBy: string | null;
    updatedAt: Date;
  }): MaintenanceState {
    return {
      enabled: row.enabled,
      title: row.title || DEFAULT_MAINTENANCE_TITLE,
      content: row.content ?? '',
      startedAt: row.startedAt,
      expectedEndAt: row.expectedEndAt,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }

  private serializeAdmin(state: MaintenanceState) {
    return {
      enabled: state.enabled,
      title: state.title,
      content: state.content,
      startedAt: state.startedAt?.toISOString() ?? null,
      expectedEndAt: state.expectedEndAt?.toISOString() ?? null,
      updatedBy: state.updatedBy,
      updatedAt: state.updatedAt?.toISOString() ?? null,
      serverTime: new Date().toISOString(),
    };
  }
}
