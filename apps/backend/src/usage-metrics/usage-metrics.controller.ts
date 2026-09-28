import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsageMetricsService } from './usage-metrics.service';

@Controller('usage-metrics')
export class UsageMetricsController {
  constructor(private readonly usageMetricsService: UsageMetricsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ROOT)
  @Get('summary')
  getSummary() {
    return this.usageMetricsService.getSummary();
  }
}
