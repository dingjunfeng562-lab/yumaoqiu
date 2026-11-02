import { Controller, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PublicService } from './public.service';
import { TournamentScreenService } from './tournament-screen.service';

@Controller('public')
export class PublicController {
  constructor(
    private publicService: PublicService,
    private tournamentScreenService: TournamentScreenService,
  ) {}

  @Get('tournaments/:id/screen')
  @Header('Cache-Control', 'no-store')
  getTournamentScreen(@Param('id') id: string) {
    return this.tournamentScreenService.getScreen(id);
  }

  @Get('home')
  getHome() {
    return this.publicService.getHome();
  }

  @Get('lobby')
  getLobby() {
    return this.publicService.getLobby();
  }

  @Get('screen')
  getScreen() {
    return this.publicService.getScreen();
  }

  @Get('team-competitions')
  getTeamCompetitions() {
    return this.publicService.getTeamCompetitions();
  }

  @Get('announcements')
  getAnnouncements() {
    return this.publicService.getAnnouncements();
  }

  @Get('announcements/popup')
  getAnnouncementPopup() {
    return this.publicService.getAnnouncementPopup();
  }

  // Served from a shared, pre-serialized and pre-gzipped payload (see
  // PublicService.getBracketsPayload). nginx leaves bodies that already carry
  // Content-Encoding alone, so the gzip happens once per data change instead
  // of once per viewer. `?tournamentId=` narrows it to one tournament; without
  // it the response is unchanged (all public brackets).
  @Get('brackets')
  async getBrackets(
    @Query('tournamentId') tournamentId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const payload = await this.publicService.getBracketsPayload(
      typeof tournamentId === 'string' && tournamentId ? tournamentId : undefined,
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.vary('Accept-Encoding'); // append; CORS already set Vary: Origin
    if (/\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''))) {
      res.setHeader('Content-Encoding', 'gzip');
      res.end(payload.gzip);
    } else {
      res.end(payload.json);
    }
  }

  @Get('history')
  getHistory() {
    return this.publicService.getHistory();
  }

  @Get('ranking')
  @Header('Cache-Control', 'no-store')
  getRanking(@Query('tournamentId') tournamentId?: string) {
    return this.publicService.getRanking(tournamentId);
  }
}
