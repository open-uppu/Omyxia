/**
 * omyxia v2.0.0 P4.1 — StripeWebhookController tests.
 *
 * Two routes:
 *   * test mode (signature verification OFF) — pass through any well-formed
 *     JSON body; idempotency is enforced via the StripeWebhookEvent table.
 *   * failing signature — must reject with HTTP 400 even when the body is
 *     well-formed.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StripeWebhookController } from './webhook.controller';
import { EntitlementsSyncService } from './entitlements-sync.service';

interface FakeSync {
  reserveWebhookEvent: ReturnType<typeof vi.fn>;
  handleEvent: ReturnType<typeof vi.fn>;
}

function mkSync(): FakeSync {
  return {
    reserveWebhookEvent: vi.fn(async () => ({ reserved: true, existing: { id: 'evt_db_id' } })),
    handleEvent: vi.fn(async () => ({
      stripeEventId: 'evt_x',
      type: 'customer.subscription.updated',
      status: 'PROCESSED',
      receivedAt: new Date().toISOString(),
    })),
  };
}

function mkReq(rawBody: Buffer | null, signature: string | null): any {
  return {
    rawBody,
    headers: signature ? { 'stripe-signature': signature } : {},
  };
}

describe('StripeWebhookController', () => {
  it('rejects an empty body', async () => {
    const sync = mkSync();
    const controller = new StripeWebhookController(sync as unknown as EntitlementsSyncService);
    await expect(controller.handle(mkReq(null, null))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(sync.reserveWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies in test mode', async () => {
    const sync = mkSync();
    process.env.STRIPE_TEST_MODE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = '';
    const controller = new StripeWebhookController(sync as unknown as EntitlementsSyncService);
    await expect(controller.handle(mkReq(Buffer.from('not json'), null))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects events missing id or type', async () => {
    const sync = mkSync();
    process.env.STRIPE_TEST_MODE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = '';
    const controller = new StripeWebhookController(sync as unknown as EntitlementsSyncService);
    const body = JSON.stringify({ data: { object: {} } });
    await expect(
      controller.handle(mkReq(Buffer.from(body), null)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('passes well-formed test events through to the sync service', async () => {
    const sync = mkSync();
    process.env.STRIPE_TEST_MODE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = '';
    const controller = new StripeWebhookController(sync as unknown as EntitlementsSyncService);

    const body = JSON.stringify({
      id: 'evt_test_1',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_x', customer: 'cus_x', status: 'active', items: { data: [] } } },
      livemode: false,
    });
    const response = await controller.handle(mkReq(Buffer.from(body), null));
    expect(response).toEqual({ received: true, status: 'PROCESSED' });
    expect(sync.reserveWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ stripeEventId: 'evt_test_1' }),
    );
    expect(sync.handleEvent).toHaveBeenCalledTimes(1);
  });

  it('short-circuits duplicate events without re-running the sync', async () => {
    const sync = mkSync();
    sync.reserveWebhookEvent.mockResolvedValueOnce({
      reserved: false,
      existing: { id: 'evt_db_id', status: 'PROCESSED', receivedAt: new Date() },
    });
    process.env.STRIPE_TEST_MODE = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = '';
    const controller = new StripeWebhookController(sync as unknown as EntitlementsSyncService);

    const body = JSON.stringify({
      id: 'evt_dup',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_x', customer: 'cus_x', status: 'active', items: { data: [] } } },
      livemode: false,
    });
    const response = await controller.handle(mkReq(Buffer.from(body), null));
    expect(response).toEqual({ received: true, status: 'PROCESSED' });
    expect(sync.handleEvent).not.toHaveBeenCalled();
  });

  it('rejects events with a missing signature when not in test mode', async () => {
    const sync = mkSync();
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    process.env.STRIPE_TEST_MODE = '';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx';
    const controller = new StripeWebhookController(sync as unknown as EntitlementsSyncService);
    const body = JSON.stringify({
      id: 'evt_no_sig',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_x', customer: 'cus_x', status: 'active', items: { data: [] } } },
      livemode: false,
    });
    await expect(controller.handle(mkReq(Buffer.from(body), null))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
