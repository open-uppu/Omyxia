import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { CrmService } from './crm.service';

@Controller('crm')
export class CrmController {
  constructor(private readonly service: CrmService) {}

  @Get('pipelines')
  listPipelines() {
    return this.service.listPipelines();
  }

  @Post('pipelines')
  createPipeline(@Body() body: { name: string; stages: string[] }) {
    return this.service.createPipeline(body);
  }

  @Get('leads')
  listLeads(@Query('stage') stage?: string, @Query('status') status?: string) {
    return this.service.listLeads(stage, status);
  }

  @Post('leads')
  createLead(@Body() body: any) {
    return this.service.createLead(body);
  }

  @Patch('leads/:id/stage')
  updateLeadStage(@Param('id') id: string, @Body('stage') stage: string) {
    return this.service.updateLeadStage(id, stage);
  }

  @Get('activities')
  listActivities(@Query('leadId') leadId?: string) {
    return this.service.listActivities(leadId);
  }

  @Post('activities')
  createActivity(@Body() body: any) {
    return this.service.createActivity(body);
  }
}