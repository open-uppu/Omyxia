/**
 * RolesGuard — enforces role-based access control on decorated endpoints.
 *
 * Behavior:
 * 1. If no @Roles() decorator is present, the endpoint is public within an
 *    authenticated tenant — it only requires tenant context, not role checks.
 *    (Auth itself is enforced by JWT middleware.)
 * 2. If @Roles(...) is present, the JWT role must be in the allowed set.
 * 3. SUPER_ADMIN always passes any @Roles() gate.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_METADATA_KEY } from './roles.decorator';
import { Role, isRole, coerceRole } from './roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true; // no role restriction declared
    }

    const req = context.switchToHttp().getRequest();
    const rawRole = req?.user?.role;
    if (!rawRole) {
      throw new ForbiddenException('No role on token');
    }
    const role = coerceRole(rawRole);

    if (role === 'SUPER_ADMIN') return true;
    if (!isRole(rawRole)) {
      throw new ForbiddenException(`Unknown role: ${String(rawRole)}`);
    }
    if (required.includes(role)) return true;
    throw new ForbiddenException(
      `Role ${role} not permitted. Required: ${required.join(', ')}`,
    );
  }
}