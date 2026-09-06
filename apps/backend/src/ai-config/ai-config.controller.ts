import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AiConfigService } from './ai-config.service';
import { UpdateAiConfigDto } from './dto/ai-config.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('admin/ai-config')
export class AiConfigController {
  constructor(private readonly aiConfigService: AiConfigService) {}

  @Get()
  async getConfig() {
    return this.aiConfigService.getConfig();
  }

  @Patch()
  async updateConfig(@Body() dto: UpdateAiConfigDto) {
    return this.aiConfigService.updateConfig(dto);
  }

  @Post('test')
  async testConnection(@Body() dto?: UpdateAiConfigDto) {
    return this.aiConfigService.testConnection(dto);
  }

  @Post('models')
  async fetchModels(@Body() dto?: UpdateAiConfigDto) {
    return this.aiConfigService.fetchModels(dto);
  }
}
