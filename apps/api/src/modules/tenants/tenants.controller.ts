import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * List tenants the current user is a member of. The active tenant is flagged.
   */
  @Get()
  async list(@Req() req: any) {
    const userId = req.user?.sub;
    if (!userId) throw new ForbiddenException('Unauthenticated');
    return this.tenantsService.listForUser(userId);
  }

  @Get('current')
  getCurrent() {
    return this.tenantsService.getCurrent();
  }

  @Patch('current')
  @Roles('OWNER', 'ADMIN')
  updateCurrent(@Body() body: { name?: string; settings?: any }) {
    return this.tenantsService.updateCurrent(body);
  }

  /**
   * Switch the active tenant for the current user. Returns a new JWT bound to
   * the target tenant. Idempotent.
   */
  @Post(':id/switch')
  async switch(@Req() req: any, @Param('id') id: string) {
    const userId = req.user?.sub;
    if (!userId) throw new ForbiddenException('Unauthenticated');
    if (!id) throw new BadRequestException('Missing tenant id');
    return this.tenantsService.switchTenant(userId, id);
  }

  /**
   * Create a new tenant. The authenticated user becomes its OWNER.
   */
  @Post()
  @Roles('OWNER', 'ADMIN', 'MEMBER') // any authenticated user can create their own tenant
  async create(@Req() req: any, @Body() body: { name: string; slug?: string; settings?: any }) {
    const userId = req.user?.sub;
    if (!userId) throw new ForbiddenException('Unauthenticated');
    const tenant = await this.tenantsService.createTenant(userId, body);
    // Issue a fresh token bound to the new tenant so the client can switch immediately
    return this.tenantsService.switchTenant(userId, tenant.id);
  }
}