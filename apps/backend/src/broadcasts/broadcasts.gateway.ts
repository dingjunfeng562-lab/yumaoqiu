import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { ScoringGateway } from '../scoring/scoring.gateway';
import { BroadcastsService } from './broadcasts.service';

/**
 * Read-only realtime channel for the scorecard. Two audiences share it with
 * separate rooms and separate admission rules:
 *
 *   overlay:<id>  OBS browser source, admitted by the unguessable token.
 *   viewer:<id>   website viewer page, admitted by the public-visibility rules.
 *
 * Both receive the same filtered snapshot, which never contains referee
 * accounts, contact details, notes or the internal event log.
 */
@WebSocketGateway({
  namespace: 'broadcasts',
  cors: { origin: true, credentials: true },
})
export class BroadcastsGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(BroadcastsGateway.name);
  private subscription?: Subscription;
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly broadcasts: BroadcastsService,
    private readonly scoringGateway: ScoringGateway,
  ) {}

  onModuleInit() {
    this.broadcasts.setNotifier(this);
    this.subscription = this.scoringGateway.matchChanges.subscribe((matchId) => {
      void this.broadcasts.sessionIdsForMatch(matchId)
        .then((ids) => ids.forEach((id) => this.scheduleScore(id)))
        .catch((error) => this.logger.warn(`broadcast lookup failed: ${String(error)}`));
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    this.pending.forEach((timer) => clearTimeout(timer));
  }

  /** OBS browser source: the token is the only credential. */
  @SubscribeMessage('joinOverlay')
  async joinOverlay(@ConnectedSocket() client: Socket, @MessageBody() body: { token?: string }) {
    const token = typeof body?.token === 'string' ? body.token : '';
    const session = token ? await this.broadcasts.findOverlaySession(token) : null;
    if (!session) return { ok: false, message: '记分牌链接无效或未开放' };
    await this.leaveAll(client);
    await client.join(this.overlayRoom(session.id));
    return { ok: true, snapshot: await this.broadcasts.overlaySnapshot(token) };
  }

  /** Website viewer page: public broadcasts only, no credential. */
  @SubscribeMessage('joinViewer')
  async joinViewer(@ConnectedSocket() client: Socket, @MessageBody() body: { broadcastId?: string }) {
    const id = typeof body?.broadcastId === 'string' ? body.broadcastId : '';
    const snapshot = id ? await this.broadcasts.publicSnapshot(id) : null;
    if (!snapshot) return { ok: false, message: '直播间不存在或未公开' };
    await this.leaveAll(client);
    await client.join(this.viewerRoom(id));
    return { ok: true, snapshot };
  }

  /** Score changed: coalesce bursts, then push the filtered state. */
  scheduleScore(sessionId: string) {
    if (this.pending.has(sessionId)) return;
    this.pending.set(sessionId, setTimeout(() => {
      this.pending.delete(sessionId);
      void this.push(sessionId, 'broadcast:update');
    }, 80));
  }

  /** Match switch or style change: sent immediately, clients drop old queues. */
  async pushConfig(sessionId: string) {
    await this.push(sessionId, 'broadcast:config');
  }

  /** Token rotated: clear the OBS boards and drop their subscribers. */
  revoke(sessionId: string) {
    this.drop(this.overlayRoom(sessionId));
  }

  /** Unpublished or switched off: the website audience loses it too. */
  revokeViewers(sessionId: string) {
    this.drop(this.viewerRoom(sessionId));
  }

  private drop(room: string) {
    this.server.to(room).emit('broadcast:revoked', { room });
    this.server.in(room).disconnectSockets(true);
  }

  private async push(sessionId: string, event: 'broadcast:update' | 'broadcast:config') {
    try {
      const overlay = await this.broadcasts.publicOverlaySnapshot(sessionId);
      if (overlay) this.server.to(this.overlayRoom(sessionId)).emit(event, overlay);
      else this.revoke(sessionId);

      // Never reuse the overlay snapshot: its token gate is different from the
      // explicit publish gate. A config push must not leak a draft scorecard.
      const viewer = await this.broadcasts.publicSnapshot(sessionId);
      if (viewer) this.server.to(this.viewerRoom(sessionId)).emit(event, viewer);
      else this.revokeViewers(sessionId);
    } catch (error) {
      this.logger.warn(`broadcast push failed: ${String(error)}`);
    }
  }

  private async leaveAll(client: Socket) {
    for (const room of client.rooms) {
      if (room.startsWith('overlay:') || room.startsWith('viewer:')) await client.leave(room);
    }
  }

  private overlayRoom(sessionId: string) {
    return `overlay:${sessionId}`;
  }

  private viewerRoom(sessionId: string) {
    return `viewer:${sessionId}`;
  }
}
