import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CompetitionsModule } from '../competitions/competitions.module';
import { TeamCompetitionsModule } from '../team-competitions/team-competitions.module';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [PrismaModule, CompetitionsModule, TeamCompetitionsModule],
  controllers: [AdminPaymentsController, PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
