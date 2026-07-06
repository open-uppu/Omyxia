/**
 * omyxia v2.0.0 P4.2 — UsageCollectorService tests.
 *
 * Strategy: drive the collector with an in-memory Prisma stub. The
 * service should write rows to the stub and read them back; we assert
 * the shape of those calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageCollectorService } from './usage-collector.service';
import { Prisma } from '@prisma/client';

interface EventRow {
  id: string;
  tenantId: string;
  userId: string | null;
  meter: string;
  quantity: string;
  source: string;
  metadata: unknown;
  occurredAt: Date;
  aggregatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DailyRow {
  id: string;
  tenantId: string;
  meter: string;
  usageDate: Date;
  quantity: string;
  breakdown: unknown;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

function mkPrismaStub() {
  const events: EventRow[] = [];
  const dailies: DailyRow[] = [];
  let eventCounter = 0;
  let dailyCounter = 0;

  const findUniqueDaily = vi.fn(async (args: { where: { idempotencyKey: string } }) => {
    return dailies.find((d) => d.idempotencyKey === args.where.idempotencyKey) ?? null;
  });

  const createEvent = vi.fn(async (args: { data: Omit<EventRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
    eventCounter += 1;
    const now = new Date();
    const row: EventRow = {
      id: `event-${eventCounter}`,
      createdAt: now,
      updatedAt: now,
      ...args.data,
    };
    events.push(row);
    return row;
  });

  const updateDaily = vi.fn(async (args: { where: { idempotencyKey: string }; data: Partial<DailyRow> }) => {
    const idx = dailies.findIndex((d) => d.idempotencyKey === args.where.idempotencyKey);
    if (idx < 0) throw new Error('not found');
    dailies[idx] = { ...dailies[idx], ...args.data };
    return dailies[idx];
  });

  const createDaily = vi.fn(async (args: { data: Omit<DailyRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
    dailyCounter += 1;
    const now = new Date();
    const row: DailyRow = {
      id: `daily-${dailyCounter}`,
      createdAt: now,
      updatedAt: now,
      ...args.data,
    };
    dailies.push(row);
    return row;
  });

  return {
    prisma: {
      tenantUsageEvent: {
        create: createEvent,
        findMany: vi.fn(async (args: { where?: { tenantId?: string; meter?: any; occurredAt?: { gte?: Date; lt?: Date } }; select?: any; take?: number; orderBy?: any } = {}) => {
          let rows = events;
          if (args.where?.tenantId) rows = rows.filter((r) => r.tenantId === args.where!.tenantId);
          if (args.where?.meter) rows = rows.filter((r) => r.meter === args.where!.meter);
          if (args.where?.occurredAt?.gte) rows = rows.filter((r) => r.occurredAt >= args.where!.occurredAt!.gte!);
          if (args.where?.occurredAt?.lt) rows = rows.filter((r) => r.occurredAt < args.where!.occurredAt!.lt!);
          const taken = args.take ? rows.slice(0, args.take) : rows;
          return taken.map((r) => ({ id: r.id, ...args.select && (() => {
            const out: any = {};
            for (const k of Object.keys(args.select)) out[k] = (r as any)[k];
            return out;
          })() }));
        }),
        findManyRaw: vi.fn(async () => events),
        updateMany: vi.fn(async () => ({ count: 0 })),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      tenantUsageDaily: {
        findUnique: findUniqueDaily,
        findMany: vi.fn(async (args: { where?: any; orderBy?: any; select?: any } = {}) => {
          let rows = dailies;
          if (args.where?.tenantId) rows = rows.filter((d) => d.tenantId === args.where.tenantId);
          if (args.where?.meter) rows = rows.filter((d) => d.meter === args.where.meter);
          if (args.where?.usageDate) {
            if (args.where.usageDate.gte) rows = rows.filter((d) => d.usageDate >= args.where.usageDate.gte);
            if (args.where.usageDate.lte) rows = rows.filter((d) => d.usageDate <= args.where.usageDate.lte);
          }
          return rows;
        }),
        create: createDaily,
        update: updateDaily,
        upsert: vi.fn(async (args: { where: { idempotencyKey: string }; create: any; update: any }) => {
          const existing = dailies.find((d) => d.idempotencyKey === args.where.idempotencyKey);
          if (existing) {
            Object.assign(existing, args.update);
            return existing;
          }
          return createDaily({ data: args.create });
        }),
      },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => {
        return Promise.all(ops);
      }),
    } as any,
    state: { events, dailies, createEvent, createDaily, updateDaily, findUniqueDaily },
  };
}

describe('UsageCollectorService', () => {
  let stub: ReturnType<typeof mkPrismaStub>;
  let svc: UsageCollectorService;

  beforeEach(() => {
    stub = mkPrismaStub();
    svc = new UsageCollectorService(stub.prisma);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recordEvent', () => {
    it('writes the event row and flushes the daily rollup', async () => {
      const row = await svc.recordEvent({
        tenantId: 't1',
        meter: 'API_CALL_COUNT',
        quantity: '1',
        source: 'api_request',
        userId: 'u1',
      });

      expect(stub.state.createEvent).toHaveBeenCalledOnce();
      expect(stub.state.createDaily).toHaveBeenCalledOnce();
      expect(row.tenantId).toBe('t1');
      expect(row.meter).toBe('API_CALL_COUNT');
      expect(row.quantity).toBe('1');
    });

    it('rejects negative quantities', async () => {
      await expect(
        svc.recordEvent({
          tenantId: 't1',
          meter: 'API_CALL_COUNT',
          quantity: '-1',
          source: 'api_request',
        }),
      ).rejects.toThrow(/non-negative/);
    });

    it('rejects invalid meters', async () => {
      await expect(
        svc.recordEvent({
          tenantId: 't1',
          meter: 'INVALID_METER' as any,
          quantity: '1',
          source: 'api_request',
        }),
      ).rejects.toThrow(/invalid meter/);
    });

    it('rejects oversized metadata', async () => {
      const bigMeta = { blob: 'x'.repeat(5000) };
      await expect(
        svc.recordEvent({
          tenantId: 't1',
          meter: 'API_CALL_COUNT',
          quantity: '1',
          source: 'api_request',
          metadata: bigMeta,
        }),
      ).rejects.toThrow(/metadata exceeds/);
    });

    it('skips the daily flush when flush=false', async () => {
      await svc.recordEvent(
        {
          tenantId: 't1',
          meter: 'API_CALL_COUNT',
          quantity: '1',
          source: 'api_request',
        },
        { flush: false },
      );
      expect(stub.state.createEvent).toHaveBeenCalledOnce();
      expect(stub.state.createDaily).not.toHaveBeenCalled();
    });
  });

  describe('incrementDaily', () => {
    it('creates a daily row on first call', async () => {
      const dayStart = new Date('2026-06-15T00:00:00Z');
      const row = await svc.incrementDaily({
        tenantId: 't1',
        meter: 'API_CALL_COUNT',
        usageDate: dayStart,
        deltaQuantity: '5',
      });
      expect(row.tenantId).toBe('t1');
      expect(row.meter).toBe('API_CALL_COUNT');
      expect(row.quantity).toBe('5');
      expect(stub.state.createDaily).toHaveBeenCalledOnce();
    });

    it('sums multiple increments on the same day', async () => {
      const dayStart = new Date('2026-06-15T00:00:00Z');
      await svc.incrementDaily({
        tenantId: 't1',
        meter: 'API_CALL_COUNT',
        usageDate: dayStart,
        deltaQuantity: '5',
      });
      await svc.incrementDaily({
        tenantId: 't1',
        meter: 'API_CALL_COUNT',
        usageDate: dayStart,
        deltaQuantity: '3',
      });
      const last = await svc.incrementDaily({
        tenantId: 't1',
        meter: 'API_CALL_COUNT',
        usageDate: dayStart,
        deltaQuantity: '2',
      });
      expect(last.quantity).toBe('10');
      expect(stub.state.createDaily).toHaveBeenCalledOnce();
      expect(stub.state.updateDaily).toHaveBeenCalledTimes(2);
    });

    it('truncates the timestamp to UTC midnight', async () => {
      const oddDate = new Date('2026-06-15T15:30:00Z');
      const row = await svc.incrementDaily({
        tenantId: 't1',
        meter: 'API_CALL_COUNT',
        usageDate: oddDate,
        deltaQuantity: '1',
      });
      expect(row.usageDate).toBe('2026-06-15');
    });
  });

  describe('pruneOldEvents', () => {
    it('rejects invalid beforeDate', async () => {
      await expect(
        svc.pruneOldEvents({ beforeDate: 'not-a-date' }),
      ).rejects.toThrow(/invalid beforeDate/);
    });

    it('returns 0/0 when no rows match', async () => {
      const result = await svc.pruneOldEvents({
        beforeDate: '2026-06-15',
        limit: 100,
      });
      expect(result).toEqual({ scanned: 0, deleted: 0, beforeDate: '2026-06-15' });
    });
  });

  describe('listDaily', () => {
    it('returns parsed rows', async () => {
      await svc.incrementDaily({
        tenantId: 't1',
        meter: 'STORAGE_GB_HOURS',
        usageDate: new Date('2026-06-15T00:00:00Z'),
        deltaQuantity: '1.5',
      });
      const rows = await svc.listDaily({
        tenantId: 't1',
        meter: 'STORAGE_GB_HOURS',
      });
      expect(rows.length).toBe(1);
      expect(rows[0].quantity).toBe('1.5');
    });
  });
});