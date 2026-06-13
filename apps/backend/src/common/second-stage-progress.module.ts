import { Module } from '@nestjs/common';
import { SecondStageProgressService } from './second-stage-progress.service';

/** 提供第二阶段统一推进服务，供 DrawsModule（确认生成）与 ScoringModule（记分推进）复用。 */
@Module({
  providers: [SecondStageProgressService],
  exports: [SecondStageProgressService],
})
export class SecondStageProgressModule {}
