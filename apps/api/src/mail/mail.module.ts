import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import mailerConfig from './mailer.config';
import { SmtpService } from './smtp.service';
import { ImapService } from './imap.service';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';

@Global()
@Module({
  imports: [
    ConfigModule.forFeature(mailerConfig),
    ScheduleModule.forRoot(),
  ],
  controllers: [MailController],
  providers: [SmtpService, ImapService, MailService],
  exports: [SmtpService, ImapService, MailService],
})
export class MailModule {}
