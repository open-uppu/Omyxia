import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: string;
}

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run(context: TenantContext, callback: () => any) {
    return this.storage.run(context, callback);
  }

  get(): TenantContext | undefined {
    return this.storage.getStore();
  }

  getTenantId(): string | undefined {
    return this.get()?.tenantId;
  }

  getUserId(): string | undefined {
    return this.get()?.userId;
  }

  getRole(): string | undefined {
    return this.get()?.role;
  }
}