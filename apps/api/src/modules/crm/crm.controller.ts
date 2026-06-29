import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { CrmService } from './crm.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('crm')
export class CrmController {
  constructor(private readonly service: CrmService) {}

  @Get('pipelines')
  listPipelines() {
    return this.service.listPipelines();
  }

  @Post('pipelines')
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  createPipeline(@Body() body: { name: string; stages: string[] }) {
    return this.service.createPipeline(body);
  }

  @Get('leads')
  listLeads(@Query('stage') stage?: string, @Query('status') status?: string) {
    return this.service.listLeads(stage, status);
  }

  @Post('leads')
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  createLead(@Body() body: any) {
    return this.service.createLead(body);
  }

  @Patch('leads/:id/stage')
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  updateLeadStage(@Param('id') id: string, @Body('stage') stage: string) {
    return this.service.updateLeadStage(id, stage);
  }

  @Delete('leads/:id')
  @Roles('OWNER', 'ADMIN')
  deleteLead(@Param('id') id: string) {
    return this.service.deleteLead(id);
  }

  @Get('activities')
  listActivities(@Query('leadId') leadId?: string) {
    return this.service.listActivities(leadId);
  }

  @Post('activities')
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  createActivity(@Body() body: any) {
    return this.service.createActivity(body);
  }
}