import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { MasService } from './mas.service';

@Controller('mas')
export class MasController {
  constructor(private readonly service: MasService) {}

  @Get('campaigns')
  list() {
    return this.service.listCampaigns();
  }

  @Post('campaigns')
  create(@Body() body: any) {
    return this.service.createCampaign(body);
  }

  @Post('campaigns/:id/send')
  send(@Param('id') id: string) {
    return this.service.sendCampaign(id);
  }

  @Get('profiles')
  profiles() {
    return this.service.listProfiles();
  }

  @Post('events')
  track(@Body() body: any) {
    return this.service.trackEvent(body.profileId, body.type, body.properties);
  }
}