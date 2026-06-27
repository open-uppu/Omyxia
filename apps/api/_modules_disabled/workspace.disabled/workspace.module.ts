import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';

@Module({
  controllers: [EmailController, ChatController, FilesController],
  providers: [EmailService, ChatService, FilesService],
  exports: [EmailService, ChatService, FilesService],
})
export class WorkspaceModule {}