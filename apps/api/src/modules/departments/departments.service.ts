import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async list() {
    return this.prisma.department.findMany({
      where: { tenantId: this.getTenantId() },
      include: { children: true, employees: true },
    });
  }

  async getTree() {
    const all = await this.list();
    const map = new Map(all.map((d) => [d.id, { ...d, children: [] }]));
    const roots: any[] = [];
    for (const d of all) {
      if (d.parentId && map.has(d.parentId)) {
        map.get(d.parentId)!.children.push(map.get(d.id));
      } else {
        roots.push(map.get(d.id));
      }
    }
    return roots;
  }

  async create(data: any) {
    return this.prisma.department.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.department.update({ where: { id }, data });
  }
}