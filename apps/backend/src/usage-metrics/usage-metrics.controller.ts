import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsageMetricsService } from './usage-metrics.service';

@Controller('usage-metrics')
export class UsageMetricsController {
  constructor(private readonly usageMetricsService: UsageMetricsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('hawkeye')
  async trackHawkeye() {
    await this.usageMetricsService.trackHawkeye();
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('summary')
  getSummary() {
    return this.usageMetricsService.getSummary();
  }
}
