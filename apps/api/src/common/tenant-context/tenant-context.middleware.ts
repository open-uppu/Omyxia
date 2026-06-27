import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    private readonly tenantContext: TenantContextService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);
    try {
      const payload = this.jwtService.verify(token);
      const context = {
        tenantId: payload.activeTenantId,
        userId: payload.sub,
        role: payload.role,
      };
      this.tenantContext.run(context, () => next());
    } catch (err) {
      return next();
    }
  }
}