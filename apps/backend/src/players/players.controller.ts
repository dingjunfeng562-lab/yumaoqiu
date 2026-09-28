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
import { PlayersService } from './players.service';
import { CreatePlayerDto, UpdatePlayerDto } from './dto/player.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { AuthActor } from '../auth/admin-scope';

// 类级权限由 RolesGuard 的功能权限和归属范围共同控制。
// 写操作单独标 @Roles(Role.ADMIN) —— 降权后的超级管理员对选手只读。
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ROOT)
@Controller('players')
export class PlayersController {
  constructor(private playersService: PlayersService) {}

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreatePlayerDto, @Req() req: { user: AuthActor }) {
    return this.playersService.create(dto, req.user);
  }

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('includeTemporary') includeTemporary?: string,
    @Req() req?: { user: AuthActor },
  ) {
    return this.playersService.findAll(
      search,
      includeTemporary === 'true' || includeTemporary === '1',
      req?.user,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.playersService.findOne(id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePlayerDto) {
    return this.playersService.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.playersService.remove(id);
  }
}
