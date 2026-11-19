import { Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { ServiceEntitlementService } from './service-entitlement.service';
import { ServiceForbiddenException } from './service-forbidden.exception';
import { resolveMicroserviceFromPath } from './service-resolver';
import { TenantContextService } from '../tenant-context/tenant-context.service';

@Injectable()
export class ServiceEntitlementMiddleware implements NestMiddleware {
  constructor(
    private readonly serviceEntitlements: ServiceEntitlementService,
    private readonly tenantContext: TenantContextService,
    @Optional() private readonly jwtService?: JwtService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const fullPath = (req.baseUrl || '') + (req.path || req.url || '');
    const targetService = resolveMicroserviceFromPath(fullPath);

    // If route doesn't belong to any registered microservice perimeter, continue
    if (!targetService) {
      return next();
    }

    // Resolve user context
    let tenantId = (req as any).user?.activeTenantId || (req as any).user?.tenantId;
    let userId = (req as any).user?.sub;
    let role = (req as any).user?.role;

    if (!tenantId) {
      const stored = this.tenantContext.get();
      if (stored) {
        tenantId = stored.tenantId;
        userId = stored.userId;
        role = stored.role;
      }
    }

    if (!tenantId && req.headers?.authorization?.startsWith('Bearer ') && this.jwtService) {
      try {
        const decoded = this.jwtService.verify(req.headers.authorization.substring(7));
        (req as any).user = decoded;
        tenantId = decoded.activeTenantId || decoded.tenantId;
        userId = decoded.sub;
        role = decoded.role;
      } catch {
        // invalid token
      }
    }

    if (!tenantId && req.headers?.['x-tenant-id']) {
      tenantId = req.headers['x-tenant-id'] as string;
      userId = req.headers['x-user-id'] as string;
      role = req.headers['x-user-role'] as string;
    }

    // Super admin bypass
    if (role === 'SUPER_ADMIN') {
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
      return next();
    }

    // Core foundational service allows unauthenticated access to public routes
    if (targetService === 'core' && !tenantId) {
      return next();
    }

    // Restricted microservice requires valid tenant
    if (!tenantId) {
      res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication and tenant context required',
      });
      return;
    }

    const accessContext = await this.serviceEntitlements.getAccessContext(tenantId, {
      userId,
      role,
    });

    const decision = this.serviceEntitlements.evaluate(accessContext, targetService);

    if (!decision.allowed) {
      const exception = new ServiceForbiddenException(decision);
      res.status(403).json(exception.getPayload());
      return;
    }

    // Ingress headers injection
    this.injectGatewayHeaders(req, res, {
      tenantId: accessContext.tenantId,
      userId: accessContext.userId,
      role: accessContext.role,
      planTier: accessContext.planTier,
      entitledServices: accessContext.entitledServices,
    });

    next();
  }

  private injectGatewayHeaders(
    req: Request,
    res: Response,
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
