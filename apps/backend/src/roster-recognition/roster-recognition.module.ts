import { Module } from '@nestjs/common';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RosterRecognitionController } from './roster-recognition.controller';
import { RosterRecognitionService } from './roster-recognition.service';

@Module({
  imports: [PrismaModule, AiConfigModule],
  controllers: [RosterRecognitionController],
  providers: [RosterRecognitionService],
  exports: [RosterRecognitionService],
})
export class RosterRecognitionModule {}
