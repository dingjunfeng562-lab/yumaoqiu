import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CompetitionsService } from './competitions.service';
import { SubmitCompetitionRegistrationDto } from './dto/competition-registration.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

type AuthRequest = {
  user?: {
    id?: string;
  };
};

@Controller('competitions')
export class CompetitionsController {
  constructor(private competitionsService: CompetitionsService) {}

  @Get()
  listCompetitions() {
    return this.competitionsService.listPublicCompetitions();
  }

  @Get(':id')
  getCompetition(@Param('id') id: string) {
    return this.competitionsService.getPublicCompetition(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/registration/me')
  getMyRegistration(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.competitionsService.getMyRegistration(id, req.user?.id ?? '');
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/register')
  submitRegistration(
    @Param('id') id: string,
    @Req() req: AuthRequest,
    @Body() dto: SubmitCompetitionRegistrationDto,
  ) {
    return this.competitionsService.submitRegistration(id, req.user?.id ?? '', dto);
  }

  @Get(':id/players')
  listPlayers(@Param('id') id: string) {
    return this.competitionsService.listPublicPlayers(id);
  }
}
