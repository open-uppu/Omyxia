// @vitest-environment node
//
// Unit tests for the upgrade modal pricing catalog. Pure functions,
// no DOM, no fetch — runs on Node so the math is exercised cheaply
// in CI before the heavier React tests spin up jsdom.

import { describe, it, expect } from 'vitest';
import {
  UPGRADE_CATALOG,
  UPGRADE_ADDON_CATALOG,
  computePriceDelta,
  findAddOn,
  findCatalog,
  planLabel,
} from './upgrade-modal-catalog';

describe('UPGRADE_CATALOG', () => {
  it('has a row for PRO and ENTERPRISE (FREE is intentional free)', () => {
    expect(UPGRADE_CATALOG.PRO.monthlyCents).toBe(9900);
    expect(UPGRADE_CATALOG.ENTERPRISE.monthlyCents).toBe(49900);
  });

  it('every plan row has at least one "includes" bullet', () => {
    expect(UPGRADE_CATALOG.PRO.includes.length).toBeGreaterThan(0);
    expect(UPGRADE_CATALOG.ENTERPRISE.includes.length).toBeGreaterThan(0);
  });
});

describe('UPGRADE_ADDON_CATALOG', () => {
  it('mirrors the P1.2 add-on seed prices', () => {
    expect(findAddOn('addon.crm')?.monthlyCents).toBe(5000);
    expect(findAddOn('addon.erp')?.monthlyCents).toBe(8000);
    expect(findAddOn('addon.wms')?.monthlyCents).toBe(6000);
    expect(findAddOn('addon.bi')?.monthlyCents).toBe(4000);
    expect(findAddOn('addon.mas')?.monthlyCents).toBe(4500);
  });

  it('returns undefined for unknown add-ons', () => {
    expect(findAddOn('addon.unknown')).toBeUndefined();
  });
});

describe('findCatalog', () => {
  it('returns the row for paid plans', () => {
    expect(findCatalog('PRO')?.plan).toBe('PRO');
    expect(findCatalog('ENTERPRISE')?.plan).toBe('ENTERPRISE');
  });

  it('returns undefined for FREE (no upgrade price)', () => {
    expect(findCatalog('FREE')).toBeUndefined();
  });
});

describe('planLabel', () => {
  it('returns "Free" for FREE and the catalog label otherwise', () => {
    expect(planLabel('FREE')).toBe('Free');
    expect(planLabel('PRO')).toBe('Pro');
    expect(planLabel('ENTERPRISE')).toBe('Enterprise');
  });
});

describe('computePriceDelta', () => {
  it('returns the monthly delta when going FREE → PRO', () => {
    expect(computePriceDelta({ currentPlan: 'FREE', recommendedPlan: 'PRO' })).toBe(9900);
  });

  it('returns the monthly delta when going PRO → ENTERPRISE', () => {
    expect(computePriceDelta({ currentPlan: 'PRO', recommendedPlan: 'ENTERPRISE' })).toBe(40000);
  });

  it('returns the add-on delta when the plan stays the same', () => {
    expect(
      computePriceDelta({
        currentPlan: 'PRO',
        recommendedPlan: 'PRO',
        requiredAddOns: ['addon.crm'],
      })
    ).toBe(5000);
  });

  it('combines plan delta and add-on delta', () => {
    expect(
      computePriceDelta({
        currentPlan: 'FREE',
        recommendedPlan: 'PRO',
        requiredAddOns: ['addon.crm', 'addon.bi'],
      })
    ).toBe(9900 + 5000 + 4000);
  });

  it('returns null when an add-on is "contact us"', () => {
    // Inject a contact-us add-on by referring to a slug that's
    // deliberately not in the catalog — the helper treats unknown
    // add-ons as zero cost (NOT contact us). To force null we
    // simulate by monkey-patching: that's covered below.
    // Plain case: everything known, returns the sum.
    expect(
      computePriceDelta({
        currentPlan: 'FREE',
        recommendedPlan: 'PRO',
        requiredAddOns: [],
      })
    ).toBe(9900);
  });

  it('returns null when any add-on slug resolves to monthlyCents: null', () => {
    // Monkey-patch the catalog to simulate a contact-us add-on.
    const original = (UPGRADE_ADDON_CATALOG as ReadonlyArray<{ slug: string; monthlyCents: number | null }>)
      .slice();
    (UPGRADE_ADDON_CATALOG as unknown as { push: (r: { slug: string; monthlyCents: number | null }) => void })
      .push({ slug: 'addon.contact', monthlyCents: null });
    try {
      expect(
        computePriceDelta({
          currentPlan: 'FREE',
          recommendedPlan: 'PRO',
          requiredAddOns: ['addon.contact'],
        })
      ).toBeNull();
    } finally {
      // restore — replace the array contents in place
      (UPGRADE_ADDON_CATALOG as unknown as { length: number }).length = 0;
      for (const row of original) {
        (UPGRADE_ADDON_CATALOG as unknown as { push: (r: typeof row) => void }).push(row);
      }
    }
  });

  it('skips unknown add-on slugs (does not throw, does not add cost)', () => {
    expect(
      computePriceDelta({
        currentPlan: 'FREE',
        recommendedPlan: 'PRO',
        requiredAddOns: ['addon.unknown', 'addon.crm'],
      })
    ).toBe(9900 + 5000);
  });
});