import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { EmailService } from './email.service';
import {
  SendTestMailDto,
  UpdateEventEmailSettingsDto,
  UpdateGlobalSettingsDto,
  UpdateTemplateDto,
} from './dto/email.dto';

/**
 * 邮件通知系统管理接口。
 * 仅总管理员（SUPER_ADMIN）可访问，普通管理员/其他角色一律 403。
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('admin/email')
export class AdminEmailController {
  constructor(private emailService: EmailService) {}

  // ---------- 基础设置 ----------

  @Get('settings')
  getSettings() {
    return this.emailService.getGlobalSettings();
  }

  @Put('settings')
  updateSettings(@Body() dto: UpdateGlobalSettingsDto) {
    return this.emailService.updateGlobalSettings(dto.enabled);
  }

  @Post('test')
  sendTest(@Body() dto: SendTestMailDto) {
    return this.emailService.sendTest(dto.to, dto.subject, dto.content);
  }

  // ---------- 模板管理 ----------

  @Get('templates')
  listTemplates() {
    return this.emailService.listTemplates();
  }

  @Put('templates/:key')
  updateTemplate(@Param('key') key: string, @Body() dto: UpdateTemplateDto) {
    return this.emailService.updateTemplate(key, dto);
  }

  @Post('templates/:key/reset')
  resetTemplate(@Param('key') key: string) {
    return this.emailService.resetTemplate(key);
  }

  @Get('templates/:key/preview')
  previewTemplate(@Param('key') key: string) {
    return this.emailService.previewTemplate(key);
  }

  // ---------- 赛事邮件开关 ----------

  @Get('events/settings')
  listEventSettings() {
    return this.emailService.listEventSettings();
  }

  @Get('events/:eventId/settings')
  getEventSettings(@Param('eventId') eventId: string) {
    return this.emailService.getEventSettings(eventId);
  }

  @Put('events/:eventId/settings')
  updateEventSettings(
    @Param('eventId') eventId: string,
    @Body() dto: UpdateEventEmailSettingsDto,
  ) {
    return this.emailService.updateEventSettings(eventId, dto);
  }

  @Post('events/:eventId/reminder/send-now')
  sendReminderNow(@Param('eventId') eventId: string) {
    return this.emailService.sendReminderForTournament(eventId, 'manual');
  }

  @Get('events/:eventId/logs')
  listEventLogs(
    @Param('eventId') eventId: string,
    @Query('status') status?: string,
    @Query('templateKey') templateKey?: string,
  ) {
    return this.emailService.listLogs({ tournamentId: eventId, status, templateKey });
  }

  // ---------- 发送日志 ----------

  @Get('logs')
  listLogs(
    @Query('eventId') eventId?: string,
    @Query('status') status?: string,
    @Query('templateKey') templateKey?: string,
  ) {
    return this.emailService.listLogs({ tournamentId: eventId, status, templateKey });
  }
}
