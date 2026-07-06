import { describe, it, expect } from 'vitest';
import {
  AdminPlanSlugSchema,
  AdminTenantStatusSchema,
  AdminTenantRegionSchema,
  AdminTenantRowSchema,
  TenantListResponseSchema,
  AdminTenantFilterSchema,
  parseAdminTenantFilters,
  ADMIN_TENANT_PAGE_SIZE,
  ADMIN_TENANT_MAX_PAGE_SIZE,
} from './admin-tenants';

describe('admin-tenants wire format', () => {
  describe('enums', () => {
    it('AdminPlanSlugSchema accepts the documented three slugs', () => {
      expect(AdminPlanSlugSchema.parse('FREE')).toBe('FREE');
      expect(AdminPlanSlugSchema.parse('PRO')).toBe('PRO');
      expect(AdminPlanSlugSchema.parse('ENTERPRISE')).toBe('ENTERPRISE');
    });

    it('AdminPlanSlugSchema rejects unknown plan slugs', () => {
      expect(() => AdminPlanSlugSchema.parse('free')).toThrow();
      expect(() => AdminPlanSlugSchema.parse('STARTER')).toThrow();
      expect(() => AdminPlanSlugSchema.parse('LEGACY')).toThrow();
    });

    it('AdminTenantStatusSchema accepts ACTIVE/SUSPENDED/ARCHIVED', () => {
      expect(AdminTenantStatusSchema.parse('ACTIVE')).toBe('ACTIVE');
      expect(AdminTenantStatusSchema.parse('SUSPENDED')).toBe('SUSPENDED');
      expect(AdminTenantStatusSchema.parse('ARCHIVED')).toBe('ARCHIVED');
    });

    it('AdminTenantStatusSchema rejects deleted (legacy wording)', () => {
      expect(() => AdminTenantStatusSchema.parse('DELETED')).toThrow();
    });

    it('AdminTenantRegionSchema accepts eu/us/apac (lowercase)', () => {
      expect(AdminTenantRegionSchema.parse('eu')).toBe('eu');
      expect(AdminTenantRegionSchema.parse('us')).toBe('us');
      expect(AdminTenantRegionSchema.parse('apac')).toBe('apac');
    });

    it('AdminTenantRegionSchema rejects uppercase', () => {
      expect(() => AdminTenantRegionSchema.parse('EU')).toThrow();
      expect(() => AdminTenantRegionSchema.parse('APAC')).toThrow();
    });
  });

  describe('AdminTenantRowSchema', () => {
    const validRow = {
      id: 'ck1234',
      slug: 'acme',
      name: 'Acme Co',
      domain: 'acme.com',
      plan: 'PRO' as const,
      status: 'ACTIVE' as const,
      region: 'eu' as const,
      users: 17,
      storageBytes: 1024 * 1024 * 1024,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-07-06T12:00:00.000Z',
    };

    it('accepts a fully-populated row', () => {
      expect(() => AdminTenantRowSchema.parse(validRow)).not.toThrow();
    });

    it('accepts empty-string domain/region (NULL in DB)', () => {
      expect(() =>
        AdminTenantRowSchema.parse({ ...validRow, domain: '', region: '' }),
      ).not.toThrow();
    });

    it('rejects negative user counts', () => {
      expect(() =>
        AdminTenantRowSchema.parse({ ...validRow, users: -1 }),
      ).toThrow();
    });

    it('rejects non-integer user counts', () => {
      expect(() =>
        AdminTenantRowSchema.parse({ ...validRow, users: 1.5 }),
      ).toThrow();
    });

    it('rejects unknown plan slug', () => {
      expect(() =>
        AdminTenantRowSchema.parse({ ...validRow, plan: 'STARTER' }),
      ).toThrow();
    });
  });

  describe('TenantListResponseSchema', () => {
    const validEnvelope = {
      generatedAt: '2026-07-06T15:00:00.000Z',
      filters: {
        q: '',
        plan: [],
        status: [],
        region: [],
        page: 1,
        pageSize: ADMIN_TENANT_PAGE_SIZE,
      },
      items: [],
      total: 0,
      skip: 0,
      take: ADMIN_TENANT_PAGE_SIZE,
    };

    it('accepts an empty envelope', () => {
      expect(() => TenantListResponseSchema.parse(validEnvelope)).not.toThrow();
    });

    it('rejects negative skip', () => {
      expect(() =>
        TenantListResponseSchema.parse({ ...validEnvelope, skip: -1 }),
      ).toThrow();
    });
  });

  describe('parseAdminTenantFilters', () => {
    it('returns defaults for an empty URLSearchParams', () => {
      const r = parseAdminTenantFilters(new URLSearchParams(''));
      expect(r).toEqual({
        q: '',
        plan: [],
        status: [],
        region: [],
        page: 1,
        pageSize: ADMIN_TENANT_PAGE_SIZE,
      });
    });

    it('parses comma-separated plan list with case normalisation', () => {
      const r = parseAdminTenantFilters(new URLSearchParams('plan=free,pro,enterprise'));
      expect(r.plan).toEqual(['FREE', 'PRO', 'ENTERPRISE']);
    });

    it('silently drops invalid plan tokens', () => {
      const r = parseAdminTenantFilters(
        new URLSearchParams('plan=FREE,bogus,STARTER,PRO'),
      );
      // STARTER is the legacy DB enum; the wire format uses FREE/PRO/ENTERPRISE.
      // We expect STARTER to be dropped (no alias mapping in the parser).
      expect(r.plan).toEqual(['FREE', 'PRO']);
    });

    it('lowercases region tokens', () => {
      const r = parseAdminTenantFilters(new URLSearchParams('region=EU,Us,APAC'));
      expect(r.region).toEqual(['eu', 'us', 'apac']);
    });

    it('uppercases status tokens', () => {
      const r = parseAdminTenantFilters(
        new URLSearchParams('status=active,suspended,archived'),
      );
      expect(r.status).toEqual(['ACTIVE', 'SUSPENDED', 'ARCHIVED']);
    });

    it('parses page and pageSize from strings', () => {
      const r = parseAdminTenantFilters(
        new URLSearchParams('page=3&pageSize=50'),
      );
      expect(r.page).toBe(3);
      expect(r.pageSize).toBe(50);
    });

    it('clamps pageSize > MAX to the documented default', () => {
      const r = parseAdminTenantFilters(
        new URLSearchParams(`pageSize=${ADMIN_TENANT_MAX_PAGE_SIZE + 1}`),
      );
      expect(r.pageSize).toBe(ADMIN_TENANT_PAGE_SIZE);
    });

    it('falls back to page=1 for non-numeric page', () => {
      const r = parseAdminTenantFilters(new URLSearchParams('page=abc'));
      expect(r.page).toBe(1);
    });

    it('falls back to page=1 for page=0', () => {
      const r = parseAdminTenantFilters(new URLSearchParams('page=0'));
      expect(r.page).toBe(1);
    });

    it('falls back to page=1 for negative page', () => {
      const r = parseAdminTenantFilters(new URLSearchParams('page=-3'));
      expect(r.page).toBe(1);
    });

    it('trims whitespace in q', () => {
      const r = parseAdminTenantFilters(
        new URLSearchParams('q=%20%20acme%20%20'),
      );
      expect(r.q).toBe('acme');
    });

    it('accepts raw string source', () => {
      const r = parseAdminTenantFilters('plan=FREE&status=ACTIVE&region=eu');
      expect(r.plan).toEqual(['FREE']);
      expect(r.status).toEqual(['ACTIVE']);
      expect(r.region).toEqual(['eu']);
    });

    it('accepts a plain object (NestJS @Query() shape)', () => {
      const r = parseAdminTenantFilters({
        plan: 'PRO,ENTERPRISE',
        status: ['ACTIVE', 'SUSPENDED'],
      });
      expect(r.plan).toEqual(['PRO', 'ENTERPRISE']);
      expect(r.status).toEqual(['ACTIVE', 'SUSPENDED']);
    });

    it('skips undefined/null values in plain-object source', () => {
      const r = parseAdminTenantFilters({
        plan: undefined,
        status: null as unknown as string,
        region: '',
      });
      expect(r.plan).toEqual([]);
      expect(r.status).toEqual([]);
      // Empty string filter is parsed as "no values" → empty array.
      expect(r.region).toEqual([]);
    });

    it('round-trips a fully-populated filter through zod validation', () => {
      const parsed = parseAdminTenantFilters(
        new URLSearchParams(
          'q=acme&plan=FREE,PRO&status=ACTIVE&region=eu,us&page=2&pageSize=25',
        ),
      );
      // parsed has defaults filled in by AdminTenantFilterSchema.parse.
      const reparsed = AdminTenantFilterSchema.parse(parsed);
      expect(reparsed.q).toBe('acme');
      expect(reparsed.page).toBe(2);
      expect(reparsed.pageSize).toBe(25);
    });
  });
});