import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { PmsService } from './pms.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('pms')
export class PmsController {
  constructor(private readonly service: PmsService) {}

  @Get('projects')
  list() {
    return this.service.listProjects();
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('projects')
  create(@Body() body: any) {
    return this.service.createProject(body);
  }

  @Get('tasks')
  tasks(@Query('projectId') projectId?: string) {
    return this.service.listTasks(projectId);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('tasks')
  createTask(@Body() body: any) {
    return this.service.createTask(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Patch('tasks/:id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.service.updateTaskStatus(id, status);
  }
}