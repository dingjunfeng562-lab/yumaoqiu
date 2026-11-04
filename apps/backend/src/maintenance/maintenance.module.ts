import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminMaintenanceController,
  MaintenanceController,
} from './maintenance.controller';
import { MaintenanceMiddleware } from './maintenance.middleware';
import { MaintenanceService } from './maintenance.service';

// 全局模块：AuthController 登录时要看维护开关，main.ts 要拿到中间件实例。
@Global()
@Module({
  imports: [AuthModule],
  controllers: [MaintenanceController, AdminMaintenanceController],
  providers: [MaintenanceService, MaintenanceMiddleware],
  exports: [MaintenanceService, MaintenanceMiddleware],
})
export class MaintenanceModule {}
