import { Body, Controller, Delete, Get, Header, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MulticameraService } from './multicamera.service';
import { EnableMulticameraDto, GrantDirectorDto, LiveCommandDto, LiveHeartbeatDto, RedeemCameraDto, SelectCameraDto, SharedCameraCodeDto } from './dto/multicamera.dto';

type AuthRequest = { user: { id: string; role: Role } };

/** Every method checks ROOT or a room-specific director grant inside the service. */
@UseGuards(JwtAuthGuard)
@Controller('broadcasts/:id/live')
export class MulticameraController {
  constructor(private readonly live: MulticameraService) {}
  @Get() @Header('Cache-Control', 'no-store')
  detail(@Param('id') id: string, @Req() req: AuthRequest) { return this.live.snapshot(id, req.user); }
  @Post('enable')
  enable(@Param('id') id: string, @Body() dto: EnableMulticameraDto, @Req() req: AuthRequest) { return this.live.enable(id, dto.cameraCount, req.user); }
  @Post('cameras/:cameraId/pair')
  pair(@Param('id') id: string, @Param('cameraId') cameraId: string, @Req() req: AuthRequest) { return this.live.pair(id, cameraId, req.user); }
  @Delete('cameras/:cameraId/pair')
  unpair(@Param('id') id: string, @Param('cameraId') cameraId: string, @Req() req: AuthRequest) { return this.live.unpair(id, cameraId, req.user); }
  @Post('join-code') @Header('Cache-Control', 'no-store')
  joinCode(@Param('id') id: string, @Body() dto: SharedCameraCodeDto, @Req() req: AuthRequest) { return this.live.sharedCode(id, req.user, dto.rotate ?? false); }
  @Delete('join-code')
  revokeCode(@Param('id') id: string, @Req() req: AuthRequest) { return this.live.revokeSharedCode(id, req.user); }
  @Post('director-token') @Header('Cache-Control', 'no-store')
  token(@Param('id') id: string, @Req() req: AuthRequest) { return this.live.directorToken(id, req.user); }
  @Post('preview')
  preview(@Param('id') id: string, @Body() dto: SelectCameraDto, @Req() req: AuthRequest) { return this.live.preview(id, dto.cameraId, dto.sequence, req.user); }
  @Post('take')
  take(@Param('id') id: string, @Body() dto: LiveCommandDto, @Req() req: AuthRequest) { return this.live.take(id, dto.sequence, req.user); }
  @Post('audio')
  audio(@Param('id') id: string, @Body() dto: SelectCameraDto, @Req() req: AuthRequest) { return this.live.audio(id, dto.cameraId, dto.sequence, req.user); }
  @Post('start')
  start(@Param('id') id: string, @Body() dto: LiveCommandDto, @Req() req: AuthRequest) { return this.live.start(id, dto.sequence, req.user); }
  @Post('pause')
  pause(@Param('id') id: string, @Body() dto: LiveCommandDto, @Req() req: AuthRequest) { return this.live.stop(id, dto.sequence, req.user, false); }
  @Post('end')
  end(@Param('id') id: string, @Body() dto: LiveCommandDto, @Req() req: AuthRequest) { return this.live.stop(id, dto.sequence, req.user, true); }
  @Post('directors')
  grant(@Param('id') id: string, @Body() dto: GrantDirectorDto, @Req() req: AuthRequest) { return this.live.grant(id, dto.userId, dto.canAudio, req.user); }
  @Delete('directors/:userId')
  revoke(@Param('id') id: string, @Param('userId') userId: string, @Req() req: AuthRequest) { return this.live.revokeDirector(id, userId, req.user); }
}

@Controller('live-camera')
export class LiveCameraController {
  constructor(private readonly live: MulticameraService) {}
  private bearer(header = '') { return header.startsWith('Bearer ') ? header.slice(7).trim() : ''; }
  @Post('redeem') @Header('Cache-Control', 'no-store')
  redeem(@Body() dto: RedeemCameraDto) { return this.live.redeem(dto.code, dto.deviceId); }
  @Get('config') @Header('Cache-Control', 'no-store')
  config(@Headers('authorization') header?: string) { return this.live.cameraConfig(this.bearer(header)); }
  @Post('join') @Header('Cache-Control', 'no-store')
  join(@Headers('authorization') header?: string) { return this.live.cameraConfig(this.bearer(header), true); }
  @Post('heartbeat') @Header('Cache-Control', 'no-store')
  heartbeat(@Headers('authorization') header: string, @Body() dto: LiveHeartbeatDto) { return this.live.heartbeat(this.bearer(header), dto); }
}

@Controller('public/broadcasts/:id/live')
export class LiveViewerController {
  constructor(private readonly live: MulticameraService) {}
  @Post('token') @Header('Cache-Control', 'no-store')
  token(@Param('id') id: string) { return this.live.viewerToken(id); }
}
