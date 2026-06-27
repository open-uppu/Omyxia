import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly service: ChatService) {}

  @Get('channels')
  listChannels() {
    return this.service.listChannels();
  }

  @Post('channels')
  createChannel(@Body() body: any) {
    return this.service.createChannel(body);
  }

  @Get('channels/:id/messages')
  listMessages(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.service.listMessages(id, limit ? parseInt(limit) : 50);
  }

  @Post('channels/:id/messages')
  sendMessage(@Param('id') id: string, @Body('content') content: string) {
    return this.service.sendMessage(id, content);
  }
}