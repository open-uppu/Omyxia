import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';
import * as bcrypt from 'bcryptjs';

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  tenantName: string;
  locale?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Sign up: create User + Tenant + UserTenant(OWNER) atomically.
   * On any failure the entire transaction rolls back — no orphan User rows,
   * no orphan Tenant rows.
   */
  async signup(input: SignupInput) {
    if (!input?.email || !input?.password || !input?.name || !input?.tenantName) {
      throw new BadRequestException('email, password, name, tenantName are required');
    }
    if (input.password.length < 8) {
      throw new BadRequestException('password must be at least 8 characters');
    }

    const email = input.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const slug = this.makeUniqueSlug(input.tenantName, email);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Bail early on duplicate email — gives a nicer error than the FK collision later.
        const existing = await tx.user.findUnique({ where: { email } });
        if (existing) throw new ConflictException('Email already registered');

        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            name: input.name.trim(),
            locale: input.locale ?? 'th',
          },
        });

        const tenant = await tx.tenant.create({
          data: {
            slug,
            name: input.tenantName.trim(),
            settings: { onboardingComplete: false },
          },
        });

        const membership = await tx.userTenant.create({
          data: {
            userId: user.id,
            tenantId: tenant.id,
            role: 'OWNER',
            active: true,
          },
        });

        return { user, tenant, membership };
      });

      const token = this.jwt.sign({
        sub: result.user.id,
        activeTenantId: result.tenant.id,
        role: result.membership.role,
      });

      return { token, user: result.user, tenant: result.tenant, role: result.membership.role };
    } catch (err: any) {
      // Re-throw our typed errors as-is; wrap others.
      if (err instanceof ConflictException || err instanceof BadRequestException) throw err;
      if (err?.code === 'P2002') {
        throw new ConflictException('Duplicate value (email or tenant slug)');
      }
      throw err;
    }
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { tenants: { include: { tenant: true } } },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    const membership = user.tenants[0];
    if (!membership) throw new UnauthorizedException('No tenant membership');
    const token = this.jwt.sign({
      sub: user.id,
      activeTenantId: membership.tenantId,
      role: membership.role,
    });
    return { token, user, activeTenantId: membership.tenantId, role: membership.role };
  }

  /**
   * Complete onboarding for the active tenant.
   * Sets tenant name (rename), locale on the user, and fiscal year start.
   * Marks onboardingComplete=true in tenant.settings.
   */
  async completeOnboarding(input: { tenantName?: string; locale?: string; fiscalYearStart?: string }) {
    const tenantId = this.tenantContext.getTenantId();
    const userId = this.tenantContext.getUserId();
    if (!tenantId || !userId) throw new UnauthorizedException('Unauthenticated');

    const data: any = {};
    if (input.tenantName) data.name = input.tenantName.trim();

    if (input.locale && !/^[a-z]{2}(-[A-Z]{2})?$/.test(input.locale)) {
      throw new BadRequestException('locale must be like "th" or "th-TH"');
    }

    // Fiscal year start format "MM-DD" (e.g. "01-01" or "10-01")
    if (input.fiscalYearStart && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(input.fiscalYearStart)) {
      throw new BadRequestException('fiscalYearStart must be MM-DD');
    }

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new BadRequestException('Tenant not found');

      const existingSettings = (tenant.settings as Record<string, any>) ?? {};
      const newSettings = {
        ...existingSettings,
        ...(input.fiscalYearStart ? { fiscalYearStart: input.fiscalYearStart } : {}),
        onboardingComplete: true,
      };
      data.settings = newSettings;

      const updatedTenant = await tx.tenant.update({ where: { id: tenantId }, data });

      if (input.locale) {
        await tx.user.update({ where: { id: userId }, data: { locale: input.locale } });
      }

      return { tenant: updatedTenant, onboardingComplete: true };
    });
  }

  private makeUniqueSlug(tenantName: string, email: string): string {
    const base = (tenantName || email.split('@')[0] || 'tenant')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'tenant';
    const stamp = Date.now().toString(36).slice(-4);
    return `${base}-${stamp}`;
  }
}