import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RegistrationGroupsController } from './registration-groups.controller';
import { RegistrationGroupsService } from './registration-groups.service';

@Module({ imports: [PrismaModule], controllers: [RegistrationGroupsController], providers: [RegistrationGroupsService] })
export class RegistrationGroupsModule {}
