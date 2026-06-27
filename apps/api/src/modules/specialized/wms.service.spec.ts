import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WmsService } from './wms.service';

describe('WmsService', () => {
  let service: WmsService;
  let prisma: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      warehouse: {
        findMany: vi.fn().mockResolvedValue([{ id: 'wh-1', name: 'Main' }]),
        create: vi.fn().mockResolvedValue({ id: 'wh-2', name: 'Secondary' }),
      },
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue([{ id: 'item-1', sku: 'SKU-1' }]),
        create: vi.fn().mockResolvedValue({ id: 'item-2', sku: 'SKU-2' }),
      },
      stockMovement: {
        create: vi.fn().mockResolvedValue({ id: 'mov-1', type: 'TRANSFER', quantity: 5 }),
      },
    };
    tenantContext = {
      getTenantId: vi.fn().mockReturnValue('tenant-1'),
      getUserId: vi.fn().mockReturnValue('user-1'),
    };
    service = new WmsService(prisma, tenantContext);
  });

  describe('listWarehouses', () => {
    it('should list warehouses scoped to the tenant', async () => {
      const result = await service.listWarehouses();

      expect(prisma.warehouse.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
      expect(result).toEqual([{ id: 'wh-1', name: 'Main' }]);
    });

    it('should throw when there is no tenant context', async () => {
      tenantContext.getTenantId.mockReturnValue(undefined);

      await expect(service.listWarehouses()).rejects.toThrow('No tenant context');
      expect(prisma.warehouse.findMany).not.toHaveBeenCalled();
    });
  });

  describe('createWarehouse', () => {
    it('should create a warehouse with the tenant id merged in', async () => {
      const data = { name: 'Secondary', location: 'Bangkok' };

      const result = await service.createWarehouse(data);

      expect(prisma.warehouse.create).toHaveBeenCalledWith({
        data: { name: 'Secondary', location: 'Bangkok', tenantId: 'tenant-1' },
      });
      expect(result).toEqual({ id: 'wh-2', name: 'Secondary' });
    });

    it('should throw when there is no tenant context', async () => {
      tenantContext.getTenantId.mockReturnValue(undefined);

      await expect(service.createWarehouse({ name: 'Secondary' })).rejects.toThrow(
        'No tenant context',
      );
      expect(prisma.warehouse.create).not.toHaveBeenCalled();
    });
  });

  // Adding inventory is handled by createItem on the WMS service.
  describe('addInventory (createItem)', () => {
    it('should create an inventory item with the tenant id merged in', async () => {
      const data = { sku: 'SKU-2', warehouseId: 'wh-1', quantity: 10 };

      const result = await service.createItem(data);

      expect(prisma.inventoryItem.create).toHaveBeenCalledWith({
        data: { sku: 'SKU-2', warehouseId: 'wh-1', quantity: 10, tenantId: 'tenant-1' },
      });
      expect(result).toEqual({ id: 'item-2', sku: 'SKU-2' });
    });

    it('should throw when there is no tenant context', async () => {
      tenantContext.getTenantId.mockReturnValue(undefined);

      await expect(service.createItem({ sku: 'SKU-2' })).rejects.toThrow('No tenant context');
      expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
    });
  });

  // Moving stock is handled by recordMovement on the WMS service.
  describe('moveStock (recordMovement)', () => {
    it('should record a stock movement with the tenant id merged in', async () => {
      const data = { itemId: 'item-1', type: 'TRANSFER', quantity: 5, unitCost: 2.5 };

      const result = await service.recordMovement(data);

      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: {
          itemId: 'item-1',
          type: 'TRANSFER',
          quantity: 5,
          unitCost: 2.5,
          tenantId: 'tenant-1',
        },
      });
      expect(result).toEqual({ id: 'mov-1', type: 'TRANSFER', quantity: 5 });
    });

    it('should throw when there is no tenant context', async () => {
      tenantContext.getTenantId.mockReturnValue(undefined);

      await expect(
        service.recordMovement({ itemId: 'item-1', type: 'TRANSFER', quantity: 5 }),
      ).rejects.toThrow('No tenant context');
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });
  });
});
