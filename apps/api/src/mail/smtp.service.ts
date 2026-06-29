import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { SmtpConfig } from './mailer.config';

export interface SendMailOptions {
  from?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: nodemailer.SendMailOptions['attachments'];
}

export interface SendMailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
}

@Injectable()
export class SmtpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SmtpService.name);
  private transporter: nodemailer.Transporter;
  private config: SmtpConfig;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get<SmtpConfig>('mailer.smtp')!;
  }

  onModuleInit() {
    this.transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      requireTLS: this.config.requireTLS,
      auth: this.config.user && this.config.pass ? {
        user: this.config.user,
        pass: this.config.pass,
      } : undefined,
      tls: this.config.requireTLS ? { rejectUnauthorized: false } : undefined,
    });

    this.transporter.verify((error) => {
      if (error) {
        this.logger.warn(`SMTP connection verification failed: ${error.message}`);
      } else {
        this.logger.log(`SMTP connection verified: ${this.config.host}:${this.config.port}`);
      }
    });
  }

  onModuleDestroy() {
    if (this.transporter) {
      this.transporter.close();
    }
  }

  async sendMail(options: SendMailOptions): Promise<SendMailResult> {
    const from = options.from || this.config.user || 'noreply@openuppu.local';
    const to = Array.isArray(options.to) ? options.to.join(', ') : options.to;

    const mailOptions: nodemailer.SendMailOptions = {
      from,
      to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    };

    if (options.cc) {
      mailOptions.cc = Array.isArray(options.cc) ? options.cc.join(', ') : options.cc;
    }
    if (options.bcc) {
      mailOptions.bcc = Array.isArray(options.bcc) ? options.bcc.join(', ') : options.bcc;
    }

    try {
      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(`Email sent: ${info.messageId} to ${to}`);
      return {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      };
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`);
      throw error;
    }
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      this.logger.error(`SMTP verification failed: ${error.message}`);
      return false;
    }
  }

  getTransporter(): nodemailer.Transporter {
    return this.transporter;
  }
}