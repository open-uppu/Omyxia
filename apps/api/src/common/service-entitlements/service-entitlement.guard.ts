import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { TenantContextService } from '../tenant-context/tenant-context.service';
import { ServiceEntitlementService } from './service-entitlement.service';
import { ServiceForbiddenException } from './service-forbidden.exception';
import {
  REQUIRES_SERVICE_METADATA_KEY,
  type RequiresServiceMetadata,
} from './requires-service.decorator';
import { resolveMicroserviceFromPath } from './service-resolver';
import type { MicroserviceId, TenantRole } from '@omyxia/shared-types';

@Injectable()
export class ServiceEntitlementGuard implements CanActivate {
  private readonly logger = new Logger(ServiceEntitlementGuard.name);
  private readonly reflector: Reflector;

  constructor(
    @Optional() @Inject(Reflector) reflector?: Reflector,
    @Optional() @Inject(ServiceEntitlementService) private readonly serviceEntitlements?: ServiceEntitlementService,
    @Optional() @Inject(TenantContextService) private readonly tenantContext?: TenantContextService,
    @Optional() @Inject(JwtService) private readonly jwtService?: JwtService,
  ) {
    this.reflector = reflector || new Reflector();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    // 1. Determine target microservice
    // Check reflector decorator first (@RequiresService)
    const metadata = this.reflector.getAllAndOverride<RequiresServiceMetadata | undefined>(
      REQUIRES_SERVICE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    const fullPath = (req.baseUrl ? req.baseUrl + req.path : req.path || req.url || '') || '';
    const targetService: MicroserviceId | null =
      metadata?.serviceId || resolveMicroserviceFromPath(fullPath);

    // If route doesn't belong to any microservice perimeter, let it pass
    if (!targetService) {
      return true;
    }

    // 2. Resolve user, role, and tenantId
    const { tenantId, userId, role } = this.resolveUserContext(req);

    // Bypass check for SUPER_ADMIN
    if ((role as string) === 'SUPER_ADMIN') {
      this.logger.debug?.(`SUPER_ADMIN bypass for service=${targetService} tenant=${tenantId}`);
      this.injectGatewayHeaders(req, res, {
        tenantId: tenantId || 'system',
        userId: userId || 'super-admin',
        role: 'SUPER_ADMIN',
        planTier: 'ENTERPRISE',
        entitledServices: [
          'core',
          'hrm',
          'erp',
          'crm',
          'wms',
          'workspace',
          'analytics',
          'governance',
        ],
      });
      return true;
    }

    // Core service is foundational: if no tenant context is present, let public endpoints through
    if (targetService === 'core' && !tenantId) {
      return true;
    }

    // Restricted microservice requires valid tenant context
    if (!tenantId) {
      throw new UnauthorizedException('Authentication and tenant context required');
    }

    if (!this.serviceEntitlements) {
      return true;
    }

    // 3. Resolve Tenant Access Context
    const accessContext = await this.serviceEntitlements.getAccessContext(tenantId, {
      userId,
      role,
    });

    // 4. Evaluate access using pure business rule from @omyxia/shared-types
    const decision = this.serviceEntitlements.evaluate(accessContext, targetService);

    if (!decision.allowed) {
      if (metadata?.options?.soft) {
        this.logger.warn(
          `[soft-gate] Tenant ${tenantId} denied access to ${targetService} (${decision.reason}) but allowed via soft mode`,
        );
        return true;
      }

      throw new ServiceForbiddenException(decision);
    }

    // 5. Allowed: Inject trusted gateway ingress headers
    this.injectGatewayHeaders(req, res, {
      tenantId: accessContext.tenantId,
      userId: accessContext.userId,
      role: accessContext.role,
      planTier: accessContext.planTier,
      entitledServices: accessContext.entitledServices,
    });

    return true;
  }

  private resolveUserContext(req: Request): {
    tenantId?: string;
    userId?: string;
    role?: TenantRole | 'SUPER_ADMIN' | string;
  } {
    // 1. From req.user
    const user = (req as any).user;
    if (user) {
      return {
        tenantId: user.activeTenantId || user.tenantId,
        userId: user.sub || user.userId || user.id,
        role: user.role,
      };
    }

    // 2. From TenantContextService
    const storedContext = this.tenantContext?.get?.();
    if (storedContext?.tenantId) {
      return {
        tenantId: storedContext.tenantId,
        userId: storedContext.userId,
        role: storedContext.role as TenantRole,
      };
    }

    // 3. From incoming Authorization header
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ') && this.jwtService) {
      try {
        const token = authHeader.substring(7);
        const decoded = this.jwtService.verify(token);
        (req as any).user = decoded;
        return {
          tenantId: decoded.activeTenantId || decoded.tenantId,
          userId: decoded.sub,
          role: decoded.role,
        };
      } catch {
        // invalid token
      }
    }

    // 4. From custom headers (e.g. gateway ingress or internal proxy)
    const headerTenantId = req.headers?.['x-tenant-id'] as string;
    const headerUserId = req.headers?.['x-user-id'] as string;
    const headerRole = req.headers?.['x-user-role'] as TenantRole;

    if (headerTenantId) {
      return {
        tenantId: headerTenantId,
        userId: headerUserId,
        role: headerRole,
      };
    }

    return {};
  }

  private injectGatewayHeaders(
    req: Request,
    res: Response | undefined,
    data: {
      tenantId: string;
      userId: string;
      role: string;
      planTier: string;
      entitledServices: string[];
    },
  ) {
    const traceId = (req.headers?.['x-trace-id'] ||
      req.headers?.['x-request-id'] ||
      randomUUID()) as string;

    if (req.headers) {
      req.headers['x-tenant-id'] = data.tenantId;
      req.headers['x-user-id'] = data.userId;
      req.headers['x-user-role'] = data.role;
      req.headers['x-tenant-plan'] = data.planTier;
      req.headers['x-entitled-services'] = data.entitledServices.join(',');
      req.headers['x-trace-id'] = traceId;
    }

    if (res && typeof res.setHeader === 'function') {
      res.setHeader('x-tenant-id', data.tenantId);
      res.setHeader('x-trace-id', traceId);
    }
  }
}
