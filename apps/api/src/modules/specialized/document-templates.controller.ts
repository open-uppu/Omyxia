import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { DocumentTemplatesService } from './document-templates.service';
import { Roles } from '../auth/rbac/roles.decorator';

/**
 * DocumentTemplatesController — minimal viable Document Templates
 * (Phase E / v0.3.1).
 *
 * Routes (all tenant-scoped via TenantContextMiddleware + RLS):
 *  GET    /docs/templates              → list templates for current tenant
 *  GET    /docs/templates/:id          → template detail
 *  POST   /docs/templates              → create template   (M+)
 *  PATCH  /docs/templates/:id          → update template   (M+)
 *  DELETE /docs/templates/:id          → delete template   (ADMIN+)
 *  POST   /docs/templates/:id/render   → render with variables (M+)
 */
@Controller('docs/templates')
export class DocumentTemplatesController {
  constructor(private readonly service: DocumentTemplatesService) {}

  @Get()
  list() {
    return this.service.listTemplates();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getTemplate(id);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.createTemplate(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.updateTemplate(id, body);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.deleteTemplate(id);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post(':id/render')
  render(
    @Param('id') id: string,
    @Body() body: { variables?: Record<string, unknown> } | undefined,
  ) {
    return this.service.render(id, body?.variables ?? {});
  }
}