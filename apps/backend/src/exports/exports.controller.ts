import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
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
    this.sendFile(res, file);
  }

  @Get('events/:eventId/stage-order')
  async downloadEventStageOrder(
    @Param('eventId') eventId: string,
    @Query('stage') stage: string,
    @Res() res: Response,
  ) {
    const normalized = stage === 'first' ? 'first' : 'second';
    const file = await this.exportsService.exportEventStageOrder(eventId, normalized);
    this.sendFile(res, file);
  }

  private sendFile(
    res: Response,
    file: { filename: string; content: Buffer | string; contentType: string },
  ) {
    const encodedFilename = encodeURIComponent(file.filename);
    const isBinary = Buffer.isBuffer(file.content);

    res.setHeader('Content-Type', isBinary ? file.contentType : `${file.contentType}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    res.send(isBinary ? file.content : Buffer.from(file.content as string, 'utf8'));
  }
}
