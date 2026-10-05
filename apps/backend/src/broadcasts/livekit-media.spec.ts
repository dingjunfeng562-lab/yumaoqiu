import { JwtService } from '@nestjs/jwt';
import { LivekitMediaService } from './livekit-media.service';

describe('LiveKit credentials', () => {
  const original = { ...process.env };
  beforeEach(() => { process.env.LIVEKIT_URL = 'ws://localhost:7880'; process.env.LIVEKIT_API_KEY = 'testkey'; process.env.LIVEKIT_API_SECRET = 'unit-test-secret'; process.env.NODE_ENV = 'test'; });
  afterAll(() => { process.env = original; });
  const claims = (role: 'camera' | 'viewer' | 'director', audio = false) => {
    const result = new LivekitMediaService().token('room-one', `${role}_one`, role, audio);
    return new JwtService().verify(result.token, { secret: 'unit-test-secret', algorithms: ['HS256'] });
  };
  it('binds credentials to a single room and short lifetime', () => {
    const token = claims('camera');
    expect(token.video.room).toBe('room-one');
    expect(token.exp - token.iat).toBe(300);
    expect(token.video.roomAdmin).toBeUndefined();
    expect(token.video.canUpdateOwnMetadata).toBe(false);
  });
  it('permits microphone publication only on the selected master camera', () => {
    expect(claims('camera').video.canPublishSources).toEqual(['camera']);
    expect(claims('camera', true).video.canPublishSources).toEqual(['camera', 'microphone']);
    expect(claims('camera').video.canSubscribe).toBe(false);
  });
  it('viewers and directors cannot publish media or control data', () => {
    for (const role of ['viewer', 'director'] as const) {
      const token = claims(role);
      expect(token.video.canPublish).toBe(false);
      expect(token.video.canPublishData).toBe(false);
      expect(token.video.roomAdmin).toBeUndefined();
    }
  });
  it('refuses an insecure production media endpoint', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new LivekitMediaService().token('room', 'camera', 'camera')).toThrow('WSS');
  });
});
