import { HttpException, HttpStatus } from '@nestjs/common';
import type { MicroserviceId, ServiceAccessDecision } from '@omyxia/shared-types';

export interface ServiceForbiddenPayload {
  statusCode: number;
  error: string;
  message: string;
  serviceId: MicroserviceId;
  tenantId: string;
  reason: string;
  requiredFeatures: string[];
  requiredFeature?: string;
  upgradeUrl: string;
}

export class ServiceForbiddenException extends HttpException {
  constructor(decision: ServiceAccessDecision, messageOverride?: string) {
    const isSuspended = decision.reason === 'TENANT_SUSPENDED';
    const message =
      messageOverride ||
      (isSuspended
        ? 'Tenant account is suspended'
        : `Tenant is not entitled to use the '${decision.serviceId}' microservice`);

    const payload: ServiceForbiddenPayload = {
      statusCode: HttpStatus.FORBIDDEN,
      error: 'Forbidden',
      message,
      serviceId: decision.serviceId,
      tenantId: decision.tenantId,
      reason: decision.reason || 'SERVICE_NOT_ENTITLED',
      requiredFeatures: decision.requiredFeatures || [],
      requiredFeature: decision.requiredFeatures?.[0] || undefined,
      upgradeUrl: decision.upgradeUrl || `/admin/plans?highlight=${decision.serviceId}`,
    };

    super(payload, HttpStatus.FORBIDDEN);
  }

  getPayload(): ServiceForbiddenPayload {
    return this.getResponse() as ServiceForbiddenPayload;
  }
}
