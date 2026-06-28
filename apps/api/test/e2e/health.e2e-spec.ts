/**
 * E2E smoke test — Health endpoint
 *
 * This is a minimal smoke test that boots the NestJS app in-process
 * (without HTTP server) and verifies the health module works.
 *
 * For full e2e with HTTP server + DB, run with: pnpm test:e2e
 * (requires Postgres up via docker compose).
 */
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { HealthModule } from '../../src/modules/health/health.module';

describe('Health (e2e)', () => {
  it('boots the health module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});