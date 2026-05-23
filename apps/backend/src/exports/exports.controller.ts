import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ExportsService } from './exports.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('exports')
export class ExportsController {
  constructor(private exportsService: ExportsService) {}

  @Get('tournaments/:id/:kind')
  async download(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Res() res: Response,
  ) {
    const file = await this.exportsService.exportTournament(id, kind);
    const encodedFilename = encodeURIComponent(file.filename);

    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    res.send(Buffer.from(file.content, 'utf8'));
  }
}
