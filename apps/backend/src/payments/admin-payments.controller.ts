import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { AdminCompetitionPlayerDto } from '../competitions/dto/competition-registration.dto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  DeletePaymentEntriesDto,
  UpdateEditDeadlineDto,
  UpdatePaymentSettingDto,
  UpdatePaymentStatusDto,
  UpdatePaymentTeamDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

type AuthedRequest = { user: { id: string; username?: string | null; role: Role } };

// 路由都带 :competitionId，RolesGuard 据此校验管理员只能操作自己的赛事；
// 批量修改的 entries[].registrationId / teamId 也会被逐个校验归属。
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ROOT)
@Controller('admin/competitions/:competitionId/payments')
export class AdminPaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Get()
  overview(@Param('competitionId') competitionId: string) {
    return this.paymentsService.overview(competitionId);
  }

  @Get('settings')
  getSettings(@Param('competitionId') competitionId: string) {
    return this.paymentsService.getSettings(competitionId);
  }

  @Put('settings/:entrantType')
  updateSetting(
    @Param('competitionId') competitionId: string,
    @Param('entrantType') entrantType: string,
    @Body() dto: UpdatePaymentSettingDto,
  ) {
    return this.paymentsService.updateSetting(competitionId, entrantType, dto);
  }

  @Post('settings/:entrantType/qr')
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (_req: unknown, file: any, cb: (error: Error | null, acceptFile: boolean) => void) => {
        cb(null, /^image\/(png|jpe?g|webp)$/.test(file.mimetype));
      },
      limits: { fileSize: 4 * 1024 * 1024 },
    }),
  )
  async uploadQr(
    @Param('competitionId') competitionId: string,
    @Param('entrantType') entrantType: string,
    @UploadedFile() file: any,
  ) {
    if (!file?.buffer) throw new BadRequestException('请上传 PNG、JPG 或 WebP 格式的收款码图片');
    const dir = join(process.cwd(), 'uploads', 'payment-qr');
    mkdirSync(dir, { recursive: true });
    // 收款码要保证能扫，输出无损 PNG，只限制最大宽度。
    const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
    await sharp(file.buffer)
      .rotate()
      .resize({ width: 900, withoutEnlargement: true })
      .png()
      .toFile(join(dir, filename));
    return this.paymentsService.setQrImage(competitionId, entrantType, `/api/uploads/payment-qr/${filename}`);
  }

  @Delete('settings/:entrantType/qr')
  removeQr(@Param('competitionId') competitionId: string, @Param('entrantType') entrantType: string) {
    return this.paymentsService.setQrImage(competitionId, entrantType, null);
  }

  @Patch()
  updateStatus(
    @Param('competitionId') competitionId: string,
    @Body() dto: UpdatePaymentStatusDto,
    @Req() req: AuthedRequest,
  ) {
    return this.paymentsService.updateStatus(competitionId, dto, req.user);
  }

  @Get('logs')
  logs(@Param('competitionId') competitionId: string) {
    return this.paymentsService.logs(competitionId);
  }

  /** 删除缴费行：单项删除报名、团体赛删除队伍（真删除）。entries[].registrationId / teamId 会被逐个校验归属。 */
  @Post('delete')
  deleteEntries(
    @Param('competitionId') competitionId: string,
    @Body() dto: DeletePaymentEntriesDto,
    @Req() req: AuthedRequest,
  ) {
    return this.paymentsService.deleteEntries(competitionId, dto, req.user);
  }

  @Put('edit-deadline')
  setEditDeadline(
    @Param('competitionId') competitionId: string,
    @Body() dto: UpdateEditDeadlineDto,
    @Req() req: AuthedRequest,
  ) {
    return this.paymentsService.setEditDeadline(competitionId, dto, req.user);
  }

  @Get('registrations/:registrationId')
  getRegistration(
    @Param('competitionId') competitionId: string,
    @Param('registrationId') registrationId: string,
  ) {
    return this.paymentsService.getRegistration(competitionId, registrationId);
  }

  @Patch('registrations/:registrationId')
  updateRegistration(
    @Param('competitionId') competitionId: string,
    @Param('registrationId') registrationId: string,
    @Body() dto: AdminCompetitionPlayerDto,
    @Req() req: AuthedRequest,
  ) {
    return this.paymentsService.updateRegistration(competitionId, registrationId, dto, req.user);
  }

  @Patch('teams/:teamId')
  updateTeam(
    @Param('competitionId') competitionId: string,
    @Param('teamId') teamId: string,
    @Body() dto: UpdatePaymentTeamDto,
    @Req() req: AuthedRequest,
  ) {
    return this.paymentsService.updateTeam(competitionId, teamId, dto, req.user);
  }
}
