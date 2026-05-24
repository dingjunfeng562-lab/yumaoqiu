import { Controller, Get } from '@nestjs/common';
import { PublicService } from './public.service';

@Controller('public')
export class PublicController {
  constructor(private publicService: PublicService) {}

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
  getRanking() {
    return this.publicService.getRanking();
  }
}
