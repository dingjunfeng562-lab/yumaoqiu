import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ExportFilesService } from './export-files.service';

@Module({
  imports: [PrismaModule],
  controllers: [ExportsController],
  providers: [ExportsService, ExportFilesService],
})
export class ExportsModule {}
