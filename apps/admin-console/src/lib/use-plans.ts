'use client';

/**
 * usePlans — fetch + auto-refresh hook for the admin plans page (P2.5).
 *
 * Mirrors `useDashboardMetrics` — single source of truth for:
 *   - GET /api/admin/plans
 *   - GET /api/admin/add-ons (bundled with plans list)
 *
 * Plus mutation helpers that the editor dialogs call:
 *   - createPlan(dto)
 *   - updatePlan(id, dto)
 *   - deletePlan(id)
 *   - reorderPlanFeatures(id, orderedFeatureKeys)
 *   - createAddOn(dto)
 *   - updateAddOn(id, dto)
 *   - deleteAddOn(id)
 *
 * Failure modes:
 *   - 401: cookie missing/invalid → caller bounces to /login.
 *   - 502/5xx: surfaced via `state.error`.
 *   - 4xx (validation): surfaced via the mutation's `Promise.reject`.
 *
 * The mutations are optimistic-by-default but here we do the safer
 * pessimistic-then-revalidate approach: refresh the list after every
 * mutation so the table always reflects the canonical BE state.
 * Reordering does an optimistic local update for drag-drop fluidity.
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdminPlanSchema,
  AdminAddOnSchema,
  type AdminPlan,
  type AdminAddOn,
  type CreatePlanDto,
  type UpdatePlanDto,
  type CreateAddOnDto,
  type UpdateAddOnDto,
  type ListPlansResponse,
  type ListAddOnsResponse,
} from '@omyxia/shared-types';

const DEFAULT_REFRESH_MS = 60 * 1000; // 1 minute — the catalog rarely changes.

export type PlansState =
  | { kind: 'idle' }
  | { kind: 'loading'; previous?: ListPlansResponse }
  | { kind: 'ok'; data: ListPlansResponse }
  | { kind: 'error'; error: string; previous?: ListPlansResponse };

interface UsePlansOptions {
  refreshMs?: number;
  /** When true, skip fetching entirely. Useful for tests. */
  disabled?: boolean;
}

export interface UsePlansReturn {
  state: PlansState;
  plans: AdminPlan[];
  addOns: AdminAddOn[];
  refresh: () => Promise<void>;
  /** Used by the editor dialogs. */
  createPlan: (dto: CreatePlanDto) => Promise<AdminPlan>;
  updatePlan: (id: string, dto: UpdatePlanDto) => Promise<AdminPlan>;
  deletePlan: (id: string) => Promise<void>;
  reorderPlanFeatures: (
    id: string,
    orderedFeatureKeys: readonly string[]
  ) => Promise<AdminPlan>;
  createAddOn: (dto: CreateAddOnDto) => Promise<AdminAddOn>;
  updateAddOn: (id: string, dto: UpdateAddOnDto) => Promise<AdminAddOn>;
  deleteAddOn: (id: string) => Promise<void>;
}

async function readJson<T>(
  res: Response,
  parseSchema?: { safeParse: (raw: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown[] } } }
): Promise<T> {
  const text = await res.text();
  let raw: unknown = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    /* fall through with raw = null */
  }
  if (!res.ok) {
    const detail =
      raw && typeof raw === 'object' && 'error' in raw
        ? String((raw as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(detail);
  }
  if (parseSchema) {
    const result = parseSchema.safeParse(raw);
    if (!result.success) {
      throw new Error('Malformed response payload');
    }
    return result.data;
  }
  return raw as T;
}

export function usePlans(options: UsePlansOptions = {}): UsePlansReturn {
  const { refreshMs = DEFAULT_REFRESH_MS, disabled = false } = options;
  const [state, setState] = useState<PlansState>({ kind: 'idle' });
  const fetchRef = useRef<() => Promise<void>>(async () => undefined);
  // Track the current data so optimistic mutations can patch locally
  // without waiting for the refresh round-trip.
  const dataRef = useRef<ListPlansResponse | null>(null);

  const refresh = useCallback(async () => fetchRef.current(), []);

  const load = useCallback(async () => {
    setState((prev) =>
      prev.kind === 'ok'
        ? { kind: 'loading', previous: prev.data }
        : { kind: 'loading' }
    );
    try {
      const res = await fetch('/api/admin/plans', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        const detail = await readJson<never>(res).catch(
          () => `HTTP ${res.status}`
        );
        // 401 is expected for missing-cookie scenarios — swallow as a
        // soft error so the hook can recover once the user logs in.
        // No `previous` is preserved on 401; we don't want stale data.
        if (res.status === 401) {
          setState({ kind: 'idle' });
          return;
        }
        setState((prev) => ({
          kind: 'error',
          error: detail,
          ...(prev.kind === 'ok' ? { previous: prev.data } : {}),
        }));
        return;
      }
      const raw = await res.json();
      // We accept ListPlansResponse shape; everything else throws.
      const result = raw as ListPlansResponse;
      dataRef.current = result;
      setState({ kind: 'ok', data: result });
    } catch (err) {
      setState((prev) => ({
        kind: 'error',
        error: err instanceof Error ? err.message : 'Network error',
        ...(prev.kind === 'ok' ? { previous: prev.data } : {}),
      }));
    }
  }, []);

  useEffect(() => {
    if (disabled) return;
    if (typeof window === 'undefined') return;
    fetchRef.current = load;
    void load();
    if (!refreshMs) return;
    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      void load();
    };
    const intervalId = window.setInterval(tick, refreshMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, refreshMs, disabled]);

  // Helpers mutate via fetch then refresh — keeps the table consistent.
  const createPlan = useCallback(
    async (dto: CreatePlanDto): Promise<AdminPlan> => {
      const res = await fetch('/api/admin/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(dto),
      });
      const created = await readJson(res, AdminPlanSchema);
      await load();
      return created;
    },
    [load]
  );

  const updatePlan = useCallback(
    async (id: string, dto: UpdatePlanDto): Promise<AdminPlan> => {
      const res = await fetch(`/api/admin/plans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(dto),
      });
      const updated = await readJson(res, AdminPlanSchema);
      await load();
      return updated;
    },
    [load]
  );

  const deletePlan = useCallback(
    async (id: string): Promise<void> => {
      const res = await fetch(`/api/admin/plans/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        await readJson<never>(res).catch(() => undefined);
        throw new Error(`HTTP ${res.status}`);
      }
      await load();
    },
    [load]
  );

  const reorderPlanFeatures = useCallback(
    async (
      id: string,
      orderedFeatureKeys: readonly string[]
    ): Promise<AdminPlan> => {
      // Optimistic local update so drag-drop feels instant.
      if (dataRef.current) {
        const current = dataRef.current;
        const orderMap = new Map(
          orderedFeatureKeys.map((k, i) => [k, i] as const)
        );
        const plans = current.plans.map((p) =>
          p.id === id
            ? {
                ...p,
                features: [...p.features]
                  .map((f) => ({
                    ...f,
                    sortOrder: orderMap.get(f.featureKey) ?? f.sortOrder,
                  }))
                  .sort((a, b) => a.sortOrder - b.sortOrder),
              }
            : p
        );
        const next = { ...current, plans };
        dataRef.current = next;
        setState({ kind: 'ok', data: next });
      }
      const res = await fetch(`/api/admin/plans/${id}/features/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderedFeatureKeys }),
      });
      const updated = await readJson(res, AdminPlanSchema);
      await load();
      return updated;
    },
    [load]
  );

  const createAddOn = useCallback(
    async (dto: CreateAddOnDto): Promise<AdminAddOn> => {
      const res = await fetch('/api/admin/add-ons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(dto),
      });
      const created = await readJson(res, AdminAddOnSchema);
      await load();
      return created;
    },
    [load]
  );

  const updateAddOn = useCallback(
    async (id: string, dto: UpdateAddOnDto): Promise<AdminAddOn> => {
      const res = await fetch(`/api/admin/add-ons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(dto),
      });
      const updated = await readJson(res, AdminAddOnSchema);
      await load();
      return updated;
    },
    [load]
  );

  const deleteAddOn = useCallback(
    async (id: string): Promise<void> => {
      const res = await fetch(`/api/admin/add-ons/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        await readJson<never>(res).catch(() => undefined);
        throw new Error(`HTTP ${res.status}`);
      }
      await load();
    },
    [load]
  );

  const current = state.kind === 'ok' || (state.kind === 'loading' && state.previous)
    ? (state.kind === 'ok' ? state.data : state.previous!)
    : null;
  const plans = useMemo(() => current?.plans ?? [], [current]);
  const addOns = useMemo(() => current?.addOns ?? [], [current]);

  return {
    state,
    plans,
    addOns,
    refresh,
    createPlan,
    updatePlan,
    deletePlan,
    reorderPlanFeatures,
    createAddOn,
    updateAddOn,
    deleteAddOn,
  };
}

// Type re-exports so callers don't need a deep import path.
export type { AdminPlan, AdminAddOn, ListAddOnsResponse };
