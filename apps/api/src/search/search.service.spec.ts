import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContextService } from '../common/tenant-context/tenant-context.service';
import { SearchService, SearchOptions, IndexDocument, SearchResult } from './search.service';

describe('SearchService', () => {
  let service: SearchService;
  let prisma: PrismaService;
  let tenantContext: TenantContextService;

  const mockTenantId = 'test-tenant-123';
  const mockUserId = 'test-user-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: PrismaService,
          useValue: {
            $executeRawUnsafe: vi.fn(),
            $queryRawUnsafe: vi.fn(),
            $queryRaw: vi.fn(),
            $executeRaw: vi.fn(),
          },
        },
        {
          provide: TenantContextService,
          useValue: {
            getTenantId: vi.fn().mockReturnValue(mockTenantId),
            getUserId: vi.fn().mockReturnValue(mockUserId),
          },
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    prisma = module.get<PrismaService>(PrismaService);
    tenantContext = module.get<TenantContextService>(TenantContextService);
  });

  describe('index', () => {
    it('should index a document with tenant context', async () => {
      const doc: IndexDocument = {
        resourceType: 'crm_lead',
        resourceId: 'lead-123',
        title: 'Test Lead',
        content: 'This is a test lead content',
        metadata: { email: 'test@example.com', company: 'Acme Inc' },
      };

      (prisma.$executeRawUnsafe as any).mockResolvedValue(undefined);

      await service.index(doc);

      expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
      const call = (prisma.$executeRawUnsafe as any).mock.calls[0];
      expect(call[0]).toContain('INSERT INTO "SearchIndex"');
      expect(call[1]).toBe('test-tenant-123');
      expect(call[2]).toBe('crm_lead');
      expect(call[3]).toBe('lead-123');
      expect(call[4]).toBe('Test Lead');
      expect(call[5]).toBe('simple');
      expect(call[6]).toContain('test@example.com');
    });

    it('should throw error when no tenant context', async () => {
      (tenantContext.getTenantId as any).mockReturnValueOnce(null);

      const doc: IndexDocument = {
        resourceType: 'crm_lead',
        resourceId: 'lead-123',
        title: 'Test',
        content: 'content',
      };

      await expect(service.index(doc)).rejects.toThrow('Tenant context required');
    });

    it('should include tenantId in metadata', async () => {
      const doc: IndexDocument = {
        resourceType: 'email',
        resourceId: 'email-123',
        title: 'Test Email',
        content: 'Email body',
        metadata: { subject: 'Hello' },
      };

      (prisma.$executeRawUnsafe as any).mockResolvedValue(undefined);

      await service.index(doc);

      const call = (prisma.$executeRawUnsafe as any).mock.calls[0];
      const metadata = JSON.parse(call[7]);
      expect(metadata.tenantId).toBe('test-tenant-123');
      expect(metadata.subject).toBe('Hello');
    });
  });

  describe('bulkIndex', () => {
    it('should index multiple documents', async () => {
      const docs: IndexDocument[] = [
        { resourceType: 'crm_lead', resourceId: '1', title: 'Lead 1', content: 'Content 1' },
        { resourceType: 'crm_lead', resourceId: '2', title: 'Lead 2', content: 'Content 2' },
        { resourceType: 'email', resourceId: '3', title: 'Email 1', content: 'Email body' },
      ];

      (prisma.$executeRawUnsafe as any).mockResolvedValue(undefined);

      await service.bulkIndex(docs);

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    });
  });

  describe('search', () => {
    const mockResults = [
      {
        id: 'idx-1',
        resourceType: 'crm_lead',
        resourceId: 'lead-1',
        title: 'Test Lead',
        metadata: { email: 'test@example.com' },
        rank: 0.9,
      },
      {
        id: 'idx-2',
        resourceType: 'email',
        resourceId: 'email-1',
        title: 'Test Email',
        metadata: { subject: 'Hello' },
        rank: 0.7,
      },
    ];

    it('should search with basic query and return ranked results', async () => {
      (prisma.$queryRawUnsafe as any).mockResolvedValue(mockResults);

      const options: SearchOptions = { limit: 10, tenantId: mockTenantId };
      const results = await service.search('test lead', options);

      expect(results).toHaveLength(2);
      expect(results[0].rank).toBeGreaterThan(results[1].rank);
      expect(results[0].highlightedTitle).toContain('<mark>');
    });

    it('should filter by resource types', async () => {
      (prisma.$queryRawUnsafe as any).mockResolvedValue(mockResults);

      const options: SearchOptions = {
        limit: 10,
        tenantId: mockTenantId,
        types: ['crm_lead'],
      };

      await service.search('test', options);

      const call = (prisma.$queryRawUnsafe as any).mock.calls[0];
      const query = call[0];
      expect(query).toContain('"resourceType" = ANY(');
    });

    it('should return empty array for empty query', async () => {
      const results = await service.search('', { limit: 10, tenantId: mockTenantId });
      expect(results).toEqual([]);
    });

    it('should return empty array for whitespace query', async () => {
      const results = await service.search('   ', { limit: 10, tenantId: mockTenantId });
      expect(results).toEqual([]);
    });

    it('should throw error when no tenant context', async () => {
      (tenantContext.getTenantId as any).mockReturnValueOnce(null);

      await expect(service.search('test', { limit: 10 })).rejects.toThrow('Tenant context required');
    });

    it('should use simple config for Thai/English support', async () => {
      (prisma.$queryRawUnsafe as any).mockResolvedValue([]);

      await service.search('สวัสดี hello', { limit: 10, tenantId: mockTenantId });

      const call = (prisma.$queryRawUnsafe as any).mock.calls[0];
      const query = call[0];
      expect(query).toContain("'simple'");
    });
  });

  describe('buildTsQuery', () => {
    it('should build tsquery with prefix matching', () => {
      // Access private method via bracket notation for testing
      const buildTsQuery = (service as any).buildTsQuery.bind(service);

      const query = buildTsQuery('test search');
      expect(query).toBe('test:* & search:*');
    });

    it('should handle Thai characters', () => {
      const buildTsQuery = (service as any).buildTsQuery.bind(service);

      const query = buildTsQuery('สวัสดี hello');
      expect(query).toBe('สวัสดี:* & hello:*');
    });

    it('should escape special characters', () => {
      const buildTsQuery = (service as any).buildTsQuery.bind(service);

      const query = buildTsQuery('test & search | query');
      expect(query).not.toContain('&');
      expect(query).not.toContain('|');
    });

    it('should handle empty strings', () => {
      const buildTsQuery = (service as any).buildTsQuery.bind(service);

      const query = buildTsQuery('   ');
      expect(query).toBe('');
    });
  });

  describe('highlight', () => {
    it('should highlight search terms in title', () => {
      const highlight = (service as any).highlight.bind(service);

      const result = highlight('Test Lead from Acme', 'lead acme');
      expect(result).toContain('<mark>Lead</mark>');
      expect(result).toContain('<mark>Acme</mark>');
    });

    it('should be case insensitive', () => {
      const highlight = (service as any).highlight.bind(service);

      const result = highlight('TEST LEAD', 'test');
      expect(result).toContain('<mark>TEST</mark>');
    });

    it('should handle special regex characters', () => {
      const highlight = (service as any).highlight.bind(service);

      const result = highlight('Test (Lead)', '(lead');
      expect(result).toContain('<mark>(Lead)</mark>');
    });
  });

  describe('fuzzySearch', () => {
    it('should perform fuzzy search using trigram similarity', async () => {
      const mockResults = [
        { id: '1', resourceType: 'crm_lead', resourceId: '1', title: 'Test Lead', metadata: {}, similarity: 0.8 },
        { id: '2', resourceType: 'crm_lead', resourceId: '2', title: 'Test Led', metadata: {}, similarity: 0.6 },
      ];

      (prisma.$queryRawUnsafe as any).mockResolvedValue(mockResults);

      const options: SearchOptions = { limit: 10, tenantId: mockTenantId };
      const results = await service.fuzzySearch('test led', options);

      expect(results).toHaveLength(2);
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    });

    it('should filter by resource types', async () => {
      (prisma.$queryRawUnsafe as any).mockResolvedValue([]);

      await service.fuzzySearch('test', {
        limit: 10,
        tenantId: mockTenantId,
        types: ['email', 'employee'],
      });

      const call = (prisma.$queryRawUnsafe as any).mock.calls[0];
      const query = call[0];
      expect(query).toContain('"resourceType" = ANY(');
    });
  });

  describe('combinedSearch', () => {
    it('should combine exact and fuzzy results', async () => {
      const exactResults: SearchResult[] = [
        { id: '1', resourceType: 'crm_lead', resourceId: '1', title: 'Exact Match', metadata: {}, rank: 1.0 },
      ];

      const fuzzyResults: SearchResult[] = [
        { id: '2', resourceType: 'crm_lead', resourceId: '2', title: 'Fuzzy Match', metadata: {}, rank: 0.8 },
        { id: '3', resourceType: 'crm_lead', resourceId: '3', title: 'Another Fuzzy', metadata: {}, rank: 0.6 },
      ];

      // Mock search to return exact results
      jest.spyOn(service, 'search').mockResolvedValue(exactResults);
      // Mock fuzzySearch to return fuzzy results
      jest.spyOn(service, 'fuzzySearch').mockResolvedValue(fuzzyResults);

      const results = await service.combinedSearch('test', { limit: 5, tenantId: mockTenantId });

      expect(results).toHaveLength(3);
      expect(results[0].resourceId).toBe('1'); // Exact match first
    });

    it('should deduplicate results by resourceId', async () => {
      const exactResults: SearchResult[] = [
        { id: '1', resourceType: 'crm_lead', resourceId: '1', title: 'Exact', metadata: {}, rank: 1.0 },
      ];

      const fuzzyResults: SearchResult[] = [
        { id: '2', resourceType: 'crm_lead', resourceId: '1', title: 'Same Resource', metadata: {}, rank: 0.8 },
        { id: '3', resourceType: 'crm_lead', resourceId: '2', title: 'Different', metadata: {}, rank: 0.6 },
      ];

      jest.spyOn(service, 'search').mockResolvedValue(exactResults);
      jest.spyOn(service, 'fuzzySearch').mockResolvedValue(fuzzyResults);

      const results = await service.combinedSearch('test', { limit: 5, tenantId: mockTenantId });

      expect(results).toHaveLength(2);
      expect(results.find((r) => r.resourceId === '1')).toBeDefined();
      expect(results.find((r) => r.resourceId === '2')).toBeDefined();
    });
  });

  describe('remove', () => {
    it('should remove document from index', async () => {
      (prisma.$executeRawUnsafe as any).mockResolvedValue(undefined);

      await service.remove('crm_lead', 'lead-123');

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "SearchIndex"'),
        mockTenantId,
        'crm_lead',
        'lead-123',
      );
    });

    it('should accept explicit tenantId', async () => {
      (prisma.$executeRawUnsafe as any).mockResolvedValue(undefined);

      await service.remove('crm_lead', 'lead-123', 'explicit-tenant');

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.any(String),
        'explicit-tenant',
        'crm_lead',
        'lead-123',
      );
    });
  });

  describe('getStats', () => {
    it('should return index statistics', async () => {
      (prisma.$queryRawUnsafe as any)
        .mockResolvedValueOnce([{ count: BigInt(42) }]) // total
        .mockResolvedValueOnce([
          { resourceType: 'crm_lead', count: BigInt(20) },
          { resourceType: 'email', count: BigInt(15) },
          { resourceType: 'employee', count: BigInt(7) },
        ]); // byType

      const stats = await service.getStats(mockTenantId);

      expect(stats.totalDocuments).toBe(42);
      expect(stats.byType.crm_lead).toBe(20);
      expect(stats.byType.email).toBe(15);
      expect(stats.byType.employee).toBe(7);
    });
  });

  describe('Thai language support', () => {
    it('should handle Thai search queries', async () => {
      (prisma.$queryRawUnsafe as any).mockResolvedValue([]);

      await service.search('สวัสดีครับ hello world', { limit: 10, tenantId: mockTenantId });

      const call = (prisma.$queryRawUnsafe as any).mock.calls[0];
      const query = call[0];
      // Should use 'simple' config for Thai+English support
      expect(query).toContain("'simple'");
    });

    it('should handle mixed Thai/English in index', async () => {
      const doc: IndexDocument = {
        resourceType: 'employee',
        resourceId: 'emp-1',
        title: 'สมชาย ใจดี',
        content: 'สมชาย ใจดี Somchai Jaidee',
        metadata: { thFirstName: 'สมชาย', thLastName: 'ใจดี', firstName: 'Somchai', lastName: 'Jaidee' },
      };

      (prisma.$executeRawUnsafe as any).mockResolvedValue(undefined);

      await service.index(doc);

      const call = (prisma.$executeRawUnsafe as any).mock.calls[0];
      const searchText = call[6];
      expect(searchText).toContain('สมชาย');
      expect(searchText).toContain('ใจดี');
      expect(searchText).toContain('Somchai');
      expect(searchText).toContain('Jaidee');
    });
  });

  describe('ranking', () => {
    it('should rank exact matches higher', async () => {
      const results = [
        { id: '1', resourceType: 'crm_lead', resourceId: '1', title: 'Exact Match Lead', metadata: {}, rank: 1.0 },
        { id: '2', resourceType: 'crm_lead', resourceId: '2', title: 'Partial Match', metadata: {}, rank: 0.5 },
        { id: '3', resourceType: 'email', resourceId: '3', title: 'Another Match', metadata: {}, rank: 0.3 },
      ];

      (prisma.$queryRawUnsafe as any).mockResolvedValue(results);

      const results_ = await service.search('exact match', { limit: 10, tenantId: mockTenantId });

      expect(results_[0].rank).toBeGreaterThan(results_[1].rank);
      expect(results_[1].rank).toBeGreaterThan(results_[2].rank);
    });
  });

  describe('reindexType', () => {
    it('should return count of indexed documents', async () => {
      (prisma.$queryRawUnsafe as any).mockResolvedValue([{ count: BigInt(42) }]);

      const count = await service.reindexType('crm_lead', mockTenantId);

      expect(count).toBe(42);
    });
  });
});