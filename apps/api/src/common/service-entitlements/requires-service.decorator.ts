import { SetMetadata } from '@nestjs/common';
import type { MicroserviceId, TenantRole } from '@omyxia/shared-types';

export const REQUIRES_SERVICE_METADATA_KEY = 'omyxia:requires_service';

export interface RequiresServiceOptions {
  soft?: boolean;
  bypassRoles?: TenantRole[];
}

export interface RequiresServiceMetadata {
  serviceId: MicroserviceId;
  options?: RequiresServiceOptions;
}

/**
 * Decorator to declare that a controller or endpoint belongs to a specific Microservice perimeter.
 *
 * @example
 * ```ts
 * @Controller('journals')
 * @RequiresService('erp')
 * export class JournalController {}
 * ```
 */
export const RequiresService = (
  serviceId: MicroserviceId,
  options?: RequiresServiceOptions,
) => SetMetadata(REQUIRES_SERVICE_METADATA_KEY, { serviceId, options });
