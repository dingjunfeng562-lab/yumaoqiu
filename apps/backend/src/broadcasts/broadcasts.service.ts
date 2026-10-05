import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { BroadcastStatus, MatchStatus, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastScoreService, PUBLIC_TOURNAMENT_WHERE } from './broadcast-score.service';
import {
  CameraHeartbeatDto, CameraSettingsDto, CreateBroadcastDto, DEFAULT_CAMERA_SETTINGS, UpdateBroadcastDto,
} from './dto/broadcast.dto';

import { cameraServerUrls } from './camera-server-urls';
import { mediaConfig, mediaTicket, validMediaTicket } from './media-config';

const CAMERA_ONLINE_MS = 15000;

/**
 * Shape version of the stored `cameraSettings` JSON.
 *
 * 1 was the original shape, where `videoBitrateKbps` was a hint the app
 * overrode. 2 is the current one, where it is an upper bound of 0-or-more that
 * the app honours. Rows without a marker are version 1, and their stored
 * bitrate has to be discarded rather than reinterpreted - see cameraSettingsOf.
 */
const CAMERA_SETTINGS_VERSION = 2;

type Notifier = {
  pushConfig(sessionId: string): Promise<void>;
  scheduleScore(sessionId: string): void;
  /** Drops OBS overlay subscribers (invalid token). */
  revoke(sessionId: string): void;
  /** Drops website viewer subscribers (broadcast no longer public). */
  revokeViewers(sessionId: string): void;
};

const adminSelect = {
  id: true, title: true, tournamentId: true, venueId: true, currentMatchId: true,
  enabled: true, isPublic: true, status: true, overlaySettings: true, configVersion: true,
  playbackUrl: true, liveRoomName: true, startedAt: true, endedAt: true, createdAt: true, updatedAt: true,
  // Camera fields: the token hash and sealed push URL are only used to derive
  // booleans / the host; adminView() strips them before anything is returned.
  cameraTokenHash: true, ingestUrlEnc: true, streamName: true, cameraSettings: true, cameraState: true, cameraLastSeenAt: true,
  tournament: { select: { id: true, name: true, isPublished: true, isArchived: true, approvalStatus: true } },
  venue: { select: { id: true, name: true } },
} satisfies Prisma.BroadcastSessionSelect;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function newToken() {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: hashToken(token) };
}

const EVENT_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打', WOMENS_SINGLES: '女子单打', MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打', MIXED_DOUBLES: '混合双打',
};

function eventLabel(type?: string | null, teamType?: string | null) {
  if (type) return EVENT_LABELS[type] ?? type;
  return teamType ? `团体赛·${EVENT_LABELS[teamType] ?? teamType}` : '团体赛';
}

function matchInTournament(tournamentId: string): Prisma.MatchWhereInput {
  return { OR: [{ event: { tournamentId } }, { teamMatch: { teamCompetition: { tournamentId } } }] };
}

/**
 * Broadcast rooms. All management methods are reached only through the
 * ROOT-only BroadcastsController; overlay and viewer reads check the token or
 * public flags plus the tournament publication state on every call.
 */
@Injectable()
export class BroadcastsService {
  private notifier?: Notifier;
  private mediaLifecycle?: { close(id: string): Promise<void> };

  setMediaLifecycle(lifecycle: { close(id: string): Promise<void> }) { this.mediaLifecycle = lifecycle; }

  constructor(
    private readonly prisma: PrismaService,
    private readonly score: BroadcastScoreService,
  ) {}

  setNotifier(notifier: Notifier) {
    this.notifier = notifier;
  }

  // ---------- Management (ROOT) ----------

  async list(tournamentId?: string) {
    const items = await this.prisma.broadcastSession.findMany({
      where: tournamentId ? { tournamentId } : {},
      orderBy: [{ createdAt: 'desc' }],
      select: adminSelect,
    });
    return items.map((item) => this.adminView(item));
  }

  async create(dto: CreateBroadcastDto, actorId: string) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: dto.tournamentId }, select: { id: true } });
    if (!tournament) throw new NotFoundException('赛事不存在');
    if (dto.venueId) await this.assertVenue(dto.tournamentId, dto.venueId);
    const { token, hash } = newToken();
    const created = await this.prisma.broadcastSession.create({
      data: {
        title: dto.title.trim(), tournamentId: dto.tournamentId, venueId: dto.venueId || null,
        createdById: actorId, overlayTokenHash: hash,
      },
      select: adminSelect,
    });
    return { ...this.adminView(created), overlayToken: token };
  }

  async detail(id: string) {
    const session = await this.prisma.broadcastSession.findUnique({ where: { id }, select: adminSelect });
    if (!session) throw new NotFoundException('直播间不存在');
    const [venues, matches] = await Promise.all([
      this.prisma.venue.findMany({
        where: { tournamentId: session.tournamentId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, isActive: true },
      }),
      this.prisma.match.findMany({
        where: {
          AND: [matchInTournament(session.tournamentId), { status: { not: MatchStatus.CANCELLED } }],
          ...(session.venueId ? { venueId: session.venueId } : {}),
        },
        orderBy: [{ scheduledAt: 'asc' }, { roundNo: 'asc' }, { matchNo: 'asc' }],
        take: 500,
        select: {
          id: true, status: true, round: true, roundNo: true, matchNo: true, scheduledAt: true,
          side1Id: true, side2Id: true, venueId: true,
          venue: { select: { name: true } },
          event: { select: { type: true } },
          teamCompetitionItem: { select: { eventType: true } },
        },
      }),
    ]);
    const described = await this.score.describeMatches(matches);
    const statusOrder: Record<string, number> = { LIVE: 0, PENDING: 1, COMPLETED: 2 };
    described.sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3));
    return {
      ...this.adminView(session),
      venues,
      matches: described.map(({ side1Id: _s1, side2Id: _s2, event, teamCompetitionItem, venue, ...match }) => ({
        ...match,
        eventName: eventLabel(event?.type, teamCompetitionItem?.eventType),
        venueName: venue?.name ?? null,
      })),
    };
  }

  async update(id: string, dto: UpdateBroadcastDto) {
    const session = await this.prisma.broadcastSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('直播间不存在');
    if (session.configVersion !== dto.configVersion) throw new ConflictException('直播间已被其他操作修改，请刷新后再试');

    const data: Prisma.BroadcastSessionUncheckedUpdateManyInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    // Publishing must go through publish() after the ROOT operator sees video.
    if (dto.isPublic !== undefined || dto.playbackUrl !== undefined || dto.ingestUrl !== undefined) {
      throw new BadRequestException('发布由“确认发布”按钮控制，推流和播放地址由系统生成');
    }
    if (dto.overlaySettings) data.overlaySettings = { ...dto.overlaySettings } as unknown as Prisma.InputJsonValue;
    if (dto.cameraSettings) {
      data.cameraSettings = {
        ...dto.cameraSettings, settingsVersion: CAMERA_SETTINGS_VERSION,
      } as unknown as Prisma.InputJsonValue;
    }

    const venueId = dto.venueId !== undefined ? dto.venueId || null : session.venueId;
    if (dto.venueId !== undefined) {
      if (venueId) await this.assertVenue(session.tournamentId, venueId);
      data.venueId = venueId;
    }
    if (dto.currentMatchId !== undefined) {
      if (dto.currentMatchId) await this.assertMatch(session.tournamentId, venueId, dto.currentMatchId);
      data.currentMatchId = dto.currentMatchId || null;
    } else if (dto.venueId !== undefined && venueId && session.currentMatchId) {
      // Changing the court must not silently keep a match from another court.
      await this.assertMatch(session.tournamentId, venueId, session.currentMatchId);
    }
    if (dto.status === 'LIVE') {
      throw new BadRequestException('请先在后台预览并点击“确认发布”');
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (session.status === BroadcastStatus.ENDED) data.endedAt = null;
      data.lastStreamEventAt = new Date();
    }

    // Version-guarded write: a concurrent update makes count 0.
    const result = await this.prisma.broadcastSession.updateMany({
      where: { id, configVersion: dto.configVersion },
      data: { ...data, configVersion: { increment: 1 } },
    });
    if (!result.count) throw new ConflictException('直播间已被其他操作修改，请刷新后再试');

    // Viewers lose access when the broadcast is switched off; the OBS overlay
    // additionally loses it when the tournament stops being public.
    if (dto.enabled === false) { this.notifier?.revoke(id); this.notifier?.revokeViewers(id); await this.mediaLifecycle?.close(id); }
    else await this.notifier?.pushConfig(id);
    return this.detail(id);
  }

  async rotateToken(id: string) {
    await this.ensureExists(id);
    const { token, hash } = newToken();
    await this.prisma.broadcastSession.update({
      where: { id },
      data: { overlayTokenHash: hash, configVersion: { increment: 1 } },
    });
    // Rotating the overlay token must not interrupt the website audience: the
    // viewer page is keyed by broadcast id, not by the token.
    this.notifier?.revoke(id);
    return { id, overlayToken: token };
  }

  async end(id: string) {
    await this.ensureExists(id);
    await this.prisma.broadcastSession.update({
      where: { id },
      data: { status: BroadcastStatus.ENDED, endedAt: new Date(), lastStreamEventAt: new Date(),
        liveSequence: { increment: 1 }, configVersion: { increment: 1 } },
    });
    this.notifier?.revokeViewers(id);
    await this.mediaLifecycle?.close(id);
    await this.notifier?.pushConfig(id);
    return this.detail(id);
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.broadcastSession.update({ where: { id }, data: { enabled: false, isPublic: false } });
    await this.mediaLifecycle?.close(id);
    this.notifier?.revoke(id);
    this.notifier?.revokeViewers(id);
    await this.prisma.broadcastSession.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** Logged-in preview: works for unpublished tournaments too. */
  async preview(id: string) {
    await this.ensureExists(id);
    return this.score.snapshot(id);
  }

  // ---------- OBS overlay (token) ----------

  async findOverlaySession(token: string) {
    if (!token || token.length > 200) return null;
    return this.prisma.broadcastSession.findFirst({
      where: { overlayTokenHash: hashToken(token), enabled: true, tournament: PUBLIC_TOURNAMENT_WHERE },
      select: { id: true },
    });
  }

  async overlaySnapshot(token: string) {
    const session = await this.findOverlaySession(token);
    if (!session) throw new NotFoundException('记分牌链接无效、已重置或赛事未公开');
    return this.score.snapshot(session.id);
  }

  /** Snapshot for realtime pushes; null means the room must be revoked. */
  async publicOverlaySnapshot(sessionId: string) {
    const allowed = await this.prisma.broadcastSession.findFirst({
      where: { id: sessionId, enabled: true, tournament: PUBLIC_TOURNAMENT_WHERE },
      select: { id: true },
    });
    return allowed ? this.score.snapshot(sessionId) : null;
  }

  async sessionIdsForMatch(matchId: string) {
    const sessions = await this.prisma.broadcastSession.findMany({
      where: { currentMatchId: matchId, enabled: true },
      select: { id: true },
    });
    return sessions.map((session) => session.id);
  }

  // ---------- Website viewers ----------

  private viewerWhere(extra: Prisma.BroadcastSessionWhereInput = {}): Prisma.BroadcastSessionWhereInput {
    return { ...extra, enabled: true, isPublic: true, status: BroadcastStatus.LIVE, tournament: PUBLIC_TOURNAMENT_WHERE };
  }

  /**
   * Scorecard for the public viewer page. Same filtered snapshot the overlay
   * uses, but keyed by broadcast id behind the viewer visibility rules. Returns
   * null when viewers may not see this broadcast at all; a session with no
   * match bound still returns a snapshot with match = null.
   */
  async publicSnapshot(sessionId: string) {
    const allowed = await this.prisma.broadcastSession.findFirst({
      where: this.viewerWhere({ id: sessionId }),
      select: { id: true },
    });
    return allowed ? this.score.snapshot(sessionId) : null;
  }

  async listPublic(tournamentId?: string) {
    const items = await this.prisma.broadcastSession.findMany({
      where: this.viewerWhere(tournamentId ? { tournamentId } : {}),
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true, title: true, status: true, startedAt: true,
        tournament: { select: { id: true, name: true } }, venue: { select: { name: true } },
      },
    });
    return items.map(({ venue, ...item }) => ({ ...item, venueName: venue?.name ?? null }));
  }

  async getPublic(id: string) {
    const session = await this.prisma.broadcastSession.findFirst({
      // The public waiting/ended page stays accessible; video and score access
      // still require LIVE through viewerWhere() and the media token endpoint.
      where: { id, enabled: true, isPublic: true, tournament: PUBLIC_TOURNAMENT_WHERE },
      select: {
        id: true, title: true, status: true, streamName: true, liveRoomName: true, startedAt: true, endedAt: true, currentMatchId: true,
        tournament: { select: { id: true, name: true } }, venue: { select: { name: true } },
      },
    });
    if (!session) throw new NotFoundException('直播间不存在或未公开');
    let currentMatch: { eventName: string; round: string; side1Name: string; side2Name: string; venueName: string | null } | null = null;
    if (session.currentMatchId) {
      const match = await this.prisma.match.findUnique({
        where: { id: session.currentMatchId },
        select: {
          id: true, round: true, side1Id: true, side2Id: true,
          venue: { select: { name: true } }, event: { select: { type: true } },
          teamCompetitionItem: { select: { eventType: true } },
        },
      });
      if (match) {
        const [described] = await this.score.describeMatches([match]);
        currentMatch = {
          eventName: eventLabel(match.event?.type, match.teamCompetitionItem?.eventType),
          round: match.round, side1Name: described.side1Name, side2Name: described.side2Name,
          venueName: match.venue?.name ?? null,
        };
      }
    }
    const { currentMatchId: _hidden, venue, streamName, liveRoomName, ...rest } = session;
    return {
      ...rest,
      venueName: venue?.name ?? null,
      mediaMode: liveRoomName ? 'livekit' : 'hls',
      // Same-origin backend proxy checks the viewer gate on every playlist and segment.
      playbackUrl: session.status === BroadcastStatus.LIVE && streamName && mediaConfig() ? `/api/public/broadcasts/${encodeURIComponent(id)}/media/index.m3u8` : null,
      currentMatch,
    };
  }

  // ---------- helpers ----------

  private adminView(session: Prisma.BroadcastSessionGetPayload<{ select: typeof adminSelect }>) {
    const {
      tournament, overlaySettings, cameraTokenHash, ingestUrlEnc: _ignoredIngestUrl, streamName, liveRoomName, cameraSettings, cameraState, cameraLastSeenAt, ...rest
    } = session;
    const lastSeen = cameraLastSeenAt?.getTime() ?? 0;
    return {
      ...rest,
      mediaMode: liveRoomName ? 'livekit' : 'hls',
      overlaySettings: this.score.settingsOf({ overlaySettings }),
      camera: {
        paired: Boolean(cameraTokenHash),
        // Online = a heartbeat within the last 15 s (the app sends one every 5 s).
        online: Date.now() - lastSeen < CAMERA_ONLINE_MS,
        lastSeenAt: cameraLastSeenAt,
        state: (cameraState as Record<string, unknown> | null) ?? null,
        settings: this.cameraSettingsOf(cameraSettings),
        // Host only: the stream key part of the URL is never sent back.
        hasIngestUrl: Boolean(streamName),
        ingestHost: mediaConfig()?.host ?? null,
      },
      tournament: {
        id: tournament.id, name: tournament.name,
        isPublic: tournament.isPublished && !tournament.isArchived && tournament.approvalStatus === 'APPROVED',
      },
    };
  }

  private cameraSettingsOf(raw: Prisma.JsonValue | null): CameraSettingsDto {
    const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    // Rows saved before the app started choosing its own quality still carry
    // resolution/fps. Dropping them here keeps them out of every response
    // instead of leaving a stale value for the app to honour.
    const { resolution: _legacyResolution, fps: _legacyFps, settingsVersion, ...rest } = stored;
    if (Number(settingsVersion ?? 1) < CAMERA_SETTINGS_VERSION) {
      // Version 1 kept the old 6000 default in every row, and interpreted it as a
      // hint the app was free to override. It is a hard cap now, so carrying it
      // over would silently pin a 4K phone to 6000 kbps - the very degradation
      // the app-side quality change exists to remove. The app sizes its own
      // bitrate until an operator sets a cap on purpose.
      delete rest.videoBitrateKbps;
    }
    return { ...DEFAULT_CAMERA_SETTINGS, ...rest } as CameraSettingsDto;
  }

  // ---------- Camera app (token, no account) ----------

  /**
   * Issues the pairing token shown once to the operator. Rotating it stops any
   * already-installed app on the next config poll.
   */
  async pairCamera(id: string) {
    await this.ensureExists(id);
    const current = await this.prisma.broadcastSession.findUnique({ where: { id }, select: { liveRoomName: true } });
    if (current?.liveRoomName) throw new BadRequestException('请使用直播间统一配对二维码');
    const { token, hash } = newToken();
    const streamName = randomBytes(18).toString('base64url');
    await this.prisma.broadcastSession.update({
      where: { id },
      // Rotate the opaque path as well: a previously paired publisher must not
      // remain able to write to this room after a new phone is paired.
      data: { cameraTokenHash: hash, streamName, isPublic: false, status: BroadcastStatus.READY, configVersion: { increment: 1 } },
    });
    this.notifier?.revokeViewers(id);
    // Suggested addresses for the pairing QR code. The admin page talks to the
    // API through localhost, which a phone cannot use, so it asks here.
    return { id, cameraToken: token, serverUrls: cameraServerUrls() };
  }

  /** ROOT operator must inspect the private picture before this transition. */
  async publish(id: string) {
    const session = await this.prisma.broadcastSession.findUnique({
      where: { id }, select: { enabled: true, status: true, streamName: true, cameraLastSeenAt: true, cameraState: true,
        tournament: { select: { isPublished: true, isArchived: true, approvalStatus: true } } },
    });
    if (!session) throw new NotFoundException('直播间不存在');
    if (!session.enabled || session.status === BroadcastStatus.ENDED || !session.streamName || !mediaConfig()) {
      throw new BadRequestException('直播间未启用、已结束或媒体服务未配置');
    }
    const t = session.tournament;
    if (!t.isPublished || t.isArchived || t.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('赛事尚未批准发布');
    }
    // Heartbeat alone does not prove the HLS is ready. Verify the actual
    // playlist at the local origin before opening the public viewer gate.
    const media = mediaConfig()!;
    const ready = await fetch(`${media.origin}/${session.streamName}/index.m3u8`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    if (!ready?.ok) throw new BadRequestException('媒体画面未就绪，请先在后台预览并确认');
    await ready.body?.cancel();
    await this.prisma.broadcastSession.update({ where: { id }, data: {
      isPublic: true, status: BroadcastStatus.LIVE, startedAt: new Date(), configVersion: { increment: 1 },
    } });
    await this.notifier?.pushConfig(id);
    return this.detail(id);
  }

  async withdraw(id: string) {
    await this.ensureExists(id);
    await this.prisma.broadcastSession.update({ where: { id }, data: { isPublic: false, configVersion: { increment: 1 } } });
    this.notifier?.revokeViewers(id);
    await this.mediaLifecycle?.close(id);
    return this.detail(id);
  }

  async mediaStream(id: string): Promise<string | null> {
    const room = await this.prisma.broadcastSession.findUnique({ where: { id }, select: { streamName: true, enabled: true } });
    if (!room) throw new NotFoundException('直播间不存在');
    return room.enabled ? room.streamName : null;
  }

  async publicMediaStream(id: string): Promise<string | null> {
    const room = await this.prisma.broadcastSession.findFirst({
      where: this.viewerWhere({ id, status: BroadcastStatus.LIVE }), select: { streamName: true },
    });
    return room?.streamName ?? null;
  }

  async authorizeMediaPublish(path: string, token: string): Promise<boolean> {
    if (!/^[a-zA-Z0-9_-]{24}$/.test(path) || !/^[a-zA-Z0-9_-]{32}$/.test(token)) return false;
    const room = await this.prisma.broadcastSession.findFirst({
      where: { streamName: path, cameraTokenHash: hashToken(token), enabled: true, status: { not: BroadcastStatus.ENDED } },
      select: { id: true },
    });
    return Boolean(room);
  }

  async unpairCamera(id: string) {
    await this.ensureExists(id);
    await this.prisma.broadcastSession.update({
      where: { id },
      data: { cameraTokenHash: null, streamName: null, isPublic: false, cameraState: Prisma.DbNull, cameraLastSeenAt: null },
    });
    this.notifier?.revokeViewers(id);
    return { id, paired: false };
  }

  private async cameraSession(token: string) {
    if (!token || token.length > 200) return null;
    return this.prisma.broadcastSession.findFirst({
      where: { cameraTokenHash: hashToken(token), enabled: true },
      select: {
        id: true, title: true, status: true, configVersion: true, cameraSettings: true,
        streamName: true, cameraTokenHash: true, tournament: { select: { id: true, name: true } },
        venue: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Everything the app needs to start or keep streaming. The push URL is the
   * only secret returned and only to a holder of the camera token.
   */
  async cameraConfig(token: string) {
    const session = await this.cameraSession(token);
    if (!session) throw new UnauthorizedException('配对令牌无效或直播间已停用');
    return {
      broadcastId: session.id,
      title: session.title,
      status: session.status,
      configVersion: session.configVersion,
      tournamentName: session.tournament.name,
      venueName: session.venue?.name ?? null,
      settings: this.cameraSettingsOf(session.cameraSettings),
      // URL is derived; the publisher credential never enters the public/admin DTO.
      ingestUrl: (() => {
        const media = mediaConfig();
        return media && session.streamName && session.cameraTokenHash
          ? `rtmp://${media.host}:${media.port}/${session.streamName}?token=${token}` : null;
      })(),
    };
  }

  /** App heartbeat: powers the admin "camera online" light. */
  async cameraHeartbeat(token: string, dto: CameraHeartbeatDto) {
    const session = await this.cameraSession(token);
    if (!session) throw new UnauthorizedException('配对令牌无效或直播间已停用');
    const state = {
      state: dto.state, bitrateKbps: dto.bitrateKbps ?? null, fps: dto.fps ?? null,
      width: dto.width ?? null, height: dto.height ?? null, zoom: dto.zoom ?? null,
      audioSource: dto.audioSource ?? null, battery: dto.battery ?? null,
      message: dto.message ?? null, at: new Date().toISOString(),
    };
    await this.prisma.broadcastSession.update({
      where: { id: session.id },
      data: { cameraState: state as unknown as Prisma.InputJsonValue, cameraLastSeenAt: new Date() },
    });
    // The title/config may have changed while the app was running.
    return this.cameraConfig(token);
  }

  /** App-side unpair: the phone forgets the room, the server drops the token. */
  async cameraUnpairSelf(token: string) {
    const session = await this.cameraSession(token);
    if (!session) throw new UnauthorizedException('配对令牌无效或直播间已停用');
    await this.prisma.broadcastSession.update({
      where: { id: session.id },
      data: { cameraTokenHash: null, streamName: null, isPublic: false, cameraState: Prisma.DbNull, cameraLastSeenAt: null },
    });
    this.notifier?.revokeViewers(session.id);
    return { broadcastId: session.id, paired: false };
  }

  private async ensureExists(id: string) {
    const found = await this.prisma.broadcastSession.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('直播间不存在');
  }

  private async assertVenue(tournamentId: string, venueId: string) {
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, tournamentId }, select: { id: true } });
    if (!venue) throw new BadRequestException('场地不属于该赛事');
  }

  private async assertMatch(tournamentId: string, venueId: string | null, matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { AND: [{ id: matchId }, matchInTournament(tournamentId)] },
      select: { id: true, venueId: true, status: true },
    });
    if (!match) throw new BadRequestException('比赛不属于该赛事');
    if (match.status === MatchStatus.CANCELLED) throw new BadRequestException('比赛已取消');
    if (venueId && match.venueId !== venueId) {
      throw new BadRequestException('该比赛已不在所绑定的场地（可能已重新排程），请确认场地后再切换');
    }
  }
}
