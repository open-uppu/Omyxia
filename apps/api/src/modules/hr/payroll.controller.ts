import {
  Controller,
  UseGuards,
  Get,
  Post,
  Param,
  Body,
} from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { Roles } from '../auth/rbac/roles.decorator';
import { FeatureGateGuard } from '../../common/entitlements/feature-gate.guard';
import { RequiresFeature } from '../../common/entitlements/requires-feature.decorator';


@Controller('payroll')
@UseGuards(FeatureGateGuard)
@RequiresFeature('module.hr')
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  @Get('periods')
  listPeriods() {
    return this.service.listPeriods();
  }

  @Roles('OWNER', 'ADMIN')
  @Post('periods')
  createPeriod(@Body() body: { periodStart: Date; periodEnd: Date }) {
    return this.service.createPeriod(new Date(body.periodStart), new Date(body.periodEnd));
  }

  @Roles('OWNER', 'ADMIN')
  @Post('periods/:id/calculate')
  calculate(@Param('id') id: string) {
    return this.service.calculate(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('periods/:id/approve')
  approve(@Param('id') id: string, @Body('approverId') approverId: string) {
    return this.service.approve(id, approverId);
  }

  @Get('periods/:id/lines')
  listLines(@Param('id') id: string) {
    return this.service.listLines(id);
  }
}