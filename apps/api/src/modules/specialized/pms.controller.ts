import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { PmsService } from './pms.service';

@Controller('pms')
export class PmsController {
  constructor(private readonly service: PmsService) {}

  @Get('projects')
  list() {
    return this.service.listProjects();
  }

  @Post('projects')
  create(@Body() body: any) {
    return this.service.createProject(body);
  }

  @Get('tasks')
  tasks(@Query('projectId') projectId?: string) {
    return this.service.listTasks(projectId);
  }

  @Post('tasks')
  createTask(@Body() body: any) {
    return this.service.createTask(body);
  }

  @Patch('tasks/:id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.service.updateTaskStatus(id, status);
  }
}