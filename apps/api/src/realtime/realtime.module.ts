import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../common/prisma/prisma.module';
import { TenantContextModule } from '../common/tenant-context/tenant-context.module';
import { WorkspaceModule } from '../modules/workspace/workspace.module';
import { ChatGateway } from './chat.gateway';
import { PresenceService } from './presence.service';
import { RealtimeGateway } from './realtime.gateway';

/**
 * RealtimeModule — wires the WebSocket gateways + presence service.
 *
 * Depends on:
 *  - JwtModule (registered here, not globally, so gateways can verify the
 *    handshake token with the same secret as the REST layer)
 *  - PrismaModule (global, exposes PrismaService)
 *  - TenantContextModule (exposes TenantContextService for ChatGateway)
 *  - WorkspaceModule (provides ChatService)
 *
 * Phase C scope: presence + chat passthrough only.
 */
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-in-production',
    }),
    PrismaModule,
    TenantContextModule,
    WorkspaceModule,
  ],
  providers: [RealtimeGateway, ChatGateway, PresenceService],
  exports: [PresenceService],
})
export class RealtimeModule {}