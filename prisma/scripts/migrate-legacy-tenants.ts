#!/usr/bin/env ts-node
/**
 * omyxia v2.0.0 P5.1 — Legacy Full Access migration CLI
 *
 * Run with:
 *
 *   pnpm --filter @omyxia/prisma migrate:legacy-tenants           # real run
 *   pnpm --filter @omyxia/prisma migrate:legacy-tenants -- --dry-run
 *   pnpm --filter @omyxia/prisma migrate:legacy-tenants -- --batch=50 --verbose
 *
 * What it does (per WORKBOARD-V2.md §"🛡️ Migration Plan"):
 *
 *   1. Ensure the `LEGACY_FULL_ACCESS` Plan exists.
 *   2. For every pre-v2.0.0 tenant (no `TenantEntitlement` row yet, or
 *      whose current entitlement is on a non-legacy plan):
 *        - upsert entitlement → legacy plan + every active AddOn
 *        - expires_at = 2027-12-31 (configurable)
 *        - write an AuditLog row with before/after
 *   3. Email every OWNER + ADMIN of each migrated tenant.
 *
 * Idempotent. Safe to re-run.
 *
 * Exit code:
 *   0  — success (even if some tenants failed individually; check
 *        the summary for `tenantsFailed`)
 *   1  — fatal error (could not connect to DB, could not load plan, etc.)
 */
/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { config as dotenv } from 'dotenv';
import { resolve } from 'path';
import {
  LEGACY_EXPIRES_AT,
  runLegacyMigration,
  Notifier,
  MigrationSummary,
} from '../../apps/api/src/common/migrations/legacy-migration';

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

interface CliOpts {
  dryRun: boolean;
  batch: number;
  expiresAt?: Date;
  adminPortalUrl?: string;
  verbose: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {
    dryRun: false,
    batch: 100,
    verbose: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run' || arg === '-n') {
      opts.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      opts.verbose = true;
    } else if (arg.startsWith('--batch=')) {
      const n = parseInt(arg.slice('--batch='.length), 10);
      if (Number.isFinite(n) && n > 0) opts.batch = n;
    } else if (arg.startsWith('--expires=')) {
      const d = new Date(arg.slice('--expires='.length));
      if (!Number.isNaN(d.getTime())) opts.expiresAt = d;
    } else if (arg.startsWith('--admin-url=')) {
      opts.adminPortalUrl = arg.slice('--admin-url='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`⚠️  unknown flag: ${arg} (ignored)`);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`omyxia P5.1 — Legacy Full Access migration

Usage:
  migrate-legacy-tenants [options]

Options:
  --dry-run, -n          Don't write to DB or send email. Log the plan only.
  --batch=<n>            Tenants per page (default 100).
  --expires=<iso-date>   Override the expiry (default 2027-12-31).
  --admin-url=<url>      Admin portal URL used in the email CTA.
                         (default https://admin.omyxia.app)
  --verbose, -v          Print per-tenant log lines.
  --help, -h             Show this help.

Examples:
  migrate-legacy-tenants --dry-run
  migrate-legacy-tenants --batch=500 --verbose
  migrate-legacy-tenants --expires=2028-06-30
`);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv);

  // Load env from repo root .env (same convention as prisma/seed.ts).
  dotenv({ path: resolve(__dirname, '../../.env') });

  const prisma = new PrismaClient({
    log: ['error', 'warn'],
  });

  console.log('🛡️  omyxia v2.0.0 P5.1 — Legacy Full Access migration');
  console.log(`    mode        : ${opts.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`    batch size  : ${opts.batch}`);
  console.log(
    `    expires at  : ${(opts.expiresAt ?? LEGACY_EXPIRES_AT).toISOString()}`,
  );
  console.log(`    db url      : ${maskUrl(process.env.DATABASE_URL)}`);
  console.log('');

  const notifier = await buildNotifier(opts.verbose);

  const log = opts.verbose
    ? (level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) => {
        const tag = level === 'error' ? '✖' : level === 'warn' ? '⚠' : '·';
        const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
        console.log(`${tag} ${msg}${metaStr}`);
      }
    : () => {};

  let summary: MigrationSummary;
  try {
    summary = await runLegacyMigration({
      // The migration library uses an abstracted `PrismaLike` shape; the
      // live PrismaClient satisfies that interface for the operations we
      // call. Cast is safe — the actual method signatures match.
      prisma: prisma as unknown as Parameters<typeof runLegacyMigration>[0]['prisma'],
      notifier,
      batchSize: opts.batch,
      dryRun: opts.dryRun,
      expiresAt: opts.expiresAt,
      adminPortalUrl: opts.adminPortalUrl,
    });
  } catch (err) {
    console.error('💥 migration failed fatally:', err);
    await prisma.$disconnect();
    process.exit(1);
  }

  await prisma.$disconnect();

  printSummary(summary);

  // Always exit 0 — individual tenant failures are reported via
  // `tenantsFailed` in the summary, so CI / on-call dashboards can read
  // the JSON instead of grep'ing exit codes.
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Notifier that sends through the configured SMTP transport.
 *
 * Falls back to a "log only" notifier when SMTP env is not configured —
 * this lets the migration run in CI / dev without a live mail server
 * (still produces a complete summary, just with emailsFailed = emailsAttempted).
 */
async function buildNotifier(verbose: boolean): Promise<Notifier> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? 'noreply@omyxia.app';

  if (!host) {
    if (verbose) {
      console.log('ℹ️  SMTP_HOST not set — emails will be logged to stdout only.');
    }
    return async (to, subject, text) => {
      console.log(`📧 [stub] to=${to} subject=${JSON.stringify(subject)}`);
      if (verbose) console.log(text);
      // Treat stub sends as failures so the summary makes it obvious no
      // real mail was sent (and so we don't claim "delivered").
      return { delivered: false, error: 'SMTP not configured (stub)' };
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });

  return async (to, subject, text, html) => {
    try {
      const info = await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html,
      });
      return { delivered: true, error: info.messageId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { delivered: false, error: msg };
    }
  };
}

function maskUrl(url: string | undefined): string {
  if (!url) return '<unset>';
  return url.replace(/:[^:@/]+@/, ':***@');
}

function printSummary(s: MigrationSummary): void {
  const pad = (label: string, n: number | string | boolean | null) =>
    `  ${label.padEnd(22, ' ')} ${String(n)}`;
  console.log('');
  console.log('──────────── migration summary ────────────');
  console.log(pad('dry-run', s.dryRun));
  console.log(pad('startedAt', s.startedAt));
  console.log(pad('finishedAt', s.finishedAt));
  console.log(pad('planCreated', s.planCreated));
  console.log(pad('planId', s.planId ?? '-'));
  console.log(pad('tenantsConsidered', s.tenantsConsidered));
  console.log(pad('tenantsMigrated', s.tenantsMigrated));
  console.log(pad('tenantsSkipped', s.tenantsSkipped));
  console.log(pad('tenantsFailed', s.tenantsFailed));
  console.log(pad('addOnsGranted', s.addOnsGranted));
  console.log(pad('emailsAttempted', s.emailsAttempted));
  console.log(pad('emailsDelivered', s.emailsDelivered));
  console.log(pad('emailsFailed', s.emailsFailed));
  if (s.errors.length > 0) {
    console.log('');
    console.log('  errors:');
    for (const e of s.errors) {
      console.log(`    - ${e.tenantId} [${e.stage}] ${e.error}`);
    }
  }
  console.log('────────────────────────────────────────────');
  // Also dump a JSON line so CI artifacts / dashboards can parse it.
  console.log('SUMMARY_JSON=' + JSON.stringify(s));
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('💥 unhandled error:', err);
  process.exit(1);
});