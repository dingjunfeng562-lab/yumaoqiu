import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminEmailController } from './admin-email.controller';
import { EmailReminderService } from './email-reminder.service';
import { EmailService } from './email.service';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AdminEmailController],
  providers: [MailService, EmailService, EmailReminderService],
  exports: [MailService, EmailService],
})
export class MailModule {}
