import { Module } from '@nestjs/common';
import { AiChatService } from './ai-chat.service';
import { AiChatController } from './ai-chat.controller';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { UsageMetricsModule } from '../usage-metrics/usage-metrics.module';

@Module({
  imports: [AiConfigModule, UsageMetricsModule],
  controllers: [AiChatController],
  providers: [AiChatService],
})
export class AiChatModule {}
