import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContextService } from '../common/tenant-context/tenant-context.service';

export interface SearchOptions {
  limit?: number;
  offset?: number;
  types?: string[];
  tenantId?: string;
}

export interface SearchResult {
  id: string;
  resourceType: string;
  resourceId: string;
  title: string;
  metadata: Record<string, any>;
  rank: number;
  highlightedTitle?: string;
}

export interface IndexDocument {
  resourceType: string;
  resourceId: string;
  title: string;
  content: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly SEARCH_CONFIG = 'simple'; // Thai+English friendly config

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Build tsquery from search query string
   * Handles multi-language (Thai + English) using simple config
   */
  private buildTsQuery(query: string): string {
    // Clean and split query into tokens
    const tokens = query
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((token) => {
        // Escape special characters for tsquery
        const escaped = token
          .replace(/[&|!():*]/g, ' ')
          .trim();
        // Add prefix matching with :*
        return `${escaped}:*`;
      });

    return tokens.join(' & ');
  }

  /**
   * Build tsquery for fuzzy matching using trigram similarity
   */
  private buildFuzzyQuery(query: string): string {
    return query
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => t.replace(/[&|!():*]/g, '').trim())
      .join(' | ');
  }

  /**
   * Index or update a document in the search index
   */
  async index(document: IndexDocument): Promise<void> {
    const tenantId = document.metadata?.tenantId || this.tenantContext.getTenantId();

    if (!tenantId) {
      throw new Error('Tenant context required for indexing');
    }

    const searchText = [
      document.title,
      document.content,
      ...Object.values(document.metadata || {}).filter((v): v is string => typeof v === 'string'),
    ]
      .filter(Boolean)
      .join(' ');

    // Upsert into SearchIndex using raw SQL for tsvector
    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO "SearchIndex" ("tenantId", "resourceType", "resourceId", title, content, metadata, "indexedAt", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, to_tsvector($5, $6), $7, NOW(), NOW(), NOW())
      ON CONFLICT ("tenantId", "resourceType", "resourceId") DO UPDATE SET
        title = EXCLUDED.title,
        content = to_tsvector($5, EXCLUDED.title || ' ' || EXCLUDED.metadata::text),
        metadata = EXCLUDED.metadata,
        "indexedAt" = NOW(),
        "updatedAt" = NOW()
      `,
      tenantId,
      document.resourceType,
      document.resourceId,
      document.title,
      this.SEARCH_CONFIG,
      searchText,
      JSON.stringify(document.metadata || {}),
    );
  }

  /**
   * Bulk index multiple documents
   */
  async bulkIndex(documents: IndexDocument[]): Promise<void> {
    for (const doc of documents) {
      await this.index(doc);
    }
  }

  /**
   * Search with ranking and highlighting
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      limit = 20,
      offset = 0,
      types = [],
      tenantId: explicitTenantId,
    } = options;

    const tenantId = explicitTenantId || this.tenantContext.getTenantId();

    if (!tenantId) {
      throw new Error('Tenant context required for search');
    }

    if (!query.trim()) {
      return [];
    }

    const tsQuery = this.buildTsQuery(query);

    // Build WHERE clause for resource types
    const typeFilter = types.length > 0
      ? `AND "resourceType" = ANY($4)`
      : '';

    const params = [tenantId, tsQuery, this.SEARCH_CONFIG, types, limit, offset];

    // Adjust parameter indices for the query
    let paramIndex = 1;
    const tenantParam = `$${paramIndex++}`;
    const queryParam = `$${paramIndex++}`;
    const configParam = `$${paramIndex++}`;
    const typesParam = types.length > 0 ? `$${paramIndex++}` : null;
    const limitParam = `$${paramIndex++}`;
    const offsetParam = `$${paramIndex}`;

    let whereClause = `
      WHERE "tenantId" = ${tenantParam}
      AND content @@ to_tsquery(${configParam}, ${queryParam})
    `;

    if (types.length > 0) {
      whereClause += ` AND "resourceType" = ANY(${typesParam})`;
    }

    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        resourceType: string;
        resourceId: string;
        title: string;
        metadata: Record<string, any>;
        rank: number;
      }>
    >(
      `
      SELECT
        id,
        "resourceType",
        "resourceId",
        title,
        metadata,
        ts_rank_cd(content, to_tsquery(${configParam}, ${queryParam}), 32) AS rank
      FROM "SearchIndex"
      ${whereClause}
      ORDER BY rank DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
      `,
      tenantId,
      tsQuery,
      this.SEARCH_CONFIG,
      ...(types.length > 0 ? [types] : []),
      limit,
      offset,
    );

    // Add highlighting for titles
    return results.map((row) => ({
      ...row,
      highlightedTitle: this.highlight(row.title, query),
    }));
  }

  /**
   * Fuzzy search using pg_trgm similarity
   */
  async fuzzySearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      limit = 20,
      offset = 0,
      types = [],
      tenantId: explicitTenantId,
    } = options;

    const tenantId = explicitTenantId || this.tenantContext.getTenantId();

    if (!tenantId) {
      throw new Error('Tenant context required for search');
    }

    if (!query.trim()) {
      return [];
    }

    const similarityThreshold = 0.3;

    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        resourceType: string;
        resourceId: string;
        title: string;
        metadata: Record<string, any>;
        similarity: number;
      }>
    >(
      `
      SELECT
        id,
        "resourceType",
        "resourceId",
        title,
        metadata,
        similarity(title, $2) AS similarity
      FROM "SearchIndex"
      WHERE "tenantId" = $1
      ${types.length > 0 ? `AND "resourceType" = ANY($6)` : ''}
      AND similarity(title, $2) > $3
      ORDER BY similarity DESC
      LIMIT $4 OFFSET $5
      `,
      tenantId,
      query,
      similarityThreshold,
      limit,
      offset,
      ...(types.length > 0 ? [types] : []),
    );

    return results.map((row) => ({
      ...row,
      rank: row.similarity,
      highlightedTitle: this.highlight(row.title, query),
    }));
  }

  /**
   * Combined search: exact match first, then fuzzy
   */
  async combinedSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const exactResults = await this.search(query, options);

    // If we have enough exact results, return them
    if (exactResults.length >= (options.limit || 20)) {
      return exactResults;
    }

    // Otherwise supplement with fuzzy results
    const remainingLimit = (options.limit || 20) - exactResults.length;
    const fuzzyOptions = { ...options, limit: remainingLimit };
    const fuzzyResults = await this.fuzzySearch(query, fuzzyOptions);

    // Deduplicate by resourceId
    const seen = new Set(exactResults.map((r) => `${r.resourceType}:${r.resourceId}`));
    const uniqueFuzzy = fuzzyResults.filter((r) => {
      const key = `${r.resourceType}:${r.resourceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return [...exactResults, ...uniqueFuzzy];
  }

  /**
   * Highlight search terms in text
   */
  private highlight(text: string, query: string): string {
    if (!text || !query) return text;

    const tokens = query
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => t.replace(/[&|!():*]/g, '').trim())
      .filter(Boolean);

    let highlighted = text;
    for (const token of tokens) {
      const regex = new RegExp(`(${this.escapeRegExp(token)})`, 'gi');
      highlighted = highlighted.replace(regex, '<mark>$1</mark>');
    }

    return highlighted;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Remove document from index
   */
  async remove(resourceType: string, resourceId: string, tenantId?: string): Promise<void> {
    const effectiveTenantId = tenantId || this.tenantContext.getTenantId();

    if (!effectiveTenantId) {
      throw new Error('Tenant context required for removal');
    }

    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "SearchIndex" WHERE "tenantId" = $1 AND "resourceType" = $2 AND "resourceId" = $3`,
      effectiveTenantId,
      resourceType,
      resourceId,
    );
  }

  /**
   * Reindex all documents of a specific type for a tenant
   */
  async reindexType(resourceType: string, tenantId?: string): Promise<number> {
    const effectiveTenantId = tenantId || this.tenantContext.getTenantId();

    if (!effectiveTenantId) {
      throw new Error('Tenant context required for reindex');
    }

    // This would be implemented per resource type
    // For now, return count of indexed documents
    const count = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "SearchIndex" WHERE "tenantId" = $1 AND "resourceType" = $2`,
      effectiveTenantId,
      resourceType,
    );

    return Number(count[0]?.count || 0);
  }

  /**
   * Get search index stats
   */
  async getStats(tenantId?: string): Promise<{
    totalDocuments: number;
    byType: Record<string, number>;
  }> {
    const effectiveTenantId = tenantId || this.tenantContext.getTenantId();

    if (!effectiveTenantId) {
      throw new Error('Tenant context required for stats');
    }

    const [total, byType] = await Promise.all([
      this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count FROM "SearchIndex" WHERE "tenantId" = $1`,
        effectiveTenantId,
      ),
      this.prisma.$queryRawUnsafe<Array<{ resourceType: string; count: bigint }>>(
        `SELECT "resourceType", COUNT(*) as count FROM "SearchIndex" WHERE "tenantId" = $1 GROUP BY "resourceType"`,
        effectiveTenantId,
      ),
    ]);

    return {
      totalDocuments: Number(total[0]?.count || 0),
      byType: Object.fromEntries(
        byType.map((row) => [row.resourceType, Number(row.count)]),
      ),
    };
  }
}