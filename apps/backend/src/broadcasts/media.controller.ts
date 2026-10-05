import { Body, Controller, Get, Header, NotFoundException, Param, Post, Query, Res, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BroadcastsService } from './broadcasts.service';
import {
  PREVIEW_TICKET_MS, mediaAssetPath, mediaConfig, mediaSessionQuery, mediaTicket, rewritePlaylist, validMediaTicket,
} from './media-config';

/** MediaMTX calls this on every publish attempt. Bind MediaMTX to localhost for HLS. */
@Controller('media/auth')
export class MediaAuthController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Post()
  async authenticate(@Body() body: Record<string, unknown>) {
    if (body?.action === 'read' && body?.protocol === 'hls' &&
      (body?.ip === '127.0.0.1' || body?.ip === '::1')) return { ok: true };
    if (body?.action !== 'publish' || body?.protocol !== 'rtmp' || typeof body?.path !== 'string') {
      throw new UnauthorizedException();
    }
    const query = new URLSearchParams(String(body.query || '').replace(/^\?/, ''));
    // A publisher must have a live camera pairing AND its room's opaque path.
    const accepted = await this.broadcasts.authorizeMediaPublish(body.path, query.get('token') || String(body.token || ''));
    if (!accepted) throw new UnauthorizedException();
    return { ok: true };
  }
}

/** Only ROOT can obtain a short-lived preview ticket. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ROOT)
@Controller('broadcasts')
export class AdminMediaController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get(':id/media-preview')
  async preview(@Param('id') id: string) {
    const streamName = await this.broadcasts.mediaStream(id);
    if (!streamName) throw new ServiceUnavailableException('请先配对手机并启动本地媒体服务');
    const ticket = mediaTicket(streamName, Date.now() + PREVIEW_TICKET_MS);
    return { playbackUrl: `/api/broadcasts/${encodeURIComponent(id)}/media/${ticket}/index.m3u8`, expiresIn: PREVIEW_TICKET_MS / 1000 };
  }
}

/** Serves playlists AND segments through one gate; never returns the raw HLS origin. */
@Controller()
export class MediaAssetsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get('broadcasts/:id/media/:ticket/*asset')
  @Header('Access-Control-Allow-Origin', '*')
  async previewAsset(
    @Param('id') id: string, @Param('ticket') ticket: string, @Param('asset') asset: string | string[],
    @Query('session') session: unknown, @Res() res: Response,
  ) {
    const streamName = await this.broadcasts.mediaStream(id);
    if (!streamName || !validMediaTicket(streamName, ticket)) throw new NotFoundException();
    return this.serve(streamName, Array.isArray(asset) ? asset.join('/') : asset, session, res,
      (name) => `/api/broadcasts/${encodeURIComponent(id)}/media/${ticket}/${name}`);
  }

  @Get('public/broadcasts/:id/media/*asset')
  @Header('Access-Control-Allow-Origin', '*')
  async publicAsset(
    @Param('id') id: string, @Param('asset') asset: string | string[],
    @Query('session') session: unknown, @Res() res: Response,
  ) {
    const streamName = await this.broadcasts.publicMediaStream(id);
    if (!streamName) throw new NotFoundException();
    return this.serve(streamName, Array.isArray(asset) ? asset.join('/') : asset, session, res,
      (name) => `/api/public/broadcasts/${encodeURIComponent(id)}/media/${name}`);
  }

  private async serve(streamName: string, asset: string, session: unknown, res: Response, urlFor: (name: string) => string) {
    const name = mediaAssetPath(asset);
    const media = mediaConfig();
    if (!name || !media) throw new NotFoundException();
    const origin = `${media.origin}/${streamName}/${name}${mediaSessionQuery(session)}`;
    const response = await fetch(origin, { signal: AbortSignal.timeout(7000), cache: 'no-store' }).catch(() => null);
    if (!response?.ok) throw new NotFoundException('媒体流未就绪');
    const size = Number(response.headers.get('content-length') ?? 0);
    if (size > 16_000_000) { await response.body?.cancel(); throw new ServiceUnavailableException('媒体片段过大'); }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 16_000_000) throw new ServiceUnavailableException('媒体片段过大');
    const playlist = name.endsWith('.m3u8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', playlist ? 'application/vnd.apple.mpegurl' : response.headers.get('content-type') || 'video/mp4');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(playlist ? rewritePlaylist(bytes.toString('utf8'), urlFor) : bytes);
  }
}
