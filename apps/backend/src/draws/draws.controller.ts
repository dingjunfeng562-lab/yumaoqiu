import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DrawsService } from './draws.service';
import {
  CreateRegistrationDto,
  FreezeDrawDto,
  GenerateDrawDto,
  GetDrawLogsQueryDto,
  PublishDrawDto,
  RedrawDrawDto,
  SwapDrawSlotsDto,
  UnfreezeDrawDto,
  UnpublishDrawDto,
  UpdateRegistrationDto,
  UpdateSeedsDto,
} from './dto/draw.dto';

type AuthRequest = {
  user?: {
    id?: string;
    username?: string;
  };
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller()
export class DrawsController {
  constructor(private drawsService: DrawsService) {}

  @Get('events/:eventId/registrations')
  listRegistrations(@Param('eventId') eventId: string) {
    return this.drawsService.listRegistrations(eventId);
  }

  @Post('events/:eventId/registrations')
  createRegistration(
    @Param('eventId') eventId: string,
    @Body() dto: CreateRegistrationDto,
  ) {
    return this.drawsService.createRegistration(eventId, dto);
  }

  @Patch('registrations/:id')
  updateRegistration(@Param('id') id: string, @Body() dto: UpdateRegistrationDto) {
    return this.drawsService.updateRegistration(id, dto);
  }

  @Delete('registrations/:id')
  removeRegistration(@Param('id') id: string) {
    return this.drawsService.removeRegistration(id);
  }

  @Put('events/:eventId/draw/seeds')
  updateSeeds(
    @Param('eventId') eventId: string,
    @Body() dto: UpdateSeedsDto,
    @Req() req: AuthRequest,
  ) {
    return this.drawsService.updateSeeds(
      eventId,
      dto.seeds,
      req.user?.id ?? '',
      req.user?.username ?? req.user?.id ?? null,
    );
  }

  @Get('events/:eventId/draw')
  getDrawDetail(@Param('eventId') eventId: string) {
    return this.drawsService.getDrawDetail(eventId);
  }

  @Post('events/:eventId/draw')
  generateDraw(
    @Param('eventId') eventId: string,
    @Body() dto: GenerateDrawDto,
    @Req() req: AuthRequest,
  ) {
    return this.drawsService.generateDraw(
      eventId,
      dto,
      req.user?.id ?? '',
      req.user?.username ?? req.user?.id ?? null,
    );
  }

  @Post('events/:eventId/draw/execute')
  executeDraw(@Param('eventId') eventId: string, @Req() req: AuthRequest) {
    return this.drawsService.executeDraw(
      eventId,
      req.user?.id ?? '',
      req.user?.username ?? req.user?.id ?? null,
    );
  }

  @Post('events/:eventId/draw/swap')
  swapDrawSlots(
    @Param('eventId') eventId: string,
    @Body() dto: SwapDrawSlotsDto,
    @Req() req: AuthRequest,
  ) {
    return this.drawsService.swapDrawSlots(
      eventId,
      dto.drawId,
      dto.positionA,
      dto.positionB,
      req.user?.id ?? '',
      req.user?.username ?? req.user?.id ?? null,
    );
  }

  @Post('events/:eventId/draw/freeze')
  freezeDraw(
    @Param('eventId') eventId: string,
    @Body() dto: FreezeDrawDto,
    @Req() req: AuthRequest,
  ) {
    return this.drawsService.freezeDraw(
      eventId,
      dto.drawId,
      req.user?.id ?? '',
      req.user?.username ?? req.user?.id ?? null,
    );
  }

  @Post('events/:eventId/draw/unfreeze')
  unfreezeDraw(
    @Param('eventId') eventId: string,
    @Body() dto: UnfreezeDrawDto,
    @Req() req: AuthRequest,
  ) {
    return this.drawsService.unfreezeDraw(
      eventId,
      dto.drawId,
      req.user?.id ?? '',
      req.user?.username ?? req.user?.id ?? null,
    );
  }

  @Post('events/:eventId/draw/publish')
  publishDraw(
    @Param('eventId') eventId: string,
    @Body() dto: PublishDrawDto,
    @Req() req: AuthRequest,
  ) {
    return this.drawsService.publishDraw(
      eventId,
      dto.drawId,
      req.user?.id ?? '',
      req.user?.username ?? req.user?.id ?? null,
    );
  }

  @Post('events/:eventId/draw/unpublish')
  unpublishDraw(
    @Param('eventId') eventId: string,
    @Body() dto: UnpublishDrawDto,
    @Req() req: AuthRequest,
  ) {
    return this.drawsService.unpublishDraw(
      eventId,
      dto.drawId,
      req.user?.id ?? '',
      req.user?.username ?? req.user?.id ?? null,
    );
  }

  @Post('events/:eventId/draw/redraw')
  redraw(
    @Param('eventId') eventId: string,
    @Body() dto: RedrawDrawDto,
    @Req() req: AuthRequest,
  ) {
    return this.drawsService.redraw(
      eventId,
      dto.confirm,
      req.user?.id ?? '',
      req.user?.username ?? req.user?.id ?? null,
    );
  }

  @Get('events/:eventId/draw/history')
  getDrawHistory(@Param('eventId') eventId: string) {
    return this.drawsService.getDrawHistory(eventId);
  }

  @Get('events/:eventId/draw/logs')
  getDrawLogs(@Param('eventId') eventId: string, @Query() query: GetDrawLogsQueryDto) {
    return this.drawsService.getDrawLogs(eventId, query);
  }

  @Get('events/:eventId/bracket')
  getBracket(@Param('eventId') eventId: string) {
    return this.drawsService.getBracket(eventId);
  }
}
