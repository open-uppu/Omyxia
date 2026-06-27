import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { JournalService } from './journal.service';

@Controller('journals')
export class JournalController {
  constructor(private readonly service: JournalService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() body: any) {
    return this.service.create({
      ...body,
      date: new Date(body.date),
    });
  }

  @Get('trial-balance')
  trialBalance(@Query('from') from: string, @Query('to') to: string) {
    return this.service.trialBalance(new Date(from), new Date(to));
  }
}