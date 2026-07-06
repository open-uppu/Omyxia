import {
  Controller,
  UseGuards,
  Get,
  Post,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { LeaveService } from './leave.service';
import { Roles } from '../auth/rbac/roles.decorator';
import { FeatureGateGuard } from '../../common/entitlements/feature-gate.guard';
import { RequiresFeature } from '../../common/entitlements/requires-feature.decorator';


@Controller('leave')
@UseGuards(FeatureGateGuard)
@RequiresFeature('module.hr')
export class LeaveController {
  constructor(private readonly service: LeaveService) {}

  @Get()
  list(@Query() query: any) {
    return this.service.list(query.employeeId, query.status);
  }

  @Roles('OWNER', 'ADMIN', 'HR_MANAGER', 'MANAGER')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Roles('OWNER', 'ADMIN', 'HR_MANAGER', 'MANAGER')
  @Post(':id/approve')
  approve(@Param('id') id: string, @Body('approverId') approverId: string) {
    return this.service.approve(id, approverId);
  }

  @Roles('OWNER', 'ADMIN', 'HR_MANAGER', 'MANAGER')
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body('approverId') approverId: string) {
    return this.service.reject(id, approverId);
  }

  @Get('quota/:employeeId/:year')
  getQuota(@Param('employeeId') employeeId: string, @Param('year') year: string) {
    return this.service.getQuota(employeeId, parseInt(year));
  }
}