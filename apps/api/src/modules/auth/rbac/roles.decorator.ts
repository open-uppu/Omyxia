/**
 * @Roles() — decorator that lists allowed roles for an endpoint.
 * Read by RolesGuard. Use in combination with the global RolesGuard.
 */
import { SetMetadata } from '@nestjs/common';
import type { Role } from './roles';

export const ROLES_METADATA_KEY = 'rbac:roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_METADATA_KEY, roles);