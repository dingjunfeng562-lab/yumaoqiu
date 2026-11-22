import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { PhotoManagementTargetType, Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PhotoManagementAccessService } from './photo-management-access.service';
import type { PhotoManagementDecision } from './photo-management-access.service';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

type AuthenticatedRequest = { user: { id: string; username: string; role: Role } };

class PhotoManagementTargetDto {
  @IsEnum(PhotoManagementTargetType)
  targetType: PhotoManagementTargetType;

  @IsString()
  @Length(1, 191)
  targetId: string;
}

class ApplyForPhotoManagementDto extends PhotoManagementTargetDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 500)
  purpose: string;
}

class DecidePhotoManagementDto {
  @IsIn(['approve', 'reject', 'revoke'])
  decision: PhotoManagementDecision;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@Controller(['auth/photo-management-access', 'v1/auth/photo-management-access'])
@UseGuards(JwtAuthGuard, RolesGuard)
export class PhotoManagementAccessController {
  constructor(private readonly access: PhotoManagementAccessService) {}

  @Get()
  @Roles(Role.ADMIN)
  listMine(@Req() req: AuthenticatedRequest) {
    return this.access.listMine(req.user);
  }

  @Post()
  @Roles(Role.ADMIN)
  submit(@Req() req: AuthenticatedRequest, @Body() dto: ApplyForPhotoManagementDto) {
    const { targetType, targetId, purpose } = dto;
    return this.access.submit(req.user, { targetType, targetId }, purpose);
  }

  @Get('requests')
  @Roles(Role.ROOT)
  listRequests() {
    return this.access.listRequests();
  }

  @Patch('requests/:id')
  @Roles(Role.ROOT)
  decide(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Body() dto: DecidePhotoManagementDto) {
    return this.access.decide(id, dto.decision, dto.reason, req.user);
  }
}
