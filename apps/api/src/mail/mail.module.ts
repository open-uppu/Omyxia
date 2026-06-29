import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import mailerConfig from './mailer.config';
import { SmtpService } from './smtp.service';
import { ImapService } from './imap.service';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [
    ConfigModule.forFeature(mailerConfig),
    ScheduleModule.forRoot(),
  ],
  providers: [SmtpService, ImapService, MailService],
  exports: [SmtpService, ImapService, MailService],
})
export class MailModule {}