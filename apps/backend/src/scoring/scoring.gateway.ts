import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
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
    this.server.to(this.matchRoom(matchId)).emit('match:update', state);
    this.server.emit('scoreboard:update', state);
  }

  // Broadcast that the bracket has changed (winner advanced, slot cleared, or
  // a forfeit propagated). Public bracket / live screen / home page listen on
  // the same `/scores` namespace and refetch the affected tournament/event
  // instead of polling.
  emitBracketUpdate(payload: { tournamentId?: string | null; eventId?: string | null; matchId?: string | null }) {
    if (!payload.tournamentId && !payload.eventId && !payload.matchId) return;
    this.server.emit('bracket:update', {
      tournamentId: payload.tournamentId ?? null,
      eventId: payload.eventId ?? null,
      matchId: payload.matchId ?? null,
      at: new Date().toISOString(),
    });
  }

  private matchRoom(matchId: string) {
    return `match:${matchId}`;
  }
}
