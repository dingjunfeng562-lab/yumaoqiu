import { Controller, Get, Header, Param, Query } from '@nestjs/common';
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

  @Get('brackets')
  getBrackets() {
    return this.publicService.getBrackets();
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
