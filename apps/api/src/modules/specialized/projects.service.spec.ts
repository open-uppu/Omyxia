import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

const TENANT = 'tenant-A';
const USER = 'user-1';

function makePrisma() {
  return {
    project: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    projectTask: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  } as any;
}

function makeTenantContext(
  overrides: Partial<{ tenantId: any; userId: any }> = {},
) {
  return {
    getTenantId: vi.fn().mockReturnValue(overrides.tenantId ?? TENANT),
    getUserId: vi.fn().mockReturnValue(overrides.userId ?? USER),
  } as any;
}

describe('ProjectsService — projects CRUD', () => {
  let service: ProjectsService;
  let prisma: ReturnType<typeof makePrisma>;
  let tenantContext: ReturnType<typeof makeTenantContext>;

  beforeEach(() => {
    prisma = makePrisma();
    tenantContext = makeTenantContext();
    service = new ProjectsService(prisma, tenantContext);
  });

  it('listProjects scopes by tenantId and includes tasks', async () => {
    prisma.project.findMany.mockResolvedValue([{ id: 'p1' }]);
    const res = await service.listProjects();
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
      include: { tasks: true },
      orderBy: { createdAt: 'desc' },
    });
    expect(res).toEqual([{ id: 'p1' }]);
  });

  it('listProjects throws when no tenant context', async () => {
    tenantContext.getTenantId.mockReturnValue(undefined);
    await expect(service.listProjects()).rejects.toThrow('No tenant context');
  });

  it('getProject returns the project with tasks when found', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1', name: 'Apollo' });
    const res = await service.getProject('p1');
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', tenantId: TENANT },
      include: { tasks: true },
    });
    expect(res).toEqual({ id: 'p1', name: 'Apollo' });
  });

  it('getProject throws NotFound when missing or wrong tenant', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.getProject('p1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('createProject rejects when name is missing', async () => {
    await expect(service.createProject({})).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('createProject sets tenantId and defaults ownerId from context', async () => {
    prisma.project.create.mockResolvedValue({ id: 'p-new' });
    await service.createProject({ name: 'New', description: 'x' });
    const arg = prisma.project.create.mock.calls[0]![0];
    expect(arg.data.name).toBe('New');
    expect(arg.data.description).toBe('x');
    expect(arg.data.tenantId).toBe(TENANT);
    expect(arg.data.ownerId).toBe(USER);
  });

  it('createProject respects an explicit ownerId', async () => {
    prisma.project.create.mockResolvedValue({ id: 'p-new' });
    await service.createProject({ name: 'New', ownerId: 'other-user' });
    const arg = prisma.project.create.mock.calls[0]![0];
    expect(arg.data.ownerId).toBe('other-user');
  });

  it('createProject ignores unknown keys (tenantId, id, createdAt)', async () => {
    prisma.project.create.mockResolvedValue({ id: 'p-new' });
    await service.createProject({
      name: 'New',
      tenantId: 'OTHER',
      id: 'forged',
      createdAt: new Date(0),
    });
    const data = prisma.project.create.mock.calls[0]![0].data;
    expect(data.tenantId).toBe(TENANT); // forced
    expect(data.id).toBeUndefined();
    expect(data.createdAt).toBeUndefined();
  });

  it('createProject leaves ownerId undefined when no user context', async () => {
    tenantContext.getUserId.mockReturnValue(undefined);
    prisma.project.create.mockResolvedValue({ id: 'p-new' });
    await service.createProject({ name: 'New' });
    const arg = prisma.project.create.mock.calls[0]![0];
    expect(arg.data.ownerId).toBeUndefined();
  });

  it('updateProject throws Forbidden when no whitelisted fields', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    await expect(
      service.updateProject('p1', { tenantId: 'OTHER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateProject returns the updated row', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.project.update.mockResolvedValue({ id: 'p1', name: 'New' });
    const res = await service.updateProject('p1', { name: 'New' });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { name: 'New' },
    });
    expect(res).toEqual({ id: 'p1', name: 'New' });
  });

  it('updateProject throws NotFound when project not in tenant', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(
      service.updateProject('p1', { name: 'New' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deleteProject deletes after tenant check', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.project.delete.mockResolvedValue({ id: 'p1' });
    const res = await service.deleteProject('p1');
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(res).toEqual({ id: 'p1', deleted: true });
  });

  it('deleteProject throws NotFound for cross-tenant access', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.deleteProject('p1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProjectsService — tasks (nested under project)', () => {
  let service: ProjectsService;
  let prisma: ReturnType<typeof makePrisma>;
  let tenantContext: ReturnType<typeof makeTenantContext>;

  beforeEach(() => {
    prisma = makePrisma();
    tenantContext = makeTenantContext();
    service = new ProjectsService(prisma, tenantContext);
  });

  it('listTasks first checks the project belongs to tenant', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.listTasks('p1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.projectTask.findMany).not.toHaveBeenCalled();
  });

  it('listTasks returns tasks scoped to project + tenant', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.projectTask.findMany.mockResolvedValue([{ id: 't1' }]);
    await service.listTasks('p1');
    expect(prisma.projectTask.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', tenantId: TENANT },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('createTask rejects when title is missing', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    await expect(
      service.createTask('p1', { description: 'no title' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('createTask persists task scoped to project + tenant', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.projectTask.create.mockResolvedValue({ id: 't1' });
    await service.createTask('p1', { title: 'Write tests', priority: 'HIGH' });
    const arg = prisma.projectTask.create.mock.calls[0]![0];
    expect(arg.data.projectId).toBe('p1');
    expect(arg.data.tenantId).toBe(TENANT);
    expect(arg.data.title).toBe('Write tests');
    expect(arg.data.priority).toBe('HIGH');
  });

  it('updateTask requires an existing task row', async () => {
    prisma.projectTask.findFirst.mockResolvedValue(null);
    await expect(
      service.updateTask('p1', 't1', { title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateTask ignores non-whitelisted fields', async () => {
    prisma.projectTask.findFirst.mockResolvedValue({ id: 't1' });
    prisma.projectTask.update.mockResolvedValue({ id: 't1' });
    await service.updateTask('p1', 't1', {
      title: 'New',
      tenantId: 'OTHER',
      projectId: 'OTHER',
    });
    const arg = prisma.projectTask.update.mock.calls[0]![0];
    expect(arg.data.title).toBe('New');
    expect(arg.data.tenantId).toBeUndefined();
    expect(arg.data.projectId).toBeUndefined();
  });

  it('updateTaskStatus rejects non-string status', async () => {
    prisma.projectTask.findFirst.mockResolvedValue({ id: 't1' });
    await expect(
      service.updateTaskStatus('p1', 't1', 42 as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateTaskStatus accepts a status string', async () => {
    prisma.projectTask.findFirst.mockResolvedValue({ id: 't1' });
    prisma.projectTask.update.mockResolvedValue({ id: 't1', status: 'DONE' });
    await service.updateTaskStatus('p1', 't1', 'DONE');
    expect(prisma.projectTask.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'DONE' },
    });
  });

  it('deleteTask removes after tenant check', async () => {
    prisma.projectTask.findFirst.mockResolvedValue({ id: 't1' });
    prisma.projectTask.delete.mockResolvedValue({ id: 't1' });
    const res = await service.deleteTask('p1', 't1');
    expect(prisma.projectTask.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(res).toEqual({ id: 't1', deleted: true });
  });
});