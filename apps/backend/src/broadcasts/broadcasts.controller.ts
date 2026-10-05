import { Body, Controller, Delete, Get, Header, Headers, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BroadcastsService } from './broadcasts.service';
import { CameraHeartbeatDto, CreateBroadcastDto, UpdateBroadcastDto } from './dto/broadcast.dto';

type RequestWithUser = { user: { id: string; role: Role } };

/**
 * Broadcast management. ROOT only: requiredPermissions() returns an empty set
 * for this controller, so RolesGuard rejects every non-ROOT account.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ROOT)
@Controller('broadcasts')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get()
  list(@Query('tournamentId') tournamentId?: string) {
    return this.broadcasts.list(tournamentId || undefined);
  }

  @Post()
  create(@Body() dto: CreateBroadcastDto, @Req() req: RequestWithUser) {
    return this.broadcasts.create(dto, req.user.id);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.broadcasts.detail(id);
  }

  @Get(':id/preview')
  @Header('Cache-Control', 'no-store')
  preview(@Param('id') id: string) {
    return this.broadcasts.preview(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBroadcastDto) {
    return this.broadcasts.update(id, dto);
  }

  @Post(':id/rotate-overlay-token')
  rotateOverlayToken(@Param('id') id: string) {
    return this.broadcasts.rotateToken(id);
  }

  /** Issues the camera app pairing token; returned once, stored hashed. */
  @Post(':id/pair-camera')
  pairCamera(@Param('id') id: string) {
    return this.broadcasts.pairCamera(id);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.broadcasts.publish(id);
  }

  @Post(':id/withdraw')
  withdraw(@Param('id') id: string) {
    return this.broadcasts.withdraw(id);
  }

  @Post(':id/unpair-camera')
  unpairCamera(@Param('id') id: string) {
    return this.broadcasts.unpairCamera(id);
  }

  @Post(':id/end')
  end(@Param('id') id: string) {
    return this.broadcasts.end(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.broadcasts.remove(id);
  }
}

/** OBS browser source: read-only, authorised by the overlay token only. */
@Controller('broadcast-overlays')
export class BroadcastOverlaysController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex')
  overlay(@Param('token') token: string) {
    return this.broadcasts.overlaySnapshot(token);
  }
}

/**
 * Camera app endpoints. Authorised by the pairing token alone: the app has no
 * account and no session, and the token is bound to one broadcast room.
 */
@Controller('camera')
export class CameraController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  private tokenOf(header?: string) {
    const value = header ?? '';
    return value.startsWith('Bearer ') ? value.slice(7).trim() : value.trim();
  }

  @Get('config')
  @Header('Cache-Control', 'no-store')
  config(@Headers('authorization') header?: string) {
    return this.broadcasts.cameraConfig(this.tokenOf(header));
  }

  @Post('heartbeat')
  heartbeat(@Body() dto: CameraHeartbeatDto, @Headers('authorization') header?: string) {
    return this.broadcasts.cameraHeartbeat(this.tokenOf(header), dto);
  }

  @Post('unpair')
  unpair(@Headers('authorization') header?: string) {
    return this.broadcasts.cameraUnpairSelf(this.tokenOf(header));
  }
}

/** Website viewers: only enabled, public broadcasts of published tournaments. */@Controller('public/broadcasts')
export class PublicBroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query('tournamentId') tournamentId?: string) {
    return this.broadcasts.listPublic(tournamentId || undefined);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(@Param('id') id: string) {
    return this.broadcasts.getPublic(id);
  }

  /** Scorecard for the viewer page overlay. No address or token fields. */
  @Get(':id/score')
  @Header('Cache-Control', 'no-store')
  async score(@Param('id') id: string) {
    const snapshot = await this.broadcasts.publicSnapshot(id);
    if (!snapshot) throw new NotFoundException('直播间不存在或未公开');
    return snapshot;
  }
}
