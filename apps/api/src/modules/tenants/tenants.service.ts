import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly jwt: JwtService,
  ) {}

  async getCurrent() {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) throw new Error('No tenant context');
    return this.prisma.tenant.findUnique({ where: { id: tenantId } });
  }

  async updateCurrent(data: { name?: string; settings?: any }) {
    const tenantId = this.tenantContext.getTenantId();
    return this.prisma.tenant.update({ where: { id: tenantId }, data });
  }

  async listForUser(userId: string) {
    const memberships = await this.prisma.userTenant.findMany({
      where: { userId },
      include: { tenant: true },
    });
    const activeTenantId = this.tenantContext.getTenantId();
    return memberships.map((m) => ({
      ...m.tenant,
      role: m.role,
      active: m.tenantId === activeTenantId,
      joinedAt: m.joinedAt,
    }));
  }

  /**
   * Switch the active tenant for a user.
   * Idempotent: switching to the current tenant returns a fresh token.
   * Rejects: user is not a member of the target tenant, or tenant is not ACTIVE.
   */
  async switchTenant(userId: string, targetTenantId: string) {
    if (!userId) throw new BadRequestException('Missing userId');
    if (!targetTenantId) throw new BadRequestException('Missing tenantId');

    const membership = await this.prisma.userTenant.findUnique({
      where: { tenantId_userId: { tenantId: targetTenantId, userId } },
      include: { tenant: true },
    });

    if (!membership) {
      throw new ForbiddenException('Not a member of this tenant');
    }
    if (membership.tenant.status !== 'ACTIVE') {
      throw new ForbiddenException('Tenant is not active');
    }

    const token = this.jwt.sign({
      sub: userId,
      activeTenantId: targetTenantId,
      role: membership.role,
    });

    return {
      token,
      tenant: membership.tenant,
      role: membership.role,
    };
  }

  /**
   * Create a new tenant. The caller becomes OWNER.
   * Runs as a transaction: UserTenant row is created atomically with Tenant.
   */
  async createTenant(ownerUserId: string, input: { name: string; slug?: string; settings?: any }) {
    if (!input?.name || !input.name.trim()) {
      throw new BadRequestException('Tenant name is required');
    }
    const slug = (input.slug || this.slugify(input.name)).toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
      throw new BadRequestException('Invalid slug');
    }

    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) throw new ConflictException('Tenant slug already taken');

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug,
          name: input.name.trim(),
          settings: input.settings ?? {},
        },
      });
      await tx.userTenant.create({
        data: {
          tenantId: tenant.id,
          userId: ownerUserId,
          role: 'OWNER',
          active: true,
        },
      });
      return tenant;
    });
  }

  private slugify(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'tenant';
  }
}