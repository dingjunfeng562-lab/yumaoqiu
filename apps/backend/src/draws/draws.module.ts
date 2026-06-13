import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecondStageProgressModule } from '../common/second-stage-progress.module';
import { DrawAlgorithmService } from './draw-algorithm.service';
import { DrawLogService } from './draw-log.service';
import { DrawsController } from './draws.controller';
import { DrawsService } from './draws.service';

@Module({
  imports: [PrismaModule, SecondStageProgressModule],
  controllers: [DrawsController],
  providers: [DrawsService, DrawAlgorithmService, DrawLogService],
})
export class DrawsModule {}
