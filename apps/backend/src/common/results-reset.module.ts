import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoringModule } from '../scoring/scoring.module';
import { ResultsResetController } from './results-reset.controller';
import { ResultsResetService } from './results-reset.service';

@Module({ imports: [PrismaModule, ScoringModule], controllers: [ResultsResetController], providers: [ResultsResetService] })
export class ResultsResetModule {}
