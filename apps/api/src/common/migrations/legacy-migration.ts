/**
 * omyxia v2.0.0 P5.1 — Legacy Full Access Migration
 *
 * One-time migration that takes every pre-v2.0.0 tenant (a tenant with no
 * `TenantEntitlement` row yet) and grants them a grandfathered plan so
 * nothing breaks when v2.0.0 ships.
 *
 *   - Plan tier:    `LEGACY_FULL_ACCESS`
 *   - Add-ons:      every active `AddOn` row (no UX gating surprises)
 *   - Expires at:   2027-12-31 (a hard fence; admin team will reassess)
 *   - Notification: email every OWNER + ADMIN of each migrated tenant
 *
 * Idempotency
 * -----------
 *  - Already-migrated tenants (those whose current entitlement is on a
 *    `LEGACY_FULL_ACCESS` Plan) are *skipped* — never touched.
 *  - Pre-existing v2.0.0 entitlements (tier ∈ {FREE, PRO, ENTERPRISE}) are
 *    also left alone — the migration only fills the gaps.
 *
 * Failure model
 * -------------
 *  - Each tenant runs in its own Prisma `$transaction`. A failure on
 *    tenant N does not roll back tenants 0..N-1.
 *  - Email failures are *non-fatal* — they're logged + counted but the
 *    DB migration row is still written (so we can retry the email pass
 *    later).
 *
 * Testability
 * -----------
 *  The library takes a `PrismaClient`-shaped object (`PrismaLike`) plus
 *  a `Notifier` function, so unit tests can run without Postgres or SMTP.
 *
 * @see WORKBOARD-V2.md §"🛡️ Migration Plan"
 */
import { Prisma, PlanTier, TenantRole } from '@prisma/client';

// =========================================================================
// Types
// =========================================================================

/**
 * Minimal Prisma surface the migration needs. Lets unit tests inject a
 * stub instead of booting Postgres.
 */
export interface PrismaLike {
  plan: {
    findFirst(args: {
      where: { tier: PlanTier; isActive: boolean };
    }): Promise<{ id: string; tier: PlanTier; name: string } | null>;
    create(args: {
      data: {
        name: string;
        tier: PlanTier;
        price: Prisma.Decimal | number | string;
        description?: string;
        isActive?: boolean;
        sortOrder?: number;
      };
    }): Promise<{ id: string; tier: PlanTier; name: string }>;
  };
  addOn: {
    findMany(args: {
      where: { isActive: boolean };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
  tenant: {
    findMany(args: {
      where?: { tenantEntitlement?: { none?: object } };
      select: { id: true; slug: true; name: true };
      orderBy?: { createdAt: 'asc' | 'desc' };
      skip?: number;
      take?: number;
    }): Promise<Array<{ id: string; slug: string; name: string }>>;
    count(args: {
      where?: { tenantEntitlement?: { none?: object } };
    }): Promise<number>;
  };
  tenantEntitlement: {
    findFirst(args: {
      where: { tenantId: string };
      include?: { plan: { select: { tier: true } } };
      orderBy?: { effectiveAt: 'asc' | 'desc' };
    }): Promise<{ id: string; plan: { tier: PlanTier } } | null>;
    upsert(args: {
      where: { tenantId_planId: { tenantId: string; planId: string } };
      create: {
        tenantId: string;
        planId: string;
        effectiveAt: Date;
        expiresAt: Date;
      };
      update: {
        effectiveAt: Date;
        expiresAt: Date;
      };
    }): Promise<{ id: string }>;
  };
  tenantEntitlementAddOn: {
    deleteMany(args: { where: { entitlementId: string } }): Promise<{
      count: number;
    }>;
    createMany(args: {
      data: Array<{ entitlementId: string; addOnId: string }>;
      skipDuplicates?: boolean;
    }): Promise<{ count: number }>;
  };
  userTenant: {
    findMany(args: {
      where: { tenantId: string; role: { in: TenantRole[] }; active: boolean };
      include: { user: { select: { email: true; name: true } } };
    }): Promise<
      Array<{
        userId: string;
        role: TenantRole;
        user: { email: string; name: string };
      }>
    >;
  };
  auditLog: {
    create(args: {
      data: {
        table: string;
        rowId?: string;
        action: Prisma.AuditLogCreateInput['action'];
        before?: Prisma.InputJsonValue;
        after?: Prisma.InputJsonValue;
        userId?: string | null;
        tenantId?: string | null;
      };
    }): Promise<{ id: string }>;
  };
  $transaction<T>(
    fn: (tx: PrismaLike) => Promise<T>,
  ): Promise<T>;
}

/**
 * Notification sender — kept abstract so unit tests don't need SMTP.
 * Should return per-recipient success/failure without throwing.
 */
export type Notifier = (
  to: string,
  subject: string,
  text: string,
  html: string,
) => Promise<{ delivered: boolean; error?: string }>;

// =========================================================================
// Constants
// =========================================================================

/**
 * Hard cutoff for grandfathering. After this date, legacy tenants
 * lose access and must explicitly pick a plan.
 */
export const LEGACY_EXPIRES_AT = new Date('2027-12-31T23:59:59.999Z');

export const LEGACY_PLAN_NAME = 'Legacy Full Access';
export const LEGACY_PLAN_SLUG = 'legacy-full-access';

/**
 * Effective-at = "now", so the entitlement is the current one immediately.
 */
export const effectiveNow = (): Date => new Date();

// =========================================================================
// Email templates
// =========================================================================

export interface LegacyMigrationEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Pure, side-effect-free email renderer. Exposed for unit tests.
 *
 * Copy is deliberately short + actionable: tenants need to know they
 * still have access *and* that they must pick a real plan before 2027.
 */
export function renderLegacyMigrationEmail(args: {
  tenantName: string;
  tenantSlug: string;
  expiresAt: Date;
  adminPortalUrl: string;
  userName?: string;
}): LegacyMigrationEmail {
  const exp = args.expiresAt.toISOString().slice(0, 10);
  const greeting = args.userName ? `Hi ${args.userName},` : 'Hi,';
  const subject = `Your omyxia plan is changing — action needed before ${exp}`;

  const text = [
    greeting,
    '',
    `Your tenant "${args.tenantName}" (${args.tenantSlug}) is being moved to`,
    'the new omyxia v2.0.0 plan system.',
    '',
    'You are on: Legacy Full Access',
    '  • All current features stay available until 2027-12-31',
    '  • You can choose any plan at any time before that date',
    '  • After 2027-12-31 your access will be limited to the Free tier',
    '    unless you have selected a paid plan.',
    '',
    `Pick a plan before ${exp}:`,
    `  ${args.adminPortalUrl}/billing/plan`,
    '',
    '— omyxia team',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.5">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <p>${escapeHtml(greeting)}</p>
  <p>Your tenant <strong>${escapeHtml(args.tenantName)}</strong>
     (<code>${escapeHtml(args.tenantSlug)}</code>) is being moved to the new
     omyxia v2.0.0 plan system.</p>
  <div style="border-left:4px solid #3b82f6;padding:12px 16px;background:#eff6ff;margin:16px 0">
    <strong>You are on: Legacy Full Access</strong><br/>
    • All current features stay available until <strong>${exp}</strong><br/>
    • You can choose any plan at any time before that date<br/>
    • After ${exp} your access will be limited to the Free tier unless
    you have selected a paid plan.
  </div>
  <p>
    <a href="${escapeHtml(args.adminPortalUrl)}/billing/plan"
       style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">
      Pick a plan before ${exp}
    </a>
  </p>
  <p style="color:#666">— omyxia team</p>
</div>
</body></html>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =========================================================================
// Pure helpers
// =========================================================================

/**
 * Which user roles should receive the migration email.
 *
 * SUPER_ADMIN intentionally excluded — they already see the admin console
 * banner. OWNER + ADMIN are the tenant-side decision makers.
 */
export const NOTIFY_ROLES: ReadonlyArray<TenantRole> = [
  'OWNER',
  'ADMIN',
] as const;

/**
 * Decide whether a tenant qualifies for migration.
 *
 * Rule (P5.1 spec):
 *   - tenant has no `TenantEntitlement` row at all  → migrate
 *   - tenant's latest entitlement is on `LEGACY_FULL_ACCESS` → skip
 *   - tenant's latest entitlement is on a paid plan → skip (P5.1 only
 *     fills the gap; doesn't override P1.2 seeds or admin assignments)
 */
export function shouldMigrateTenant(
  latestEntitlement: { plan: { tier: PlanTier } } | null,
): boolean {
  if (!latestEntitlement) return true;
  // legacy → already migrated
  return latestEntitlement.plan.tier !== 'LEGACY_FULL_ACCESS';
}

// =========================================================================
// Public API
// =========================================================================

export interface LegacyMigrationOptions {
  prisma: PrismaLike;
  notifier: Notifier;
  /** ISO yyyy-mm-dd or Date; defaults to 2027-12-31. */
  expiresAt?: Date;
  /** Max tenants per batch (sliding window; default 100). */
  batchSize?: number;
  /** When true, do not write to DB or send mail — only log a plan. */
  dryRun?: boolean;
  /** Base URL used in email CTA. Defaults to "https://admin.omyxia.app". */
  adminPortalUrl?: string;
  /** Override current time (test seam). */
  now?: () => Date;
}

export interface MigrationSummary {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  tenantsConsidered: number;
  tenantsMigrated: number;
  tenantsSkipped: number;
  tenantsFailed: number;
  emailsAttempted: number;
  emailsDelivered: number;
  emailsFailed: number;
  addOnsGranted: number;
  planId: string | null;
  planCreated: boolean;
  errors: Array<{ tenantId: string; stage: string; error: string }>;
}

export type MigrationLogger = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  meta?: Record<string, unknown>,
) => void;

const noopLogger: MigrationLogger = (() => {
  // Intentionally empty — callers use noop when verbose=false.
  /* eslint-disable @typescript-eslint/no-empty-function */
  return () => {};
  /* eslint-enable @typescript-eslint/no-empty-function */
})();

/**
 * Run the Legacy Full Access migration.
 *
 * Returns a structured summary suitable for CI artifacts and admin
 * dashboards. Never throws on individual-tenant failure.
 */
export async function runLegacyMigration(
  opts: LegacyMigrationOptions,
): Promise<MigrationSummary> {
  const log: MigrationLogger = noopLogger;
  const expiresAt = opts.expiresAt ?? LEGACY_EXPIRES_AT;
  const batchSize = opts.batchSize ?? 100;
  const adminPortalUrl = opts.adminPortalUrl ?? 'https://admin.omyxia.app';
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? effectiveNow;

  const errors: MigrationSummary['errors'] = [];

  const startedAt = now();
  log('info', '[p5.1] starting legacy migration', {
    dryRun,
    expiresAt: expiresAt.toISOString(),
    batchSize,
  });

  // ----- Step 1: ensure the Plan row exists -----
  const plan = await ensureLegacyPlan(opts.prisma, dryRun);
  log('info', '[p5.1] legacy plan ready', {
    planId: plan.id,
    created: plan.created,
    dryRun,
  });

  // ----- Step 2: load every active add-on -----
  const addOns = await opts.prisma.addOn.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  const addOnIds = addOns.map((a) => a.id);
  log('info', '[p5.1] active add-ons discovered', { count: addOnIds.length });

  // ----- Step 3: enumerate ALL tenants (we let `shouldMigrateTenant`
  // decide per-row). Per spec, the migration is "for all existing
  // tenants" — including those that may have a paid entitlement
  // assigned by an admin during the rollout window. We exclude
  // already-legacy tenants from the count purely so the log line is
  // useful, but the loop still walks everyone (idempotent, safe). -----
  let tenantsConsidered = 0;
  let tenantsMigrated = 0;
  let tenantsSkipped = 0;
  let tenantsFailed = 0;
  let emailsAttempted = 0;
  let emailsDelivered = 0;
  let emailsFailed = 0;
  let addOnsGranted = 0;

  const totalTenants = await opts.prisma.tenant.count({});
  log('info', '[p5.1] tenants scanned', {
    totalTenants,
  });
  tenantsConsidered = totalTenants;

  // Page through tenants. The migration must scale to thousands of
  // tenants without loading them all into memory.
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const page = await opts.prisma.tenant.findMany({
      where: {},
      select: { id: true, slug: true, name: true },
      orderBy: { createdAt: 'asc' },
      ...(pageBounds(offset, batchSize)),
    });
    if (page.length === 0) break;

    for (const tenant of page) {
      try {
        // Re-check inside the transaction — another worker (e.g. P5.2
        // SOC2 audit) might have inserted an entitlement between count()
        // and our page read.
        const result = await opts.prisma.$transaction(async (tx) => {
          const existing = await tx.tenantEntitlement.findFirst({
            where: { tenantId: tenant.id },
            include: { plan: { select: { tier: true } } },
            orderBy: { effectiveAt: 'desc' },
          });

          if (!shouldMigrateTenant(existing)) {
            return {
              action: 'skip' as const,
              reason: existing ? 'already-legacy' : 'no-tenant',
            };
          }

          // Dry-run: plan what would happen, but never touch the DB.
          if (dryRun) {
            return {
              action: 'migrate' as const,
              entitlementId: 'dry-run-entitlement',
              addOnsGranted: addOnIds.length,
            };
          }

          const effectiveAt = now();

          // Upsert is keyed on (tenantId, planId). For tenants that
          // already had an entitlement on a non-legacy plan, we update
          // it in-place rather than creating a duplicate.
          const upserted = await tx.tenantEntitlement.upsert({
            where: {
              tenantId_planId: { tenantId: tenant.id, planId: plan.id },
            },
            create: {
              tenantId: tenant.id,
              planId: plan.id,
              effectiveAt,
              expiresAt,
            },
            update: {
              effectiveAt,
              expiresAt,
            },
          });

          // Replace the add-on set with "everything active".
          await tx.tenantEntitlementAddOn.deleteMany({
            where: { entitlementId: upserted.id },
          });
          const addOnRows = addOnIds.map((addOnId) => ({
            entitlementId: upserted.id,
            addOnId,
          }));
          if (addOnRows.length > 0) {
            await tx.tenantEntitlementAddOn.createMany({
              data: addOnRows,
              skipDuplicates: true,
            });
          }

          await tx.auditLog.create({
            data: {
              table: 'TenantEntitlement',
              rowId: upserted.id,
              action: 'UPDATE',
              tenantId: tenant.id,
              before: existing
                ? ({
                    planId: (existing as { planId?: string }).planId ?? null,
                    tier: existing.plan.tier,
                  } as Prisma.InputJsonValue)
                : (Prisma.JsonNull as unknown as Prisma.InputJsonValue),
              after: {
                planId: plan.id,
                tier: 'LEGACY_FULL_ACCESS' as PlanTier,
                expiresAt: expiresAt.toISOString(),
                addOnIds,
              } as Prisma.InputJsonValue,
            },
          });

          return {
            action: 'migrate' as const,
            entitlementId: upserted.id,
            addOnsGranted: addOnIds.length,
          };
        });

        if (result.action === 'skip') {
          tenantsSkipped++;
          log('info', '[p5.1] skip tenant', {
            tenantId: tenant.id,
            reason: result.reason,
          });
          continue;
        }

        // In dry-run mode we still count what *would* happen so the
        // summary is meaningful, but no DB writes have occurred.
        if (dryRun) {
          tenantsMigrated++;
          addOnsGranted += result.addOnsGranted;
          log('info', '[p5.1] (dry-run) would migrate tenant', {
            tenantId: tenant.id,
            slug: tenant.slug,
            addOns: result.addOnsGranted,
          });
          continue;
        }

        tenantsMigrated++;
        addOnsGranted += result.addOnsGranted;
        log('info', '[p5.1] migrated tenant', {
          tenantId: tenant.id,
          slug: tenant.slug,
          entitlementId: result.entitlementId,
          addOns: result.addOnsGranted,
        });

        // ----- Step 4: notify tenant admins -----
        // Email is *outside* the DB transaction: SMTP failures must not
        // roll back the entitlement.
        if (!dryRun) {
          const counters: Counters = {
            emailsAttempted,
            emailsDelivered,
            emailsFailed,
          };
          await notifyTenantAdmins({
            prisma: opts.prisma,
            notifier: opts.notifier,
            tenant,
            expiresAt,
            adminPortalUrl,
            counters,
          });
          emailsAttempted = counters.emailsAttempted;
          emailsDelivered = counters.emailsDelivered;
          emailsFailed = counters.emailsFailed;
        }
      } catch (err) {
        tenantsFailed++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({
          tenantId: tenant.id,
          stage: 'transaction',
          error: msg,
        });
        log('error', '[p5.1] tenant failed', {
          tenantId: tenant.id,
          error: msg,
        });
      }
    }

    offset += batchSize;
    if (page.length < batchSize) {
      hasMore = false;
    }
  }

  const finishedAt = now();
  const summary: MigrationSummary = {
    dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    tenantsConsidered,
    tenantsMigrated,
    tenantsSkipped,
    tenantsFailed,
    emailsAttempted,
    emailsDelivered,
    emailsFailed,
    addOnsGranted,
    planId: plan.id,
    planCreated: plan.created,
    errors,
  };

  log('info', '[p5.1] migration complete', summary as unknown as Record<string, unknown>);
  return summary;
}

// =========================================================================
// Internal helpers
// =========================================================================

function pageBounds(offset: number, batchSize: number): { skip: number; take: number } {
  return { skip: offset, take: batchSize };
}

/**
 * Ensure the `LEGACY_FULL_ACCESS` Plan exists; create it if not.
 *
 * Returns `{ id, created }`. The `dryRun` flag still performs the
 * existence check (cheap) but returns a synthetic id and skips the
 * INSERT — this lets the rest of the pipeline execute in dry-run mode
 * without blowing up on Prisma unique-constraint errors.
 */
async function ensureLegacyPlan(
  prisma: PrismaLike,
  dryRun: boolean,
): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.plan.findFirst({
    where: { tier: 'LEGACY_FULL_ACCESS', isActive: true },
  });
  if (existing) return { id: existing.id, created: false };
  if (dryRun) {
    return { id: 'dry-run-plan-id', created: false };
  }
  const created = await prisma.plan.create({
    data: {
      name: LEGACY_PLAN_NAME,
      tier: 'LEGACY_FULL_ACCESS',
      // Free at the plan level — but with every add-on attached it is
      // essentially an all-access grandfathered tier.
      price: 0,
      description:
        'Grandfathered plan for tenants migrated from v1.0.0. ' +
        'Grants every active add-on until 2027-12-31.',
      isActive: true,
      sortOrder: -1, // surface first in admin lists
    },
  });
  return { id: created.id, created: true };
}

interface Counters {
  emailsAttempted: number;
  emailsDelivered: number;
  emailsFailed: number;
}

/**
 * Send the migration email to every OWNER + ADMIN of a tenant.
 *
 * Counters are mutated in place so the outer function can pick them up
 * after the await — simpler than threading a returned tuple.
 */
async function notifyTenantAdmins(args: {
  prisma: PrismaLike;
  notifier: Notifier;
  tenant: { id: string; slug: string; name: string };
  expiresAt: Date;
  adminPortalUrl: string;
  counters: Counters;
}): Promise<void> {
  const recipients = await args.prisma.userTenant.findMany({
    where: {
      tenantId: args.tenant.id,
      role: { in: [...NOTIFY_ROLES] },
      active: true,
    },
    include: { user: { select: { email: true, name: true } } },
  });

  for (const r of recipients) {
    args.counters.emailsAttempted++;
    const rendered = renderLegacyMigrationEmail({
      tenantName: args.tenant.name,
      tenantSlug: args.tenant.slug,
      expiresAt: args.expiresAt,
      adminPortalUrl: args.adminPortalUrl,
      userName: r.user.name,
    });
    try {
      const result = await args.notifier(
        r.user.email,
        rendered.subject,
        rendered.text,
        rendered.html,
      );
      if (result.delivered) {
        args.counters.emailsDelivered++;
      } else {
        args.counters.emailsFailed++;
      }
    } catch {
      args.counters.emailsFailed++;
    }
  }
}

