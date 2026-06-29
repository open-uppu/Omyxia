import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly service: DepartmentsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('tree')
  tree() {
    return this.service.getTree();
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
}