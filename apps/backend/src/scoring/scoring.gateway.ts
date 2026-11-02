import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Subject } from 'rxjs';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: 'scores',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ScoringGateway {
  @WebSocketServer()
  server!: Server;

  // In-process notification that a match changed after a successful scoring
  // write. Broadcast overlays subscribe here instead of importing
  // ScoringService internals, which keeps the dependency one-directional.
  readonly matchChanges = new Subject<string>();

  // Fires synchronously right BEFORE every scoreboard/bracket broadcast, so
  // public read caches (e.g. /api/public/brackets) are invalidated before any
  // client receives the event and refetches. Order matters: emitting first
  // would let a refetch be answered from the pre-write cache.
  readonly publicDataChanges = new Subject<void>();

  @SubscribeMessage('joinMatch')
  joinMatch(@ConnectedSocket() client: Socket, @MessageBody() body: { matchId?: string }) {
    if (!body?.matchId) return { ok: false, message: 'matchId required' };
    client.join(this.matchRoom(body.matchId));
    return { ok: true, matchId: body.matchId };
  }

  @SubscribeMessage('leaveMatch')
  leaveMatch(@ConnectedSocket() client: Socket, @MessageBody() body: { matchId?: string }) {
    if (!body?.matchId) return { ok: false, message: 'matchId required' };
    client.leave(this.matchRoom(body.matchId));
    return { ok: true, matchId: body.matchId };
  }

  emitMatchState(matchId: string, state: unknown) {
    this.publicDataChanges.next();
    this.server.to(this.matchRoom(matchId)).emit('match:update', state);
    this.server.emit('scoreboard:update', state);
    this.matchChanges.next(matchId);
  }

  // Broadcast that the bracket has changed (winner advanced, slot cleared, or
  // a forfeit propagated). Public bracket / live screen / home page listen on
  // the same `/scores` namespace and refetch the affected tournament/event
  // instead of polling.
  emitBracketUpdate(payload: { tournamentId?: string | null; eventId?: string | null; matchId?: string | null }) {
    // Invalidate even when nothing is broadcast: the caller still changed data.
    this.publicDataChanges.next();
    if (!payload.tournamentId && !payload.eventId && !payload.matchId) return;
    if (payload.matchId) this.matchChanges.next(payload.matchId);
    this.server.emit('bracket:update', {
      tournamentId: payload.tournamentId ?? null,
      eventId: payload.eventId ?? null,
      matchId: payload.matchId ?? null,
      at: new Date().toISOString(),
    });
  }

  // Lean per-match update for the PUBLIC bracket / live-screen pages: carries
  // the one match exactly as it appears inside /api/public/brackets, so those
  // pages patch it in place instead of refetching every bracket on every
  // point. `match: null` means "can't patch this one, refetch the
  // tournament". scoreboard:update / bracket:update are unchanged; the admin
  // tournament screen keeps using them.
  emitPublicBracketMatch(payload: {
    tournamentId: string;
    bracketId: string;
    matchId: string;
    match: unknown;
  }) {
    this.server.emit('bracket:match', { ...payload, at: new Date().toISOString() });
  }

  private matchRoom(matchId: string) {
    return `match:${matchId}`;
  }
}
