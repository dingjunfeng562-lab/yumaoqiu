import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export type MediaParticipant = {
  identity: string;
  tracks?: { sid: string; type: 'AUDIO' | 'VIDEO' | number; source: 'CAMERA' | 'MICROPHONE' | number; muted?: boolean }[];
};

/** LiveKit's documented JSON/Twirp API. Credentials never leave the backend. */
@Injectable()
export class LivekitMediaService {
  private readonly jwt = new JwtService();

  configured() {
    return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
  }

  private config() {
    if (!this.configured()) throw new ServiceUnavailableException('请先配置 LiveKit 媒体服务');
    const url = new URL(process.env.LIVEKIT_URL!);
    if (!['wss:', 'ws:'].includes(url.protocol) || url.username || url.password) {
      throw new ServiceUnavailableException('LIVEKIT_URL 必须是 WebSocket 服务地址');
    }
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'wss:') {
      throw new ServiceUnavailableException('生产环境 LiveKit 必须使用 WSS');
    }
    return { url: url.toString().replace(/\/$/, ''), key: process.env.LIVEKIT_API_KEY!, secret: process.env.LIVEKIT_API_SECRET! };
  }

  token(room: string, identity: string, role: 'camera' | 'director' | 'viewer', audio = false) {
    const { url, key, secret } = this.config();
    const token = this.jwt.sign({
      video: {
        room, roomJoin: true, canPublish: role === 'camera', canSubscribe: role !== 'camera',
        canPublishData: false, canUpdateOwnMetadata: false,
        ...(role === 'camera' ? { canPublishSources: audio ? ['camera', 'microphone'] : ['camera'] } : {}),
      },
      metadata: JSON.stringify({ role }),
    }, { secret, algorithm: 'HS256', issuer: key, subject: identity, expiresIn: '5m' });
    return { url, token, identity, room, expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }

  async call<T = unknown>(method: string, room: string, body: Record<string, unknown> = {}): Promise<T> {
    const { url, key, secret } = this.config();
    const token = this.jwt.sign({ video: { room, roomAdmin: true, roomCreate: true, roomList: true } }, {
      secret, algorithm: 'HS256', issuer: key, expiresIn: '60s',
    });
    const origin = (process.env.LIVEKIT_INTERNAL_URL || url.replace(/^ws/, 'http')).replace(/\/$/, '');
    let response: Response;
    try {
      response = await fetch(`${origin}/twirp/livekit.RoomService/${method}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, ...body }), signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ServiceUnavailableException('LiveKit 服务连接失败，请检查媒体服务器');
    }
    // Never include upstream response text: it can contain media credentials.
    if (method === 'DeleteRoom' && response.status === 404) return {} as T;
    if (!response.ok) throw new ServiceUnavailableException(`LiveKit ${method} 失败 (${response.status})`);
    return response.json() as Promise<T>;
  }

  async participants(room: string) {
    return (await this.call<{ participants?: MediaParticipant[] }>('ListParticipants', room)).participants ?? [];
  }

  async rooms() {
    return (await this.call<{ rooms?: { name: string }[] }>('ListRooms', '')).rooms ?? [];
  }

  async assertVideo(room: string, cameraId: string) {
    const participant = (await this.participants(room)).find((p) => p.identity === `camera_${cameraId}`);
    return Boolean(participant?.tracks?.some((t) => (t.source === 'CAMERA' || t.source === 1) && !t.muted));
  }
}
