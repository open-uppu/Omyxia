import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow, ImapFlowOptions, Message, MailboxObject } from 'imapflow';
import { ImapConfig } from './mailer.config';

export interface FetchedMessage {
  uid: number;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: Date;
  text?: string;
  html?: string;
  headers: Record<string, string>;
  size: number;
  flags: string[];
}

export interface ImapMailbox {
  name: string;
  path: string;
  flags: string[];
  exists: number;
}

@Injectable()
export class ImapService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImapService.name);
  private client: ImapFlow | null = null;
  private config: ImapConfig;
  private pollingInterval: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs = 60000; // 60 seconds
  private messageHandler: ((messages: FetchedMessage[]) => Promise<void>) | null = null;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get<ImapConfig>('mailer.imap')!;
  }

  onModuleInit() {
    this.connect();
  }

  onModuleDestroy() {
    this.stopPolling();
    this.disconnect();
  }

  private connect() {
    const options: ImapFlowOptions = {
      host: this.config.host,
      port: this.config.port,
      auth: {
        user: this.config.user,
        pass: this.config.pass,
      },
      tls: this.config.tls,
      tlsOptions: this.config.tls ? { rejectUnauthorized: false } : undefined,
      authTimeout: 10000,
    };

    this.client = new ImapFlow(options);

    this.client.on('error', (err) => {
      this.logger.error(`IMAP connection error: ${err.message}`);
    });

    this.client.on('close', () => {
      this.logger.warn('IMAP connection closed, attempting reconnect...');
      setTimeout(() => this.connect(), 10000);
    });

    this.client.connect().then(() => {
      this.logger.log(`IMAP connected to ${this.config.host}:${this.config.port}`);
      this.startPolling();
    }).catch((err) => {
      this.logger.error(`IMAP connection failed: ${err.message}`);
      setTimeout(() => this.connect(), 10000);
    });
  }

  private disconnect() {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  private startPolling() {
    if (this.pollingInterval) return;
    
    this.pollingInterval = setInterval(async () => {
      try {
        await this.pollInbox();
      } catch (error) {
        this.logger.error(`IMAP polling error: ${(error as Error).message}`);
      }
    }, this.pollIntervalMs);

    // Initial poll
    this.pollInbox().catch((err) => this.logger.error(`Initial IMAP poll failed: ${err.message}`));
  }

  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  setMessageHandler(handler: (messages: FetchedMessage[]) => Promise<void>) {
    this.messageHandler = handler;
  }

  async pollInbox(): Promise<FetchedMessage[]> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    try {
      await this.client.mailboxOpen('INBOX');
      const messages = await this.fetchUnseenMessages();
      
      if (messages.length > 0 && this.messageHandler) {
        await this.messageHandler(messages);
      }

      return messages;
    } catch (error) {
      this.logger.error(`Failed to poll inbox: ${(error as Error).message}`);
      throw error;
    }
  }

  async fetchUnseenMessages(): Promise<FetchedMessage[]> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    await this.client.mailboxOpen('INBOX');
    const unseen = await this.client.search({ seen: false });
    
    if (unseen.length === 0) {
      return [];
    }

    const messages: FetchedMessage[] = [];
    
    for (const uid of unseen) {
      const message = await this.fetchMessage(uid);
      if (message) {
        messages.push(message);
      }
    }

    return messages;
  }

  private async fetchMessage(uid: number): Promise<FetchedMessage | null> {
    if (!this.client) return null;

    try {
      const message = await this.client.fetchOne(uid, {
        source: true,
        envelope: true,
        bodyStructure: true,
        flags: true,
        size: true,
      });

      if (!message) return null;

      const envelope = message.envelope;
      const source = message.source as Buffer;
      
      const parsed = await this.parseMessage(source, envelope);
      
      return {
        uid,
        subject: envelope.subject || '',
        from: envelope.from?.[0]?.address || '',
        to: envelope.to?.map(a => a.address) || [],
        cc: envelope.cc?.map(a => a.address) || [],
        date: envelope.date || new Date(),
        text: parsed.text,
        html: parsed.html,
        headers: this.extractHeaders(source),
        size: message.size,
        flags: message.flags,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch message ${uid}: ${(error as Error).message}`);
      return null;
    }
  }

  private async parseMessage(source: Buffer, envelope: any): Promise<{ text?: string; html?: string }> {
    // Simple parsing - in production use mailparser
    const text = source.toString('utf-8');
    const htmlMatch = text.match(/<html[^>]*>[\s\S]*<\/html>/i);
    
    return {
      text: text.replace(/<[^>]*>/g, '').substring(0, 10000),
      html: htmlMatch ? htmlMatch[0] : undefined,
    };
  }

  private extractHeaders(source: Buffer): Record<string, string> {
    const text = source.toString('utf-8');
    const headerEnd = text.indexOf('\r\n\r\n');
    if (headerEnd === -1) return {};
    
    const headersText = text.substring(0, headerEnd);
    const headers: Record<string, string> = {};
    
    for (const line of headersText.split('\r\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).toLowerCase();
        const value = line.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }
    
    return headers;
  }

  async markSeen(uid: number): Promise<void> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    await this.client.mailboxOpen('INBOX');
    await this.client.messageFlagsAdd(uid, ['\\Seen']);
  }

  async markUnseen(uid: number): Promise<void> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    await this.client.mailboxOpen('INBOX');
    await this.client.messageFlagsRemove(uid, ['\\Seen']);
  }

  async listMailboxes(): Promise<ImapMailbox[]> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    const mailboxes: ImapMailbox[] = [];
    
    for await (const mailbox of this.client.list()) {
      mailboxes.push({
        name: mailbox.name,
        path: mailbox.path,
        flags: mailbox.flags,
        exists: mailbox.exists,
      });
    }

    return mailboxes;
  }

  async getMessageCount(mailbox: string = 'INBOX'): Promise<number> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    const mailbox = await this.client.mailboxOpen(mailbox);
    return mailbox.exists;
  }

  async searchUnseen(mailbox: string = 'INBOX'): Promise<number[]> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    await this.client.mailboxOpen(mailbox);
    return this.client.search({ seen: false });
  }

  isConnected(): boolean {
    return this.client?.usable ?? false;
  }

  getPollInterval(): number {
    return this.pollIntervalMs;
  }
}