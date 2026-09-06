import { Module } from '@nestjs/common';
import { AiConfigService } from './ai-config.service';
import { AiConfigController } from './ai-config.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AiConfigController],
  providers: [AiConfigService],
  exports: [AiConfigService],
})
export class AiConfigModule {}
