import { Injectable } from '@nestjs/common';
import { TenantScopedService } from './base.service';

@Injectable()
export class PmsService extends TenantScopedService {
  async listProjects() {
    return this.prisma.project.findMany({
      where: { tenantId: this.getTenantId() },
      include: { tasks: true },
    });
  }

  async createProject(data: any) {
    return this.prisma.project.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async listTasks(projectId?: string) {
    return this.prisma.projectTask.findMany({
      where: { tenantId: this.getTenantId(), ...(projectId && { projectId }) },
    });
  }

  async createTask(data: any) {
    return this.prisma.projectTask.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async updateTaskStatus(id: string, status: string) {
    return this.prisma.projectTask.update({ where: { id }, data: { status } });
  }
}