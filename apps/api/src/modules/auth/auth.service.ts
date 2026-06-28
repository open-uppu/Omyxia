import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async signup(email: string, password: string, name: string, tenantName: string) {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        tenants: {
          create: {
            tenant: {
              create: {
                slug: email.split('@')[0] + '-' + Date.now(),
                name: tenantName,
              },
            },
          },
        },
      },
      include: { tenants: { include: { tenant: true } } },
    });
    const membership = user.tenants[0];
    const tenant = membership.tenant;
    const token = this.jwt.sign({ sub: user.id, activeTenantId: tenant.id, role: 'OWNER' });
    return { token, tenant, user };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { tenants: true },
    });
    if (!user) throw new Error('Invalid credentials');
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new Error('Invalid credentials');
    const membership = user.tenants[0];
    const token = this.jwt.sign({ sub: user.id, activeTenantId: membership.tenantId, role: membership.role });
    return { token, user, activeTenantId: membership.tenantId };
  }

  async switchTenant(userId: string, tenantId: string) {
    const membership = await this.prisma.userTenant.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (!membership) throw new Error('Not a member of this tenant');
    const token = this.jwt.sign({ sub: userId, activeTenantId: tenantId, role: membership.role });
    return { token, tenantId, role: membership.role };
  }
}