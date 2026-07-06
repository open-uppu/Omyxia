import {
  Controller,
  UseGuards,
  Get,
  Post,
  Body,
} from '@nestjs/common';
import { PositionsService } from './positions.service';
import { Roles } from '../auth/rbac/roles.decorator';
import { FeatureGateGuard } from '../../common/entitlements/feature-gate.guard';
import { RequiresFeature } from '../../common/entitlements/requires-feature.decorator';


@Controller('positions')
@UseGuards(FeatureGateGuard)
@RequiresFeature('module.hr')
export class PositionsController {
  constructor(private readonly service: PositionsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Roles('OWNER', 'ADMIN', 'HR_MANAGER', 'MANAGER')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }
}