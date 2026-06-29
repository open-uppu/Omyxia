import { Controller, Get, Post, Body } from '@nestjs/common';
import { PositionsService } from './positions.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('positions')
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