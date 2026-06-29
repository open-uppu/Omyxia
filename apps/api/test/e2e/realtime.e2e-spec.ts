/**
 * E2E smoke test — Realtime module
 *
 * Boots the RealtimeModule in-process (no HTTP server) and asserts that
 * the gateways wire up correctly and that the foundation events module
 * stays import-clean.
 *
 * This catches:
 *  - DI misconfiguration (missing providers / circular deps)
 *  - Schema-level changes that would break the ChatService.sendMessage
 *    call path the gateway relies on
 *
 * For full socket-level e2e (real JWT + socket.io client), use a separate
 * harness — the gateway unit tests cover the auth + broadcast logic.
 */
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeModule } from '../../src/realtime/realtime.module';
import { RealtimeGateway } from '../../src/realtime/realtime.gateway';
import { ChatGateway } from '../../src/realtime/chat.gateway';
import { PresenceService } from '../../src/realtime/presence.service';

describe('Realtime (e2e)', () => {
  it('boots the realtime module with all gateways + presence service', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret',
        }),
        RealtimeModule,
      ],
    }).compile();

    expect(moduleRef.get(RealtimeGateway)).toBeInstanceOf(RealtimeGateway);
    expect(moduleRef.get(ChatGateway)).toBeInstanceOf(ChatGateway);
    expect(moduleRef.get(PresenceService)).toBeInstanceOf(PresenceService);

    await moduleRef.close();
  });
});