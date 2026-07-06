import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CrmService } from './crm.service';
import { Roles } from '../auth/rbac/roles.decorator';
import { FeatureGateGuard } from '../../common/entitlements/feature-gate.guard';
import {
  RequiresFeature,
} from '../../common/entitlements/requires-feature.decorator';

/**
 * CRM controller — sales pipelines, leads, activities.
 *
 * P3.1: gated by `module.crm`. Write paths additionally cap on
 * `limit.maxLeads` so a tenant on the Pro plan can't exceed their
 * active-lead quota. Super-admin bypasses all gates (audited).
 */
@Controller('crm')
@UseGuards(FeatureGateGuard)
@RequiresFeature('module.crm')
export class CrmController {
  constructor(private readonly service: CrmService) {}

  // ---- pipelines -----------------------------------------------------

  @Get('pipelines')
  listPipelines() {
    return this.service.listPipelines();
  }

  @Post('pipelines')
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @RequiresFeature('module.crm', { max: undefined })
  createPipeline(@Body() body: { name: string; stages: string[] }) {
    return this.service.createPipeline(body);
  }

  // ---- leads ---------------------------------------------------------

  @Get('leads')
  listLeads(@Query('stage') stage?: string, @Query('status') status?: string) {
    return this.service.listLeads(stage, status);
  }

  @Post('leads')
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @RequiresFeature('limit.maxLeads', { max: 50 })
  createLead(@Body() body: any) {
    return this.service.createLead(body);
  }

  @Patch('leads/:id/stage')
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @RequiresFeature('module.crm')
  updateLeadStage(@Param('id') id: string, @Body('stage') stage: string) {
    return this.service.updateLeadStage(id, stage);
  }

  @Delete('leads/:id')
  @Roles('OWNER', 'ADMIN')
  @RequiresFeature('module.crm')
  deleteLead(@Param('id') id: string) {
    return this.service.deleteLead(id);
  }

  // ---- activities ----------------------------------------------------

  @Get('activities')
  listActivities(@Query('leadId') leadId?: string) {
    return this.service.listActivities(leadId);
  }

  @Post('activities')
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @RequiresFeature('module.crm')
  createActivity(@Body() body: any) {
    return this.service.createActivity(body);
  }
}
