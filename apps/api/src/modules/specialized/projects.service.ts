import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedService } from './base.service';

const ALLOWED_PROJECT_FIELDS = [
  'name',
  'code',
  'description',
  'status',
  'ownerId',
  'startDate',
  'endDate',
  'budget',
] as const;

const ALLOWED_TASK_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'assigneeId',
  'parentId',
  'dueDate',
  'estimatedHours',
  'actualHours',
] as const;

/**
 * ProjectsService — minimal viable Project Management CRUD (Phase E / v0.3.1).
 *
 * Responsibilities:
 *  - Tenant-scoped CRUD for Project and ProjectTask rows.
 *  - Cascading delete (project → tasks) is handled by Prisma onDelete: Cascade.
 *  - Every write forces `tenantId` from the TenantContext (never trusts the body).
 *
 * Routes (see projects.controller.ts):
 *  GET    /projects
 *  GET    /projects/:id
 *  POST   /projects
 *  PATCH  /projects/:id
 *  DELETE /projects/:id
 *  GET    /projects/:id/tasks
 *  POST   /projects/:id/tasks
 *  PATCH  /projects/:id/tasks/:taskId
 *  DELETE /projects/:id/tasks/:taskId
 *  PATCH  /projects/:id/tasks/:taskId/status
 */
@Injectable()
export class ProjectsService extends TenantScopedService {
  /**
   * Project-scoped tenant guard. Rejects requests where the row belongs to
   * a different tenant (treats cross-tenant access as 404 to avoid leaking
   * the existence of foreign rows).
   */
  private async findProjectForTenant(id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, tenantId: this.getTenantId() },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private async findTaskForTenant(projectId: string, taskId: string) {
    const task = await this.prisma.projectTask.findFirst({
      where: { id: taskId, projectId, tenantId: this.getTenantId() },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  /**
   * Strip unknown keys from a body so callers can't overwrite `tenantId`,
   * `id`, or `createdAt` via JSON. Returns a new object with only whitelisted
   * fields plus `undefined`-valued entries removed.
   */
  private pickProjectFields(body: Record<string, unknown> | undefined | null) {
    if (!body || typeof body !== 'object') return {};
    const out: Record<string, unknown> = {};
    for (const k of ALLOWED_PROJECT_FIELDS) {
      if (body[k] !== undefined) out[k] = body[k];
    }
    return out;
  }

  private pickTaskFields(body: Record<string, unknown> | undefined | null) {
    if (!body || typeof body !== 'object') return {};
    const out: Record<string, unknown> = {};
    for (const k of ALLOWED_TASK_FIELDS) {
      if (body[k] !== undefined) out[k] = body[k];
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Project CRUD
  // ---------------------------------------------------------------------------

  async listProjects() {
    return this.prisma.project.findMany({
      where: { tenantId: this.getTenantId() },
      include: { tasks: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProject(id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, tenantId: this.getTenantId() },
      include: { tasks: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async createProject(body: Record<string, unknown>) {
    const data = this.pickProjectFields(body);
    if (!data.name || typeof data.name !== 'string') {
      throw new ForbiddenException('name is required');
    }
    const ownerId =
      (data.ownerId as string | undefined) ||
      this.tenantContext.getUserId() ||
      undefined;
    return this.prisma.project.create({
      data: {
        ...data,
        tenantId: this.getTenantId(),
        ownerId,
      },
    });
  }

  async updateProject(id: string, body: Record<string, unknown>) {
    await this.findProjectForTenant(id);
    const data = this.pickProjectFields(body);
    if (Object.keys(data).length === 0) {
      throw new ForbiddenException('No updatable fields supplied');
    }
    return this.prisma.project.update({
      where: { id },
      data,
    });
  }

  async deleteProject(id: string) {
    await this.findProjectForTenant(id);
    // Prisma onDelete: Cascade on ProjectTask handles tasks.
    await this.prisma.project.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Task CRUD (nested under project)
  // ---------------------------------------------------------------------------

  async listTasks(projectId: string) {
    // Ensure the project belongs to this tenant before returning tasks.
    await this.findProjectForTenant(projectId);
    return this.prisma.projectTask.findMany({
      where: { projectId, tenantId: this.getTenantId() },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTask(projectId: string, body: Record<string, unknown>) {
    await this.findProjectForTenant(projectId);
    const data = this.pickTaskFields(body);
    if (!data.title || typeof data.title !== 'string') {
      throw new ForbiddenException('title is required');
    }
    return this.prisma.projectTask.create({
      data: {
        ...data,
        projectId,
        tenantId: this.getTenantId(),
      },
    });
  }

  async updateTask(projectId: string, taskId: string, body: Record<string, unknown>) {
    await this.findTaskForTenant(projectId, taskId);
    const data = this.pickTaskFields(body);
    if (Object.keys(data).length === 0) {
      throw new ForbiddenException('No updatable fields supplied');
    }
    return this.prisma.projectTask.update({
      where: { id: taskId },
      data,
    });
  }

  async updateTaskStatus(projectId: string, taskId: string, status: unknown) {
    if (typeof status !== 'string' || !status) {
      throw new ForbiddenException('status must be a non-empty string');
    }
    await this.findTaskForTenant(projectId, taskId);
    return this.prisma.projectTask.update({
      where: { id: taskId },
      data: { status },
    });
  }

  async deleteTask(projectId: string, taskId: string) {
    await this.findTaskForTenant(projectId, taskId);
    await this.prisma.projectTask.delete({ where: { id: taskId } });
    return { id: taskId, deleted: true };
  }

  }