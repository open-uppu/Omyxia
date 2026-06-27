import { Injectable } from '@nestjs/common';
import { TenantScopedService } from './base.service';

@Injectable()
export class FmsService extends TenantScopedService {
  async listVehicles() {
    return this.prisma.vehicle.findMany({ where: { tenantId: this.getTenantId() } });
  }

  async createVehicle(data: any) {
    return this.prisma.vehicle.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async listTrips(vehicleId?: string) {
    return this.prisma.vehicleTrip.findMany({
      where: { tenantId: this.getTenantId(), ...(vehicleId && { vehicleId }) },
      orderBy: { startAt: 'desc' },
    });
  }

  async startTrip(data: any) {
    return this.prisma.vehicleTrip.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async endTrip(id: string, endAt: Date, distance: number, fuelUsed: number) {
    return this.prisma.vehicleTrip.update({
      where: { id },
      data: { endAt, distance, fuelUsed },
    });
  }
}