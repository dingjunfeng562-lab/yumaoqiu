import { createHmac, timingSafeEqual } from 'node:crypto';
import { cameraServerUrls } from './camera-server-urls';

/** MediaMTX runs alongside the API. Only RTMP ingest is exposed to phones. */
export function mediaConfig() {
  const configuredHost = process.env.MEDIA_INGEST_HOST?.trim();
  const host = configuredHost || (() => {
    const first = cameraServerUrls()[0];
    return first ? new URL(first).hostname : '';
  })();
  const port = Number(process.env.MEDIA_RTMP_PORT || 1935);
  const origin = process.env.MEDIA_HLS_ORIGIN || 'http://127.0.0.1:8888';
  if (!host || !/^[\w.:-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  // Never let an environment typo turn the backend into a general-purpose SSRF proxy.
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return null;
  return { host, port, origin };
}

/**
 * Private preview ticket lifetime. Every playlist and segment URL the player
 * reuses carries the ticket, so it must outlive a normal preview check; a
 * short ticket froze the picture once it expired mid-playback.
 */
export const PREVIEW_TICKET_MS = 30 * 60_000;
/** Tickets further in the future than this were not issued by us. */
const MAX_TICKET_AHEAD_MS = PREVIEW_TICKET_MS + 5 * 60_000;

export function mediaTicket(room: string, expires: number): string {
  const body = `${room}.${expires}`;
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required for media preview');
  return `${body}.${createHmac('sha256', secret).update(`media-preview:${body}`).digest('base64url')}`;
}

export function validMediaTicket(room: string, ticket: string): boolean {
  const match = /^([a-zA-Z0-9_-]+)\.(\d{10,13})\.([a-zA-Z0-9_-]{43})$/.exec(ticket || '');
  if (!match || match[1] !== room || Number(match[2]) < Date.now() || Number(match[2]) > Date.now() + MAX_TICKET_AHEAD_MS) return false;
  const expected = mediaTicket(room, Number(match[2]));
  return timingSafeEqual(Buffer.from(expected), Buffer.from(ticket));
}

export function mediaAssetPath(asset: string): string | null {
  if (!asset || asset.length > 300 || !/^[a-zA-Z0-9_./-]+$/.test(asset) || asset.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return asset;
}

/**
 * MediaMTX >= 1.21 binds every HLS reader to a session and appends
 * `?session=<id>` to each playlist/segment URI; requests without it get
 * `401 session not found`. Only that one parameter is passed through, and only
 * in the shape MediaMTX generates, so the proxy still cannot be steered.
 */
const MEDIA_SESSION = /^[a-zA-Z0-9-]{8,64}$/;

export function mediaSessionQuery(session: unknown): string {
  return typeof session === 'string' && MEDIA_SESSION.test(session) ? `?session=${session}` : '';
}

export function rewritePlaylist(text: string, urlFor: (asset: string) => string): string {
  const rewrite = (uri: string) => {
    const mark = uri.indexOf('?');
    const name = mark === -1 ? uri : uri.slice(0, mark);
    if (!mediaAssetPath(name)) return uri;
    const session = mark === -1 ? null : new URLSearchParams(uri.slice(mark + 1)).get('session');
    return urlFor(name) + mediaSessionQuery(session);
  };
  return text.split('\n').map((line) => {
    if (!line.startsWith('#') && line.trim()) return rewrite(line.trim());
    return line.replace(/URI="([^"]+)"/g, (_whole, uri: string) => `URI="${rewrite(uri)}"`);
  }).join('\n');
}
