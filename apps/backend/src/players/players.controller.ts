import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlayersService } from './players.service';
import { CreatePlayerDto, UpdatePlayerDto } from './dto/player.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

// 类级:总管理员(SUPER_ADMIN)可读选手库;ROOT 全权(自动通过)。
// 写操作单独标 @Roles(Role.ADMIN) —— 降权后的总管理员对选手只读。
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('players')
export class PlayersController {
  constructor(private playersService: PlayersService) {}

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreatePlayerDto) {
    return this.playersService.create(dto);
  }

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('includeTemporary') includeTemporary?: string,
  ) {
    return this.playersService.findAll(
      search,
      includeTemporary === 'true' || includeTemporary === '1',
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
