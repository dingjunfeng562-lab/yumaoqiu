import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { EventsService } from './events.service';
import { CreateEventDto, DeleteEventDto, UpdateEventDto } from './dto/event.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { AuthActor } from '../auth/admin-scope';
import { ChangeActor } from '../common/registration-changes';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ROOT)
@Controller('events')
export class EventsController {
  constructor(private eventsService: EventsService) {}

  @Post()
  create(@Body() dto: CreateEventDto) {
    return this.eventsService.create(dto);
  }

  @Get()
  findByTournament(@Query('tournamentId') tournamentId: string, @Req() req: { user: AuthActor }) {
    return this.eventsService.findByTournament(tournamentId, req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.eventsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.eventsService.update(id, dto);
  }

  /** 删除前的影响预览：会删掉多少报名、报名表、选手档案、已缴费金额、比赛。 */
  @Get(':id/delete-preview')
  deletePreview(@Param('id') id: string) {
    return this.eventsService.deletePreview(id);
  }

  /** 删除单项并连带删除它的报名。用 POST 带删除原因（DELETE 的请求体可能被代理丢掉）。 */
  @Post(':id/delete')
  removeWithNote(@Param('id') id: string, @Body() dto: DeleteEventDto, @Req() req: { user: ChangeActor }) {
    return this.eventsService.remove(id, req.user, dto.note);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: { user: ChangeActor }) {
    return this.eventsService.remove(id, req.user);
  }
}
