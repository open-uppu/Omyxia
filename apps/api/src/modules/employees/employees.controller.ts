import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly service: EmployeesService) {}

  @Get()
  list(@Query() query: any) {
    return this.service.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}