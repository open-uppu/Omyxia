import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { BiService } from './bi.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('bi')
export class BiController {
  constructor(private readonly service: BiService) {}

  @Get('dashboards')
  list() {
    return this.service.listDashboards();
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('dashboards')
  create(@Body() body: any) {
    return this.service.createDashboard(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('dashboards/:id/snapshot')
  snapshot(@Param('id') id: string, @Body() body: any) {
    return this.service.snapshot(id, body.data, body.parameters);
  }

  @Get('snapshots')
  snapshots(@Query('dashboardId') dashboardId?: string) {
    return this.service.listSnapshots(dashboardId);
  }

  @Get('kpis')
  kpis() {
    return this.service.listKpis();
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('kpis')
  createKpi(@Body() body: any) {
    return this.service.createKpi(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('kpis/:id/values')
  recordValue(@Param('id') id: string, @Body() body: any) {
    return this.service.recordKpiValue(id, body.value, body.period);
  }

  @Get('kpis/:id/history')
  history(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.service.getKpiHistory(id, limit ? parseInt(limit) : 100);
  }
}