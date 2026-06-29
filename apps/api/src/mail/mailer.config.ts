import { registerAs } from '@nestjs/config';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
  requireTLS: boolean;
}

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  tls: boolean;
}

export interface MailerConfig {
  smtp: SmtpConfig;
  imap: ImapConfig;
}

export default registerAs('mailer', (): MailerConfig => ({
  smtp: {
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    secure: process.env.SMTP_SECURE === 'true',
    requireTLS: process.env.SMTP_REQUIRE_TLS !== 'false',
  },
  imap: {
    host: process.env.IMAP_HOST || 'localhost',
    port: parseInt(process.env.IMAP_PORT || '143', 10),
    user: process.env.IMAP_USER || '',
    pass: process.env.IMAP_PASS || '',
    tls: process.env.IMAP_TLS === 'true',
  },
}));