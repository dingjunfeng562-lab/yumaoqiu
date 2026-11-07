import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RegistrationGroupsService } from './registration-groups.service';
import { SaveRegistrationGroupDto, SetGroupCodeEnabledDto } from './registration-groups.dto';

@Controller('admin/competitions/:competitionId/groups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ROOT)
export class RegistrationGroupsController {
  constructor(private groups: RegistrationGroupsService) {}
  @Get() list(@Param('competitionId') id: string) { return this.groups.list(id); }
  @Post() create(@Param('competitionId') id: string, @Body() dto: SaveRegistrationGroupDto) { return this.groups.save(id, dto); }
  @Patch(':groupId') update(@Param('competitionId') id: string, @Param('groupId') groupId: string, @Body() dto: SaveRegistrationGroupDto) { return this.groups.save(id, dto, groupId); }
  @Delete(':groupId') remove(@Param('competitionId') id: string, @Param('groupId') groupId: string) { return this.groups.remove(id, groupId); }
  @Post(':groupId/regenerate-code') regenerate(@Param('competitionId') id: string, @Param('groupId') groupId: string) { return this.groups.regenerate(id, groupId); }
  @Patch(':groupId/registration-code') setCodeEnabled(@Param('competitionId') id: string, @Param('groupId') groupId: string, @Body() dto: SetGroupCodeEnabledDto) { return this.groups.setCodeEnabled(id, groupId, dto.enabled); }
}
