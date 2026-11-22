import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { AuthActor } from '../auth/admin-scope';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateRosterRecognitionDto } from './dto/roster-recognition.dto';
import { RosterRecognitionService, type RosterUploadFile } from './roster-recognition.service';

/**
 * 报名表识别的配置与试用。只允许超级管理员（ROOT）访问：
 * 普通管理员在建队页可以使用识别入口，但看不到模型、提示词和渠道状态。
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ROOT)
@Controller('admin/roster-recognition')
export class RosterRecognitionController {
  constructor(private readonly recognition: RosterRecognitionService) {}

  @Get()
  getConfig() {
    return this.recognition.getConfig();
  }

  @Patch()
  updateConfig(@Body() dto: UpdateRosterRecognitionDto) {
    return this.recognition.updateConfig(dto);
  }

  /** 表单里可带 prompt：配置页正在编辑、还没保存的提示词（空字符串表示内置默认）。 */
  @Post('test')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  test(
    @UploadedFile() file: RosterUploadFile | undefined,
    @Body('prompt') prompt: unknown,
    @Req() req: { user: AuthActor },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('请上传一张报名表照片或 PDF');
    return this.recognition.test(file, {
      actorId: req.user.id,
      prompt: typeof prompt === 'string' ? prompt : undefined,
    });
  }
}
