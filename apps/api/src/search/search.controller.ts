import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { SearchService, SearchOptions, IndexDocument } from './search.service';
import { TenantContextService } from '../common/tenant-context/tenant-context.service';
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';
import { RolesGuard } from '../modules/auth/roles.guard';
import { Roles } from '../modules/auth/roles.decorator';
import { TenantRole } from '@prisma/client';

@ApiTags('search')
@Controller('search')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Full-text search across indexed resources' })
  @ApiQuery({ name: 'q', required: true, description: 'Search query' })
  @ApiQuery({ name: 'type', required: false, description: 'Comma-separated resource types (crm_lead, email, employee, etc.)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results (default 20, max 100)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Offset for pagination' })
  @ApiQuery({ name: 'fuzzy', required: false, type: Boolean, description: 'Enable fuzzy search fallback' })
  async search(
    @Query('q') q: string,
    @Query('type') type?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('fuzzy') fuzzy?: boolean,
  ) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { results: [], total: 0 };
    }

    const types = type ? type.split(',').map((t) => t.trim()) : [];
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const offsetNum = Math.max(Number(offset) || 0, 0);

    const options: SearchOptions = {
      limit: limitNum,
      offset: offsetNum,
      types: types.length > 0 ? types : undefined,
      tenantId,
    };

    const results = fuzzy
      ? await this.searchService.combinedSearch(q, options)
      : await this.searchService.search(q, options);

    return {
      results,
      total: results.length,
      query: q,
      types: types.length > 0 ? types : 'all',
    };
  }

  @Post('reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(TenantRole.OWNER, TenantRole.ADMIN)
  @ApiOperation({ summary: 'Trigger full reindex of search index (admin only)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Resource type to reindex (optional, reindexes all if omitted)' },
      },
    },
  })
  async reindex(@Body() body: { type?: string }, @Req() req: any) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { success: false, message: 'No tenant context' };
    }

    // In a real implementation, this would trigger a background job
    // For now, return count of indexed documents
    const count = await this.searchService.reindexType(body.type || 'all', tenantId);

    return {
      success: true,
      message: `Reindex triggered for ${body.type || 'all types'}`,
      indexedCount: count,
      tenantId,
    };
  }

  @Post('index')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Index a single document (internal use)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        resourceType: { type: 'string' },
        resourceId: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        metadata: { type: 'object' },
      },
      required: ['resourceType', 'resourceId', 'title', 'content'],
    },
  })
  async index(@Body() document: {
    resourceType: string;
    resourceId: string;
    title: string;
    content: string;
    metadata?: Record<string, any>;
  }) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { success: false, message: 'No tenant context' };
    }

    await this.searchService.index({
      ...document,
      metadata: { ...document.metadata, tenantId },
    });

    return { success: true, resourceType: document.resourceType, resourceId: document.resourceId };
  }

  @Post('index/bulk')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Bulk index documents (internal use)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        documents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              resourceType: { type: 'string' },
              resourceId: { type: 'string' },
              title: { type: 'string' },
              content: { type: 'string' },
              metadata: { type: 'object' },
            },
            required: ['resourceType', 'resourceId', 'title', 'content'],
          },
        },
      },
      required: ['documents'],
    },
  })
  async bulkIndex(@Body() body: { documents: Array<{
    resourceType: string;
    resourceId: string;
    title: string;
    content: string;
    metadata?: Record<string, any>;
  }> }) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { success: false, message: 'No tenant context' };
    }

    const documents = body.documents.map((doc) => ({
      ...doc,
      metadata: { ...doc.metadata, tenantId },
    }));

    await this.searchService.bulkIndex(documents);

    return { success: true, indexedCount: documents.length };
  }

  @Post('remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove document from search index' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        resourceType: { type: 'string' },
        resourceId: { type: 'string' },
      },
      required: ['resourceType', 'resourceId'],
    },
  })
  async remove(@Body() body: { resourceType: string; resourceId: string }) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { success: false, message: 'No tenant context' };
    }

    await this.searchService.remove(body.resourceType, body.resourceId, tenantId);

    return { success: true, resourceType: body.resourceType, resourceId: body.resourceId };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get search index statistics' })
  async getStats() {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { totalDocuments: 0, byType: {} };
    }

    return this.searchService.getStats(tenantId);
  }

  @Get('fuzzy')
  @ApiOperation({ summary: 'Fuzzy search using trigram similarity' })
  @ApiQuery({ name: 'q', required: true, description: 'Search query' })
  @ApiQuery({ name: 'type', required: false, description: 'Comma-separated resource types' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async fuzzySearch(
    @Query('q') q: string,
    @Query('type') type?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { results: [], total: 0 };
    }

    const types = type ? type.split(',').map((t) => t.trim()) : [];
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const offsetNum = Math.max(Number(offset) || 0, 0);

    const options: SearchOptions = {
      limit: limitNum,
      offset: offsetNum,
      types: types.length > 0 ? types : undefined,
      tenantId,
    };

    const results = await this.searchService.fuzzySearch(q, options);

    return {
      results,
      total: results.length,
      query: q,
      fuzzy: true,
    };
  }
}