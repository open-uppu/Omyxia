import {
  Controller,
  UseGuards,
  Get,
  Post,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { Roles } from '../auth/rbac/roles.decorator';
import { FeatureGateGuard } from '../../common/entitlements/feature-gate.guard';
import { RequiresFeature } from '../../common/entitlements/requires-feature.decorator';


@Controller('attendance')
@UseGuards(FeatureGateGuard)
@RequiresFeature('module.hr')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Get()
  list(@Query() query: any) {
    return this.service.list(query.employeeId, query.from, query.to);
  }

  @Roles('OWNER', 'ADMIN', 'HR_MANAGER', 'MANAGER')
  @Post(':employeeId/clock-in')
  clockIn(@Param('employeeId') employeeId: string) {
    return this.service.clockIn(employeeId);
  }

  @Roles('OWNER', 'ADMIN', 'HR_MANAGER', 'MANAGER')
  @Post(':employeeId/clock-out')
  clockOut(@Param('employeeId') employeeId: string) {
    return this.service.clockOut(employeeId);
  }
}