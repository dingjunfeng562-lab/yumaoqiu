import { mediaSessionQuery, mediaTicket, rewritePlaylist, validMediaTicket, PREVIEW_TICKET_MS } from './media-config';

const SESSION = '63e0a2f9-0507-45f9-8534-cc11264085e0';
const urlFor = (name: string) => `/api/broadcasts/b1/media/T/${name}`;

describe('rewritePlaylist (MediaMTX 1.21 HLS sessions)', () => {
  it('keeps the session on variant, init and segment URIs', () => {
    const multivariant = [
      '#EXTM3U',
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio2_stream.m3u8?session=${SESSION}"`,
      '#EXT-X-STREAM-INF:BANDWIDTH=5674376,RESOLUTION=1920x1080,AUDIO="audio"',
      `video1_stream.m3u8?session=${SESSION}`,
    ].join('\n');
    const out = rewritePlaylist(multivariant, urlFor);
    expect(out).toContain(`URI="/api/broadcasts/b1/media/T/audio2_stream.m3u8?session=${SESSION}"`);
    expect(out).toContain(`/api/broadcasts/b1/media/T/video1_stream.m3u8?session=${SESSION}`);

    const media = [
      `#EXT-X-MAP:URI="abc_video1_init.mp4?session=${SESSION}"`,
      '#EXTINF:2.00000,',
      `abc_video1_seg136.mp4?session=${SESSION}`,
    ].join('\n');
    const rewritten = rewritePlaylist(media, urlFor);
    expect(rewritten).toContain(`URI="/api/broadcasts/b1/media/T/abc_video1_init.mp4?session=${SESSION}"`);
    expect(rewritten).toContain(`/api/broadcasts/b1/media/T/abc_video1_seg136.mp4?session=${SESSION}`);
  });

  it('still rewrites plain URIs from older MediaMTX versions', () => {
    expect(rewritePlaylist('seg1.mp4', urlFor)).toBe('/api/broadcasts/b1/media/T/seg1.mp4');
  });

  it('drops any query parameter other than a well-formed session', () => {
    expect(rewritePlaylist('seg1.mp4?session=x&evil=1', urlFor)).toBe('/api/broadcasts/b1/media/T/seg1.mp4');
    expect(rewritePlaylist('seg1.mp4?other=1', urlFor)).toBe('/api/broadcasts/b1/media/T/seg1.mp4');
  });

  it('leaves unsafe paths untouched instead of proxying them', () => {
    expect(rewritePlaylist('../secret.m3u8?session=abcdefgh', urlFor)).toBe('../secret.m3u8?session=abcdefgh');
  });
});

describe('mediaSessionQuery', () => {
  it('accepts MediaMTX session ids only', () => {
    expect(mediaSessionQuery(SESSION)).toBe(`?session=${SESSION}`);
    expect(mediaSessionQuery('a/b')).toBe('');
    expect(mediaSessionQuery('x&y=1')).toBe('');
    expect(mediaSessionQuery(['a', 'b'])).toBe('');
    expect(mediaSessionQuery(undefined)).toBe('');
  });
});

describe('preview ticket', () => {
  const previous = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = 'test-secret'; });
  afterAll(() => { process.env.JWT_SECRET = previous; });

  it('stays valid for the whole preview lifetime', () => {
    const room = 'O6_3MmT8Z6uK4dO3Ncdh7iiL';
    expect(validMediaTicket(room, mediaTicket(room, Date.now() + PREVIEW_TICKET_MS))).toBe(true);
    expect(validMediaTicket(room, mediaTicket(room, Date.now() - 1000))).toBe(false);
    expect(validMediaTicket(room, mediaTicket(room, Date.now() + 24 * 3600_000))).toBe(false);
  });
});
