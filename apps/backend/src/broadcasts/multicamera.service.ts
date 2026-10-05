import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger,
  NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException,
} from '@nestjs/common';
import { BroadcastSession, Prisma, Role } from '@prisma/client';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_TOURNAMENT_WHERE } from './broadcast-score.service';
import { BroadcastsService } from './broadcasts.service';
import { cameraServerUrls } from './camera-server-urls';
import { LiveHeartbeatDto } from './dto/multicamera.dto';
import { LivekitMediaService, type MediaParticipant } from './livekit-media.service';

type Actor = { id: string; role: Role };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const isFresh = (seen: Date | null) => Boolean(seen && Date.now() - seen.getTime() < 15_000);

/** State changes use a DB compare-and-swap; client heartbeats never set PGM/audio. */
@Injectable()
export class MulticameraService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private reconciling = false;
  private readonly logger = new Logger(MulticameraService.name);
  private readonly syncs = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaService, private readonly media: LivekitMediaService,
    private readonly broadcasts: BroadcastsService) {}

  onModuleInit() {
    this.broadcasts.setMediaLifecycle({ close: (id) => this.closeMedia(id) });
    this.timer = setInterval(() => void this.reconcile(), 3000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async authorize(id: string, actor: Actor, audio = false, rootOnly = false) {
    if (actor.role === Role.ROOT) return;
    const grant = !rootOnly && await this.prisma.broadcastDirector.findUnique({
      where: { broadcastId_userId: { broadcastId: id, userId: actor.id } },
    });
    if (!grant || (audio && !grant.canAudio)) throw new ForbiddenException('未获得本直播间的导播权限');
  }

  private async room(id: string) {
    const room = await this.prisma.broadcastSession.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('直播间不存在');
    return room;
  }

  private usable(room: BroadcastSession) {
    if (!room.liveRoomName || !room.enabled || room.status === 'ENDED') throw new BadRequestException('多机位直播间未启用或已结束');
  }

  async enable(id: string, count: number, actor: Actor) {
    await this.authorize(id, actor, false, true);
    if (!Number.isInteger(count) || count < 1 || count > 6) throw new BadRequestException('机位数量应为 1 至 6');
    if (!this.media.configured()) throw new BadRequestException('请先配置 LIVEKIT_URL、LIVEKIT_API_KEY 和 LIVEKIT_API_SECRET');
    const room = await this.room(id);
    if (room.liveRoomName) return this.snapshot(id, actor);
    if (room.isPublic || room.status === 'LIVE') throw new ConflictException('请先撤回现有直播，再启用多机位');
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.broadcastSession.updateMany({ where: { id, liveRoomName: null, isPublic: false, status: { not: 'LIVE' } }, data: {
        liveRoomName: `broadcast_${randomUUID()}`, status: 'READY', endedAt: null,
        liveSequence: { increment: 1 }, configVersion: { increment: 1 },
      } });
      if (!updated.count) throw new ConflictException('直播间已被修改，请刷新');
      for (let i = 1; i <= count; i++) await tx.broadcastCamera.create({ data: { broadcastId: id, code: `CAM${i}`, name: i === 1 ? '主机位' : `机位 ${i}` } });
      await tx.broadcastLiveLog.create({ data: { broadcastId: id, kind: 'ENABLE', operatorId: actor.id, sequence: room.liveSequence + 1 } });
    });
    return this.snapshot(id, actor);
  }

  control(room: BroadcastSession) {
    return {
      broadcastId: room.id, sequence: room.liveSequence, status: room.status,
      live: room.enabled && room.isPublic && room.status === 'LIVE',
      waiting: room.enabled && room.isPublic && room.status === 'READY',
      activeCameraId: room.activeCameraId, previewCameraId: room.previewCameraId,
      audioCameraId: room.audioCameraId, previousCameraId: room.previousCameraId,
      transitionUntil: room.transitionUntil?.toISOString() ?? null,
    };
  }

  async snapshot(id: string, actor: Actor) {
    await this.authorize(id, actor);
    const room = await this.room(id);
    const cameras = await this.prisma.broadcastCamera.findMany({ where: { broadcastId: id }, orderBy: { code: 'asc' }, select: {
      id: true, code: true, name: true, state: true, lastSeenAt: true, deviceId: true,
    } });
    const grant = actor.role === Role.ROOT ? { canAudio: true } : await this.prisma.broadcastDirector.findUnique({
      where: { broadcastId_userId: { broadcastId: id, userId: actor.id } }, select: { canAudio: true },
    });
    return { ...this.control(room), title: room.title, enabled: Boolean(room.liveRoomName),
      configured: this.media.configured(), canAudio: grant?.canAudio ?? false,
      cameras: cameras.map(({ deviceId, ...camera }) => ({ ...camera, paired: Boolean(deviceId), online: isFresh(camera.lastSeenAt),
        onAir: room.isPublic && room.status === 'LIVE' && room.activeCameraId === camera.id,
        audioEnabled: room.audioCameraId === camera.id })),
      logs: await this.prisma.broadcastLiveLog.findMany({ where: { broadcastId: id }, orderBy: { createdAt: 'desc' }, take: 30 }),
    };
  }

  async pair(id: string, cameraId: string, actor: Actor) {
    await this.authorize(id, actor, false, true);
    const room = await this.room(id); this.usable(room);
    if ([room.activeCameraId, room.audioCameraId].includes(cameraId)) throw new ConflictException('请先把正式画面和主音频切到其他机位，再重新配对');
    const code = `live_${secret()}`;
    const changed = await this.prisma.broadcastCamera.updateMany({ where: { id: cameraId, broadcastId: id }, data: {
      pairingHash: hash(code), pairingExpiresAt: new Date(Date.now() + 300_000),
      tokenHash: null, deviceId: null, state: Prisma.DbNull, lastSeenAt: null,
    } });
    if (!changed.count) throw new NotFoundException('机位不存在');
    // Revocation is also enforced by reconcile; a failed remove must not restore the old pairing.
    if (room.liveRoomName) { await this.syncRoom(id); await this.removeParticipantIfPresent(room.liveRoomName, `camera_${cameraId}`); }
    return { code, expiresAt: new Date(Date.now() + 300_000).toISOString(), serverUrls: cameraServerUrls() };
  }

  async redeem(code: string, deviceId: string) {
    if (code.startsWith('live_room_')) return this.redeemShared(code, deviceId);
    const credential = secret();
    const camera = await this.prisma.$transaction(async (tx) => {
      const camera = await tx.broadcastCamera.findUnique({ where: { pairingHash: hash(code) }, include: { broadcast: true } });
      if (!camera || !camera.pairingExpiresAt || camera.pairingExpiresAt.getTime() <= Date.now()) throw new UnauthorizedException('配对码已使用或过期');
      this.usable(camera.broadcast);
      const changed = await tx.broadcastCamera.updateMany({ where: { id: camera.id, pairingHash: hash(code), tokenHash: null, pairingExpiresAt: { gt: new Date() } }, data: {
        pairingHash: null, pairingExpiresAt: null, tokenHash: hash(credential), deviceId,
      } });
      if (!changed.count) throw new ConflictException('该机位已被其他设备配对');
      return camera;
    });
    return { credential, cameraId: camera.id, code: camera.code, broadcastId: camera.broadcastId };
  }

  async unpair(id: string, cameraId: string, actor: Actor) {
    await this.authorize(id, actor, false, true);
    const room = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM broadcast_session WHERE id = ${id} FOR UPDATE`;
      const room = await tx.broadcastSession.findUniqueOrThrow({ where: { id } });
      this.usable(room);
      const selected = [room.activeCameraId, room.audioCameraId].includes(cameraId)
        || room.previousCameraId === cameraId && Boolean(room.transitionUntil && room.transitionUntil.getTime() > Date.now());
      if (room.isPublic && room.status === 'LIVE' && selected) throw new ConflictException('请先暂停直播或切换正式画面和主音频，再解除配对');
      const changed = await tx.broadcastCamera.updateMany({ where: { id: cameraId, broadcastId: id }, data: {
        tokenHash: null, deviceId: null, pairingHash: null, pairingExpiresAt: null, state: Prisma.DbNull, lastSeenAt: null,
      } });
      if (!changed.count) throw new NotFoundException('机位不存在');
      await tx.broadcastSession.update({ where: { id }, data: {
        ...(room.activeCameraId === cameraId ? { activeCameraId: null } : {}),
        ...(room.previewCameraId === cameraId ? { previewCameraId: null } : {}),
        ...(room.audioCameraId === cameraId ? { audioCameraId: null } : {}),
        ...(room.previousCameraId === cameraId ? { previousCameraId: null, transitionUntil: null } : {}),
        liveSequence: { increment: 1 },
      } });
      await tx.broadcastLiveLog.create({ data: { broadcastId: id, kind: 'UNPAIR', operatorId: actor.id, fromId: cameraId, sequence: room.liveSequence + 1 } });
      return room;
    });
    await this.syncRoom(id);
    await this.removeParticipantIfPresent(room.liveRoomName!, `camera_${cameraId}`);
    return this.snapshot(id, actor);
  }

  async sharedCode(id: string, actor: Actor, rotate = false) {
    await this.authorize(id, actor, false, true);
    const signingSecret = process.env.JWT_SECRET;
    if (!signingSecret) throw new BadRequestException('服务端尚未配置认证密钥');
    // A random invitation ID plus the server secret lets ROOT reopen the same
    // QR across pages/restarts without storing its plaintext in the database.
    const codeFor = (inviteId: string) => `live_room_${createHmac('sha256', signingSecret).update(`room-invite:${id}:${inviteId}`).digest('base64url')}`;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM broadcast_session WHERE id = ${id} FOR UPDATE`;
      const room = await tx.broadcastSession.findUnique({ where: { id } });
      if (!room) throw new NotFoundException('直播间不存在');
      this.usable(room);
      const current = await tx.broadcastJoinInvite.findUnique({ where: { broadcastId: id } });
      if (!rotate && current && current.expiresAt.getTime() > Date.now() && hash(codeFor(current.id)) === current.codeHash) {
        return { code: codeFor(current.id), expiresAt: current.expiresAt.toISOString() };
      }
      const inviteId = randomUUID();
      const code = codeFor(inviteId);
      const expiresAt = new Date(Date.now() + 30 * 60_000);
      await tx.broadcastJoinInvite.upsert({ where: { broadcastId: id },
        create: { id: inviteId, broadcastId: id, codeHash: hash(code), expiresAt },
        update: { id: inviteId, codeHash: hash(code), expiresAt, claims: 0 } });
      // Retire unused per-camera invitations so they cannot reserve empty slots.
      await tx.broadcastCamera.updateMany({ where: { broadcastId: id, deviceId: null, tokenHash: null },
        data: { pairingHash: null, pairingExpiresAt: null } });
      return { code, expiresAt: expiresAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return { ...result, serverUrls: cameraServerUrls() };
  }

  async revokeSharedCode(id: string, actor: Actor) {
    await this.authorize(id, actor, false, true);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM broadcast_session WHERE id = ${id} FOR UPDATE`;
      await tx.broadcastJoinInvite.deleteMany({ where: { broadcastId: id } });
    });
    return { revoked: true };
  }

  private async redeemShared(code: string, deviceId: string) {
    const signingSecret = process.env.JWT_SECRET;
    if (!signingSecret) throw new BadRequestException('服务端尚未配置认证密钥');
    // Retrying the same scan recovers the same credential without consuming another slot.
    const credential = createHmac('sha256', signingSecret).update(`camera-join:${code}:${deviceId}`).digest('base64url');
    const camera = await this.prisma.$transaction(async (tx) => {
      const invite = await tx.broadcastJoinInvite.findUnique({ where: { codeHash: hash(code) } });
      if (!invite) throw new UnauthorizedException('接入二维码已失效，请联系导播重新生成');
      await tx.$queryRaw`SELECT id FROM broadcast_session WHERE id = ${invite.broadcastId} FOR UPDATE`;
      // Lock the room's invite row before allocating a camera, including concurrent scans.
      const locked = await tx.broadcastJoinInvite.updateMany({ where: { id: invite.id, codeHash: hash(code), expiresAt: { gt: new Date() } },
        data: { claims: { increment: 1 } } });
      if (!locked.count) throw new UnauthorizedException('接入二维码已过期');
      const room = await tx.broadcastSession.findUniqueOrThrow({ where: { id: invite.broadcastId } });
      this.usable(room);
      const existing = await tx.broadcastCamera.findFirst({ where: { broadcastId: room.id, deviceId } });
      if (existing) {
        // A current room QR authorizes recovery after the app forgot its token
        // or the invitation was rotated. Reuse the slot and replace only this
        // device's credential; every other paired phone keeps its credential.
        if (existing.tokenHash !== hash(credential)) await tx.broadcastCamera.update({ where: { id: existing.id }, data: { tokenHash: hash(credential) } });
        return existing;
      }
      const free = await tx.broadcastCamera.findFirst({ where: { broadcastId: room.id, deviceId: null, tokenHash: null, pairingHash: null }, orderBy: { code: 'asc' } });
      if (!free) throw new ConflictException('机位已满，请联系导播释放机位');
      const claimed = await tx.broadcastCamera.updateMany({ where: { id: free.id, deviceId: null, tokenHash: null, pairingHash: null },
        data: { deviceId, tokenHash: hash(credential), pairingExpiresAt: null } });
      if (!claimed.count) throw new ConflictException('该机位刚被接入，请重新扫码');
      return free;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return { credential, cameraId: camera.id, code: camera.code, broadcastId: camera.broadcastId };
  }

  private async authenticatedCamera(token: string) {
    if (!/^[\w-]{43}$/.test(token)) throw new UnauthorizedException('摄像端凭据无效');
    const camera = await this.prisma.broadcastCamera.findUnique({ where: { tokenHash: hash(token) }, include: { broadcast: true } });
    if (!camera) throw new UnauthorizedException('摄像端配对已失效');
    if (!camera.broadcast.enabled || camera.broadcast.status === 'ENDED' || !camera.broadcast.liveRoomName) throw new UnauthorizedException('直播已结束或停用');
    return camera;
  }

  async cameraConfig(token: string, join = false) {
    const camera = await this.authenticatedCamera(token);
    const room = camera.broadcast;
    if (join) await this.syncRoom(room.id);
    const publicRoom = await this.prisma.broadcastSession.findFirst({ where: { id: room.id, tournament: PUBLIC_TOURNAMENT_WHERE }, select: { id: true } });
    return { ...this.control(room), live: this.control(room).live && Boolean(publicRoom), cameraId: camera.id, cameraCode: camera.code, cameraName: camera.name,
      audioEnabled: room.audioCameraId === camera.id, onAir: room.isPublic && room.status === 'LIVE' && room.activeCameraId === camera.id,
      quality: { mode: 'device', suggestedHeight: 1080, suggestedFps: 30 },
      ...(join ? { media: this.media.token(room.liveRoomName!, `camera_${camera.id}`, 'camera', room.audioCameraId === camera.id) } : {}),
    };
  }

  async heartbeat(token: string, dto: LiveHeartbeatDto) {
    const camera = await this.authenticatedCamera(token);
    const now = new Date();
    await this.prisma.broadcastCamera.updateMany({ where: { id: camera.id, tokenHash: hash(token) }, data: {
      state: { ...dto, at: now.toISOString() } as Prisma.InputJsonValue, lastSeenAt: now,
    } });
    return this.cameraConfig(token);
  }

  private async selectedCamera(id: string, cameraId: string, requireOnline = true) {
    const camera = await this.prisma.broadcastCamera.findFirst({ where: { id: cameraId, broadcastId: id } });
    if (!camera) throw new BadRequestException('机位不属于当前直播间');
    if (requireOnline && (!isFresh(camera.lastSeenAt) || !camera.deviceId)) throw new ConflictException('目标机位离线，请先恢复连接');
    return camera;
  }

  private async change(id: string, sequence: number, data: Prisma.BroadcastSessionUpdateManyMutationInput,
    kind: string, actor: Actor, fromId?: string | null, toId?: string | null, allowEnded = false) {
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.broadcastSession.updateMany({ where: { id, liveSequence: sequence, enabled: true,
        ...(allowEnded ? {} : { status: { not: 'ENDED' as const } }) }, data: {
        ...data, liveSequence: { increment: 1 },
      } });
      if (!changed.count) throw new ConflictException('导播状态已变化，请刷新后重试');
      await tx.broadcastLiveLog.create({ data: { broadcastId: id, kind, operatorId: actor.id, fromId, toId, sequence: sequence + 1 } });
    });
    await this.syncRoom(id);
    return this.snapshot(id, actor);
  }

  async preview(id: string, cameraId: string, sequence: number, actor: Actor) {
    await this.authorize(id, actor);
    const room = await this.room(id); this.usable(room);
    await this.selectedCamera(id, cameraId);
    return this.change(id, sequence, { previewCameraId: cameraId }, 'PREVIEW', actor, room.previewCameraId, cameraId);
  }

  async take(id: string, sequence: number, actor: Actor) {
    await this.authorize(id, actor);
    const room = await this.room(id); this.usable(room);
    if (!room.previewCameraId) throw new BadRequestException('请先选择 PVW 预监机位');
    await this.selectedCamera(id, room.previewCameraId);
    if (!(await this.media.assertVideo(room.liveRoomName!, room.previewCameraId))) throw new ConflictException('目标机位尚未发布视频，保留当前 PGM');
    // Audio is deliberately absent: TAKE never changes the microphone.
    return this.change(id, sequence, { activeCameraId: room.previewCameraId,
      previousCameraId: room.activeCameraId, transitionUntil: new Date(Date.now() + 8000),
    }, 'TAKE', actor, room.activeCameraId, room.previewCameraId);
  }

  async audio(id: string, cameraId: string, sequence: number, actor: Actor) {
    await this.authorize(id, actor, true);
    const room = await this.room(id); this.usable(room);
    // Selection is allowed before joining; only the selected camera gets a microphone grant.
    await this.selectedCamera(id, cameraId, false);
    return this.change(id, sequence, { audioCameraId: cameraId }, 'AUDIO', actor, room.audioCameraId, cameraId);
  }

  async start(id: string, sequence: number, actor: Actor) {
    await this.authorize(id, actor);
    const room = await this.room(id);
    if (!room.liveRoomName || !room.enabled) throw new BadRequestException('直播间尚未启用');
    if (room.liveSequence !== sequence) throw new ConflictException('导播状态已变化，请刷新后重试');
    const published = await this.prisma.broadcastSession.findFirst({ where: { id, tournament: PUBLIC_TOURNAMENT_WHERE } });
    if (!published) throw new BadRequestException('赛事尚未审核发布或已归档');
    if (room.status === 'LIVE' && room.isPublic) return this.snapshot(id, actor);
    // Complete the previous round's cleanup before reopening its room.
    if (room.status === 'ENDED') await this.closeMedia(id);
    const cameras = await this.prisma.broadcastCamera.findMany({ where: { broadcastId: id }, select: { id: true } });
    const singleCameraId = cameras.length === 1 ? cameras[0].id : null;
    const canSelectAudio = actor.role === Role.ROOT || Boolean(!room.audioCameraId && singleCameraId &&
      (await this.prisma.broadcastDirector.findUnique({ where: { broadcastId_userId: { broadcastId: id, userId: actor.id } }, select: { canAudio: true } }))?.canAudio);
    return this.change(id, sequence, { status: 'READY', isPublic: true, endedAt: null,
      ...(room.status === 'ENDED' ? { startedAt: null, previousCameraId: null, transitionUntil: null } : {}),
      activeCameraId: room.activeCameraId ?? singleCameraId,
      audioCameraId: room.audioCameraId ?? (canSelectAudio ? singleCameraId : null),
      configVersion: { increment: 1 } }, 'START', actor, undefined, undefined, true);
  }

  async stop(id: string, sequence: number, actor: Actor, end: boolean) {
    await this.authorize(id, actor);
    await this.change(id, sequence, { ...(end ? {} : { isPublic: false }), status: end ? 'ENDED' : 'INTERRUPTED',
      ...(end ? { endedAt: new Date() } : {}), configVersion: { increment: 1 } }, end ? 'END' : 'PAUSE', actor);
    await this.closeMedia(id);
    return this.snapshot(id, actor);
  }

  async directorToken(id: string, actor: Actor) {
    await this.authorize(id, actor);
    const room = await this.room(id); this.usable(room);
    await this.syncRoom(id);
    return this.media.token(room.liveRoomName!, `director_${actor.id}_${randomBytes(6).toString('hex')}`, 'director');
  }

  async viewerToken(id: string) {
    const room = await this.prisma.broadcastSession.findFirst({ where: {
      id, enabled: true, isPublic: true, status: 'LIVE', tournament: PUBLIC_TOURNAMENT_WHERE,
    } });
    if (!room?.liveRoomName) throw new NotFoundException('直播间不存在或未公开');
    await this.syncRoom(id);
    const viewers = (await this.media.participants(room.liveRoomName)).filter((p) => p.identity.startsWith('viewer_'));
    const limit = Math.max(1, Math.min(50, Number(process.env.LIVEKIT_VIEWER_LIMIT) || 8));
    if (viewers.length >= limit) throw new ConflictException('当前直播观看人数已达容量上限，请稍后重试');
    return { ...this.media.token(room.liveRoomName, `viewer_${randomUUID()}`, 'viewer'), control: this.control(room) };
  }

  async grant(id: string, userId: string, canAudio: boolean, actor: Actor) {
    await this.authorize(id, actor, false, true);
    await this.room(id);
    if (!(await this.prisma.user.findUnique({ where: { id: userId } }))) throw new NotFoundException('用户不存在');
    return this.prisma.broadcastDirector.upsert({ where: { broadcastId_userId: { broadcastId: id, userId } },
      create: { broadcastId: id, userId, canAudio }, update: { canAudio } });
  }

  async revokeDirector(id: string, userId: string, actor: Actor) {
    await this.authorize(id, actor, false, true);
    await this.prisma.broadcastDirector.deleteMany({ where: { broadcastId: id, userId } });
    const room = await this.room(id);
    if (room.liveRoomName) for (const p of await this.media.participants(room.liveRoomName)) {
      if (p.identity.startsWith(`director_${userId}_`)) await this.media.call('RemoveParticipant', room.liveRoomName, { identity: p.identity });
    }
    return { revoked: true };
  }

  private async removeParticipantIfPresent(room: string, identity: string) {
    if ((await this.media.participants(room)).some((p) => p.identity === identity)) await this.media.call('RemoveParticipant', room, { identity });
  }

  /** Serialize metadata writes; always reread the committed sequence inside the queue. */
  private syncRoom(id: string): Promise<void> {
    const next = (this.syncs.get(id) ?? Promise.resolve()).catch(() => undefined).then(() => this.syncLatest(id));
    this.syncs.set(id, next);
    void next.finally(() => { if (this.syncs.get(id) === next) this.syncs.delete(id); }).catch(() => undefined);
    return next;
  }

  private async syncLatest(id: string) {
    let room = await this.room(id);
    if (!room.liveRoomName) return;
    const mediaRoomName = room.liveRoomName;
    if (room.status === 'ENDED' || !room.enabled) {
      await this.prisma.broadcastJoinInvite.deleteMany({ where: { broadcastId: id } });
      // Revoke business credentials even when the media server is unavailable.
      await this.prisma.broadcastCamera.updateMany({ where: { broadcastId: id }, data: {
        tokenHash: null, pairingHash: null, pairingExpiresAt: null,
        deviceId: null, lastSeenAt: null, state: Prisma.DbNull,
      } });
      await this.media.call('DeleteRoom', room.liveRoomName);
      return;
    }
    const publicRoom = await this.prisma.broadcastSession.findFirst({ where: { id, tournament: PUBLIC_TOURNAMENT_WHERE }, select: { id: true } });
    await this.media.call('CreateRoom', room.liveRoomName, { name: room.liveRoomName, emptyTimeout: 300, maxParticipants: 18 });
    const participants = await this.media.participants(room.liveRoomName);
    const cameras = await this.prisma.broadcastCamera.findMany({ where: { broadcastId: id, tokenHash: { not: null } }, select: { id: true } });
    const valid = new Set(cameras.map((c) => `camera_${c.id}`));
    // Only an explicit START arms automatic publication. Paused/private rooms
    // stay private, and a phone heartbeat alone cannot put a stream on air.
    if (publicRoom && room.isPublic && room.status === 'READY' && this.programReady(room, participants.filter((p) => valid.has(p.identity)))) {
      await this.prisma.broadcastSession.updateMany({ where: { id, liveSequence: room.liveSequence, enabled: true, isPublic: true, status: 'READY' },
        data: { status: 'LIVE', startedAt: room.startedAt ?? new Date(), liveSequence: { increment: 1 }, configVersion: { increment: 1 } } });
      room = await this.room(id);
    }
    const control = { ...this.control(room), live: this.control(room).live && Boolean(publicRoom) };
    const directors = await this.prisma.broadcastDirector.findMany({ where: { broadcastId: id }, select: { userId: true } });
    const rootUsers = await this.prisma.user.findMany({ where: { role: Role.ROOT }, select: { id: true } });
    const authorizedDirectors = new Set([...directors, ...rootUsers].map((u) => 'userId' in u ? u.userId : u.id));
    for (const p of participants) {
      const revokedDirector = p.identity.startsWith('director_') && !authorizedDirectors.has(p.identity.slice(9, p.identity.lastIndexOf('_')));
      if (revokedDirector || p.identity.startsWith('viewer_') && !control.live || p.identity.startsWith('camera_') && !valid.has(p.identity)) {
        await this.media.call('RemoveParticipant', mediaRoomName, { identity: p.identity });
        continue;
      }
      // Revoke old audio before granting the new source.
      if (p.identity.startsWith('camera_') && p.identity !== `camera_${room.audioCameraId}`) {
        for (const track of p.tracks ?? []) if ((track.source === 'MICROPHONE' || track.source === 2) && !track.muted) {
          await this.media.call('MutePublishedTrack', mediaRoomName, { identity: p.identity, trackSid: track.sid, muted: true });
        }
        await this.media.call('UpdateParticipant', mediaRoomName, { identity: p.identity,
          permission: { canPublish: true, canSubscribe: false, canPublishData: false, canPublishSources: [1] } });
      }
    }
    if (participants.some((p) => p.identity === `camera_${room.audioCameraId}`)) await this.media.call('UpdateParticipant', mediaRoomName, {
      identity: `camera_${room.audioCameraId}`, permission: { canPublish: true, canSubscribe: false, canPublishData: false, canPublishSources: [1, 2] },
    });
    await this.media.call('UpdateRoomMetadata', mediaRoomName, { metadata: JSON.stringify(control) });
  }

  async closeMedia(id: string) {
    if (!this.media.configured()) return;
    await this.syncRoom(id);
  }

  private programReady(room: BroadcastSession, participants: MediaParticipant[]) {
    const video = participants.find((p) => p.identity === `camera_${room.activeCameraId}`)?.tracks
      ?.some((t) => (t.source === 'CAMERA' || t.source === 1) && !t.muted);
    const audio = participants.find((p) => p.identity === `camera_${room.audioCameraId}`)?.tracks
      ?.some((t) => (t.source === 'MICROPHONE' || t.source === 2) && !t.muted);
    return Boolean(video && audio);
  }

  private async reconcile() {
    if (this.reconciling || !this.media.configured()) return;
    this.reconciling = true;
    try {
      // Include ended rooms still present on the SFU after an outage or API failure.
      const mediaRooms = await this.media.rooms();
      const rooms = await this.prisma.broadcastSession.findMany({ where: { liveRoomName: { not: null }, OR: [
        { enabled: true, status: { not: 'ENDED' } },
        { liveRoomName: { in: mediaRooms.map((room) => room.name) } },
        { cameras: { some: { tokenHash: { not: null } } } },
      ] }, select: { id: true } });
      for (const room of rooms) await this.syncRoom(room.id).catch(() => this.logger.warn(`直播媒体状态同步失败: ${room.id}`));
    } catch { this.logger.warn('多机位状态巡检失败'); }
    finally { this.reconciling = false; }
  }
}
