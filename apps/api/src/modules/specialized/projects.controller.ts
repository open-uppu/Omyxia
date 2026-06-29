import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { Roles } from '../auth/rbac/roles.decorator';

/**
 * ProjectsController — minimal viable Project Management (Phase E / v0.3.1).
 *
 * Routes (all tenant-scoped via TenantContextMiddleware + RLS):
 *  GET    /projects                          → list projects for current tenant
 *  GET    /projects/:id                      → project detail (with tasks)
 *  POST   /projects                          → create project (M+)
 *  PATCH  /projects/:id                      → update project  (M+)
 *  DELETE /projects/:id                      → delete project + cascade tasks (ADMIN+)
 *  GET    /projects/:id/tasks                → list tasks in project
 *  POST   /projects/:id/tasks                → create task     (M+)
 *  PATCH  /projects/:id/tasks/:taskId        → update task fields (M+)
 *  PATCH  /projects/:id/tasks/:taskId/status → quick status change (M+)
 *  DELETE /projects/:id/tasks/:taskId        → delete task (ADMIN+)
 */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  list() {
    return this.service.listProjects();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getProject(id);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.createProject(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.updateProject(id, body);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.deleteProject(id);
  }

  // ---- Tasks (nested) -----------------------------------------------------

  @Get(':id/tasks')
  listTasks(@Param('id') id: string) {
    return this.service.listTasks(id);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post(':id/tasks')
  createTask(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.createTask(id, body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Patch(':id/tasks/:taskId')
  updateTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.updateTask(id, taskId, body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Patch(':id/tasks/:taskId/status')
  updateTaskStatus(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body('status') status: unknown,
  ) {
    return this.service.updateTaskStatus(id, taskId, status);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id/tasks/:taskId')
  deleteTask(@Param('id') id: string, @Param('taskId') taskId: string) {
    return this.service.deleteTask(id, taskId);
  }
}