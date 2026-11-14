import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoringModule } from '../scoring/scoring.module';
import { CheckInController, PublicCheckInController } from './check-in.controller';
import { CheckInService } from './check-in.service';

@Module({
  imports: [PrismaModule, ScoringModule],
  controllers: [CheckInController, PublicCheckInController],
  providers: [CheckInService],
})
export class CheckInModule {}
