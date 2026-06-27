import { Injectable } from '@nestjs/common';
import { TenantScopedService } from './base.service';

@Injectable()
export class WmsService extends TenantScopedService {
  async listWarehouses() {
    return this.prisma.warehouse.findMany({ where: { tenantId: this.getTenantId() } });
  }

  async createWarehouse(data: any) {
    return this.prisma.warehouse.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async listInventory(warehouseId?: string) {
    return this.prisma.inventoryItem.findMany({
      where: {
        tenantId: this.getTenantId(),
        ...(warehouseId && { warehouseId }),
      },
    });
  }

  async createItem(data: any) {
    return this.prisma.inventoryItem.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async recordMovement(data: { itemId: string; type: string; quantity: number; unitCost?: number }) {
    return this.prisma.stockMovement.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }
}