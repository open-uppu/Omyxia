// @vitest-environment jsdom
//
// Tests for EntitlementsProvider + useFeature + useLimit + FeatureGuard
// (P3.2).
//
// We mock `fetch` globally (vitest.setup.ts already does this). Each
// test seeds `globalThis.fetch` with a stub that returns the payload
// it wants the provider to see.
//
// We also stub `next/navigation`'s `useRouter` / `usePathname` so the
// guard tests don't need the Next router runtime.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  render,
  screen,
  waitFor,
  act,
  renderHook,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ---- Router mock ---------------------------------------------------------
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/plans',
  useSearchParams: () => new URLSearchParams(),
}));

// ---- Helpers -------------------------------------------------------------
import {
  EntitlementsProvider,
  useEntitlements,
  useFeature,
  useFeatureWithMeta,
  useAnyFeature,
  useLimit,
  useLimitWithMeta,
  useLimitUsage,
  useLimitStatus,
  FeatureGuard,
  Entitled,
  navigateToUpgrade,
} from './index';
import type { Entitlements } from '@omyxia/shared-types';

function makeEntitlements(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    tenantId: 't-test',
    plan: 'PRO',
    planLabel: 'Pro',
    generatedAt: '2026-07-05T12:00:00.000Z',
    features: {
      'module.email': true,
      'module.chat': true,
      'module.hr': true,
      'module.crm': true,
      'admin.tenants': true,
      'admin.plans': true,
      'admin.audit': false,
    },
    limits: {
      'limit.maxUsers': 25,
      'limit.maxStorageGB': 100,
    },
    usage: {
      'limit.maxUsers': 12,
      'limit.maxStorageGB': 42,
    },
    ...overrides,
  };
}

function mockFetchOk(payload: Entitlements) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function mockFetchError(status: number, body: unknown = {}) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status })
  );
}

beforeEach(() => {
  replaceMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// EntitlementsProvider
// ---------------------------------------------------------------------------

describe('EntitlementsProvider', () => {
  it('fetches /api/entitlements/me on mount and hydrates state', async () => {
    const payload = makeEntitlements();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(payload), { status: 200 })
      );

    const { result } = renderHook(
      () => useEntitlements(),
      {
        wrapper: ({ children }) => (
          <EntitlementsProvider>{children}</EntitlementsProvider>
        ),
      }
    );

    // First read: idle / loading
    expect(result.current.state.kind).toMatch(/idle|loading/);
    expect(result.current.hasLoaded).toBe(false);

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ok');
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe('/api/entitlements/me');
    expect(calledInit.method).toBe('GET');
    expect((calledInit.headers as Record<string, string>).Accept).toContain(
      'json'
    );
    expect(result.current.entitlements?.plan).toBe('PRO');
    expect(result.current.hasLoaded).toBe(true);
  });

  it('honours a custom endpoint (tests/storybook override)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeEntitlements()), { status: 200 })
      );
    renderHook(() => useEntitlements(), {
      wrapper: ({ children }) => (
        <EntitlementsProvider endpoint="/custom/ent">
          {children}
        </EntitlementsProvider>
      ),
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect((fetchSpy.mock.calls[0] as [string])[0]).toBe('/custom/ent');
  });

  it('skips fetching when disabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useEntitlements(), {
      wrapper: ({ children }) => (
        <EntitlementsProvider disabled>{children}</EntitlementsProvider>
      ),
    });
    // Give the effect a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.state.kind).toBe('idle');
    expect(result.current.entitlements).toBeUndefined();
  });

  it('goes to error state on HTTP 502', async () => {
    mockFetchError(502, { error: 'upstream' });
    const { result } = renderHook(() => useEntitlements(), {
      wrapper: ({ children }) => (
        <EntitlementsProvider>{children}</EntitlementsProvider>
      ),
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.entitlements).toBeUndefined();
  });

  it('drops back to idle on HTTP 401 (session expired)', async () => {
    mockFetchError(401, { error: 'expired' });
    const { result } = renderHook(() => useEntitlements(), {
      wrapper: ({ children }) => (
        <EntitlementsProvider>{children}</EntitlementsProvider>
      ),
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('idle');
    });
    expect(result.current.hasLoaded).toBe(false);
  });

  it('goes to error state on a malformed payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ not: 'a real payload' }), { status: 200 })
    );
    const { result } = renderHook(() => useEntitlements(), {
      wrapper: ({ children }) => (
        <EntitlementsProvider>{children}</EntitlementsProvider>
      ),
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
    expect(
      (result.current.state as { error: string }).error
    ).toMatch(/malformed/i);
  });

  it('exposes a working refresh() that triggers a new fetch', async () => {
    mockFetchOk(makeEntitlements({ plan: 'PRO' }));
    const { result } = renderHook(() => useEntitlements(), {
      wrapper: ({ children }) => (
        <EntitlementsProvider>{children}</EntitlementsProvider>
      ),
    });
    await waitFor(() => expect(result.current.state.kind).toBe('ok'));
    expect(result.current.entitlements?.plan).toBe('PRO');

    mockFetchOk(makeEntitlements({ plan: 'ENTERPRISE' }));
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() =>
      expect(result.current.entitlements?.plan).toBe('ENTERPRISE')
    );
  });

  it('falls back to a no-op shape when used outside a provider', () => {
    const { result } = renderHook(() => useEntitlements());
    expect(result.current.state.kind).toBe('idle');
    expect(result.current.entitlements).toBeUndefined();
    expect(result.current.hasLoaded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useFeature
// ---------------------------------------------------------------------------

describe('useFeature', () => {
  function setupProvider(payload: Entitlements) {
    mockFetchOk(payload);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EntitlementsProvider>{children}</EntitlementsProvider>
    );
    return wrapper;
  }

  it('returns true for a present-and-true feature', async () => {
    const wrapper = setupProvider(makeEntitlements());
    const { result } = renderHook(() => useFeature('module.crm'), { wrapper });
    expect(result.current).toBe(false); // loading default
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('returns false for a present-but-false feature', async () => {
    const wrapper = setupProvider(makeEntitlements());
    const { result } = renderHook(() => useFeature('admin.audit'), { wrapper });
    await waitFor(() =>
      expect(result.current).toBe(false)
    );
  });

  it('returns false for an unknown feature key', async () => {
    const wrapper = setupProvider(makeEntitlements());
    const { result } = renderHook(
      () => useFeature('module.unknown-thing'),
      { wrapper }
    );
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('returns false while loading (no flash of granted access)', () => {
    // Don't mock fetch — let the provider stay in `loading`.
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EntitlementsProvider>{children}</EntitlementsProvider>
    );
    const { result } = renderHook(() => useFeature('module.crm'), { wrapper });
    expect(result.current).toBe(false);
  });

  it('useFeatureWithMeta exposes hasLoaded + isLoading', async () => {
    const wrapper = setupProvider(makeEntitlements());
    const { result } = renderHook(() => useFeatureWithMeta('admin.plans'), {
      wrapper,
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasLoaded).toBe(false);
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('useAnyFeature ORs over a set of keys', async () => {
    const wrapper = setupProvider(makeEntitlements());
    const { result } = renderHook(
      () => useAnyFeature(['module.erp', 'module.crm', 'admin.audit']),
      { wrapper }
    );
    await waitFor(() => expect(result.current).toBe(true));

    const wrapper2 = setupProvider(
      makeEntitlements({
        features: {
          'module.email': true,
          'module.crm': false,
          'module.erp': false,
          'admin.audit': false,
        },
      })
    );
    const { result: r2 } = renderHook(
      () => useAnyFeature(['module.erp', 'module.crm', 'admin.audit']),
      { wrapper: wrapper2 }
    );
    await waitFor(() => expect(r2.current).toBe(false));
  });

  it('returns false when used outside a provider (defensive default)', () => {
    const { result } = renderHook(() => useFeature('module.crm'));
    expect(result.current).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useLimit
// ---------------------------------------------------------------------------

describe('useLimit', () => {
  function setup(payload: Entitlements) {
    mockFetchOk(payload);
    return ({ children }: { children: React.ReactNode }) => (
      <EntitlementsProvider>{children}</EntitlementsProvider>
    );
  }

  it('returns the cap for a known limit', async () => {
    const wrapper = setup(makeEntitlements());
    const { result } = renderHook(() => useLimit('limit.maxUsers'), { wrapper });
    expect(result.current).toBeNull(); // loading default
    await waitFor(() => expect(result.current).toBe(25));
  });

  it('returns null for unlimited (ENTERPRISE)', async () => {
    const wrapper = setup(
      makeEntitlements({
        plan: 'ENTERPRISE',
        limits: { 'limit.maxUsers': null, 'limit.maxStorageGB': null },
      })
    );
    const { result } = renderHook(() => useLimit('limit.maxUsers'), { wrapper });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('returns null for unknown limit keys (defensive)', async () => {
    const wrapper = setup(makeEntitlements());
    const { result } = renderHook(
      () => useLimit('limit.unknown'),
      { wrapper }
    );
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('useLimitUsage returns the counter', async () => {
    const wrapper = setup(makeEntitlements());
    const { result } = renderHook(
      () => useLimitUsage('limit.maxUsers'),
      { wrapper }
    );
    await waitFor(() => expect(result.current).toBe(12));
  });

  it('useLimitStatus ok / near / full / unlimited', async () => {
    // ok
    const wOk = setup(makeEntitlements({ usage: { 'limit.maxUsers': 5 } }));
    const { result: rOk } = renderHook(
      () => useLimitStatus('limit.maxUsers'),
      { wrapper: wOk }
    );
    await waitFor(() => expect(rOk.current.kind).toBe('ok'));
    if (rOk.current.kind === 'ok') {
      expect(rOk.current.percent).toBe(20);
    }

    // near (>= 80%)
    const wNear = setup(makeEntitlements({ usage: { 'limit.maxUsers': 22 } }));
    const { result: rNear } = renderHook(
      () => useLimitStatus('limit.maxUsers'),
      { wrapper: wNear }
    );
    await waitFor(() => expect(rNear.current.kind).toBe('near'));
    if (rNear.current.kind === 'near') {
      expect(rNear.current.percent).toBe(88);
    }

    // full (>= limit)
    const wFull = setup(makeEntitlements({ usage: { 'limit.maxUsers': 25 } }));
    const { result: rFull } = renderHook(
      () => useLimitStatus('limit.maxUsers'),
      { wrapper: wFull }
    );
    await waitFor(() => expect(rFull.current.kind).toBe('full'));
    if (rFull.current.kind === 'full') {
      expect(rFull.current.percent).toBe(100);
    }

    // unlimited
    const wInf = setup(
      makeEntitlements({
        plan: 'ENTERPRISE',
        limits: { 'limit.maxUsers': null },
        usage: { 'limit.maxUsers': 128 },
      })
    );
    const { result: rInf } = renderHook(
      () => useLimitStatus('limit.maxUsers'),
      { wrapper: wInf }
    );
    await waitFor(() => expect(rInf.current.kind).toBe('unlimited'));
  });

  it('useLimitStatus → loading while the provider hydrates', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EntitlementsProvider>{children}</EntitlementsProvider>
    );
    const { result } = renderHook(() => useLimitStatus('limit.maxUsers'), {
      wrapper,
    });
    expect(result.current.kind).toBe('loading');
  });
});

// ---------------------------------------------------------------------------
// FeatureGuard / Entitled / navigateToUpgrade
// ---------------------------------------------------------------------------

describe('FeatureGuard', () => {
  beforeEach(() => mockFetchOk(makeEntitlements()));

  it('renders children when the feature is enabled', async () => {
    render(
      <EntitlementsProvider>
        <FeatureGuard feature="admin.plans" featureLabel="Plans">
          <div data-testid="child">PLANS PAGE</div>
        </FeatureGuard>
      </EntitlementsProvider>
    );
    expect(await screen.findByTestId('child')).toBeInTheDocument();
  });

  it('redirects to /upgrade when the feature is missing', async () => {
    render(
      <EntitlementsProvider>
        <FeatureGuard feature="admin.audit" featureLabel="Audit">
          <div data-testid="child">should-not-render</div>
        </FeatureGuard>
      </EntitlementsProvider>
    );
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    const target = replaceMock.mock.calls[0]?.[0] as string;
    expect(target).toMatch(/^\/upgrade\?/);
    expect(target).toContain('feature=admin.audit');
    expect(target).toContain('label=Audit');
    expect(target).toContain('from=%2Fplans');
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('renders children when feature is empty (no-op guard)', async () => {
    render(
      <EntitlementsProvider>
        <FeatureGuard feature="">
          <div data-testid="child">always</div>
        </FeatureGuard>
      </EntitlementsProvider>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('renders the fallback while loading / redirecting', () => {
    // Don't mock fetch — provider stays loading.
    render(
      <EntitlementsProvider>
        <FeatureGuard
          feature="admin.audit"
          fallback={<div data-testid="fallback">spinner</div>}
        >
          <div data-testid="child">should-not-show-yet</div>
        </FeatureGuard>
      </EntitlementsProvider>
    );
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('fails closed (redirects) when the provider errored', async () => {
    mockFetchError(502);
    render(
      <EntitlementsProvider>
        <FeatureGuard feature="admin.audit">
          <div data-testid="child">should-not-show</div>
        </FeatureGuard>
      </EntitlementsProvider>
    );
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('does NOT redirect while entitlements are still loading (race fix)', async () => {
    // Critical: on first paint the provider is still loading, so
    // useFeature returns its default `false`. The guard must wait for
    // the fetch to complete BEFORE deciding — otherwise every
    // navigation flashes to /upgrade and bounces back when the
    // payload arrives.
    render(
      <EntitlementsProvider>
        <FeatureGuard feature="admin.plans" featureLabel="Plans">
          <div data-testid="child">allowed</div>
        </FeatureGuard>
      </EntitlementsProvider>
    );
    // No fetch mock — provider stays loading. The child is NOT in the
    // DOM yet (fallback shown), and we MUST not have redirected.
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('redirects only AFTER hasLoaded once the feature is off', async () => {
    mockFetchOk(makeEntitlements({ features: { 'admin.audit': false } }));
    render(
      <EntitlementsProvider>
        <FeatureGuard feature="admin.audit">
          <div data-testid="child">blocked</div>
        </FeatureGuard>
      </EntitlementsProvider>
    );
    // After load: redirect fires.
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    const target = replaceMock.mock.calls[0]?.[0] as string;
    expect(target).toContain('feature=admin.audit');
  });
});

describe('Entitled', () => {
  it('renders children when feature is enabled', async () => {
    mockFetchOk(makeEntitlements());
    render(
      <EntitlementsProvider>
        <Entitled feature="admin.plans" fallback={<span>locked</span>}>
          <span data-testid="ok">OK</span>
        </Entitled>
      </EntitlementsProvider>
    );
    expect(await screen.findByTestId('ok')).toBeInTheDocument();
    expect(screen.queryByText('locked')).not.toBeInTheDocument();
  });

  it('renders fallback when feature is disabled', async () => {
    mockFetchOk(makeEntitlements());
    render(
      <EntitlementsProvider>
        <Entitled feature="admin.audit" fallback={<span>locked</span>}>
          <span data-testid="ok">OK</span>
        </Entitled>
      </EntitlementsProvider>
    );
    await waitFor(() => expect(screen.queryByText('locked')).toBeInTheDocument());
    expect(screen.queryByTestId('ok')).not.toBeInTheDocument();
  });

  it('renders children when feature is empty (no-op)', () => {
    render(
      <Entitled feature="" fallback={<span>locked</span>}>
        <span data-testid="ok">OK</span>
      </Entitled>
    );
    expect(screen.getByTestId('ok')).toBeInTheDocument();
    expect(screen.queryByText('locked')).not.toBeInTheDocument();
  });
});

describe('navigateToUpgrade', () => {
  it('builds a query string with feature + label + from', () => {
    expect(navigateToUpgrade('admin.audit', '/audit', 'Audit')).toBe(
      '/upgrade?feature=admin.audit&label=Audit&from=%2Faudit'
    );
  });

  it('omits missing fields cleanly', () => {
    expect(navigateToUpgrade('admin.audit', null)).toBe(
      '/upgrade?feature=admin.audit'
    );
    expect(navigateToUpgrade('admin.audit', null, 'Audit')).toBe(
      '/upgrade?feature=admin.audit&label=Audit'
    );
    expect(navigateToUpgrade('admin.audit', '/audit')).toBe(
      '/upgrade?feature=admin.audit&from=%2Faudit'
    );
  });

  it('handles an empty feature key (no params)', () => {
    expect(navigateToUpgrade('', '/x')).toBe('/upgrade?from=%2Fx');
  });
});

// ---------------------------------------------------------------------------
// Provider re-fetches after refresh()
// ---------------------------------------------------------------------------

describe('EntitlementsProvider.refresh()', () => {
  it('drives a fresh fetch and updates the snapshot', async () => {
    mockFetchOk(makeEntitlements({ plan: 'PRO' }));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EntitlementsProvider refreshMs={0}>{children}</EntitlementsProvider>
    );
    const { result } = renderHook(() => useEntitlements(), { wrapper });
    await waitFor(() => expect(result.current.entitlements?.plan).toBe('PRO'));

    mockFetchOk(makeEntitlements({ plan: 'ENTERPRISE' }));
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() =>
      expect(result.current.entitlements?.plan).toBe('ENTERPRISE')
    );
  });
});

// ---------------------------------------------------------------------------
// User-facing integration smoke (mirrors Sidebar wiring)
// ---------------------------------------------------------------------------

describe('Integration: feature-gated sidebar item', () => {
  it('hides an item when the feature is missing (PRO plan, no audit)', async () => {
    mockFetchOk(makeEntitlements()); // PRO has no admin.audit
    const user = userEvent.setup();
    render(
      <EntitlementsProvider>
        <ul>
          <Entitled feature="admin.tenants" fallback={null}>
            <li data-testid="nav-tenants">Tenants</li>
          </Entitled>
          <Entitled feature="admin.audit" fallback={null}>
            <li data-testid="nav-audit">Audit</li>
          </Entitled>
        </ul>
      </EntitlementsProvider>
    );
    expect(await screen.findByTestId('nav-tenants')).toBeInTheDocument();
    // Wait for the second <Entitled> to settle.
    await waitFor(() => {
      // After hydration, admin.audit is false on PRO → nav-audit must be gone.
      expect(screen.queryByTestId('nav-audit')).not.toBeInTheDocument();
    });
    // Sanity: clicking the tenants link doesn't blow up.
    await user.click(screen.getByTestId('nav-tenants'));
  });
});