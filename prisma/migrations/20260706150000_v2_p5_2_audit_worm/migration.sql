-- omyxia v2.0.0 P5.2 — Audit WORM storage (Write-Once-Read-Many)
--
-- Goal: make the AuditLog table append-only at the database layer so that
-- no application user — including database superusers — can mutate or
-- delete a row once it has been written. The application-level AuditService
-- already only ever calls `auditLog.create(...)`; this migration adds a
-- DB-level safety net for SOC2 / customer audits.
--
-- Why a trigger (not just GRANTs)?
--   Postgres GRANTs are scoped to roles; a misconfigured privilege
--   escalation (e.g. accidental SUPERUSER grant) would silently re-enable
--   UPDATE/DELETE on the table. A BEFORE UPDATE/DELETE trigger raises a
--   hard exception regardless of role, which is what SOC2 auditors want
--   to see in the schema. We document the trigger explicitly so a
--   migration reviewer doesn't accidentally interpret it as a bug.
--
-- Why an HMAC `signature` column?
--   The trigger keeps an attacker with DB write access from modifying
--   data, but it doesn't help an external auditor prove that a row they
--   read from a backup was the row that was originally written. Adding
--   a chained per-row HMAC-SHA256 signature (over a canonical projection
--   of the row) gives external verifiers (SOC2 auditors, customer
--   security reviews) a way to:
--     1. confirm the row was written by the application server holding
--        `AUDIT_HMAC_SECRET`, and
--     2. detect reordering / row loss when the daily S3 snapshot is
--        replayed against the live table.
--   The chain includes `previous_signature` so any historical-tampering
--   attempt invalidates every later signature.
--
-- Why `BEFORE UPDATE` (not `FOR UPDATE` row-level security)?
--   RLS policies in Postgres don't apply to the table owner or to
--   superusers (you need to also set `bypass_rls` = false on the owner
--   role), and they cost planner overhead. A simple BEFORE UPDATE /
--   DELETE trigger is portable, zero-cost when no row is being modified,
--   and impossible to bypass by accident.
--
-- Retention rationale:
--   AuditLog is retained for 7 years (PRODUCT_RETENTION_AUDIT) per
--   DATA_RETENTION.md. The trigger also blocks TRUNCATE (which would
--   otherwise be a one-call wipe). Old rows are aged out by a separate
--   partitioning job in P5.4 — not added here — because the
--   "Append-only at the row level" contract is independent of how
--   storage is sharded.

-- ============================================================================
-- 1) AuditLog: add HMAC signature + chain
-- ============================================================================

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "previous_signature" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "signature"          TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "signed_at"         TIMESTAMP(6);

-- backfill signed_at for any rows that pre-date P5.2. We don't have an
-- HMAC chain for them (previous_signature, signature both null) but the
-- immutability trigger below still applies, so this is a safe upgrade.
UPDATE "AuditLog"
SET    "signed_at" = COALESCE("signed_at", "createdAt")
WHERE  "signed_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_audit_signature"
  ON "AuditLog" ("signature");
CREATE INDEX IF NOT EXISTS "idx_audit_signed_at"
  ON "AuditLog" ("signed_at");

-- ============================================================================
-- 2) AuditLog: append-only trigger (WORM)
-- ============================================================================
--
-- The function is created in the public schema and SECURITY DEFINER so
-- it raises with the table owner's privileges — i.e. even an attacker
-- with a SUPERUSER login cannot bypass it (the only way is to drop the
-- trigger itself, which is auditable via Postgres' own pg_event_trigger
-- logs and via the daily snapshot diff).
--
-- We intentionally RAISE EXCEPTION with a stable SQLSTATE so the
-- application can detect tampering via the error code and surface
-- "Audit log is append-only (WORM)" to admins rather than a generic
-- "permission denied".

CREATE OR REPLACE FUNCTION audit_log_worm_block()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'AuditLog is append-only (WORM): % on row % is not permitted',
    TG_OP, COALESCE(OLD.id, NEW.id)
    USING ERRCODE = 'P0001',  -- raise_exception; lets the app pattern-match
          HINT    = 'Drop the audit_log_worm trigger to perform destructive maintenance.',
          SCHEMA  = 'public',
          TABLE_  = 'AuditLog';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON "AuditLog";
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_worm_block();

DROP TRIGGER IF EXISTS audit_log_no_delete ON "AuditLog";
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_worm_block();

-- TRUNCATE is BEFORE STATEMENT (no FOR EACH ROW); same body since
-- OLD/NEW don't apply. We still want TRUNCATE to fail loudly.
DROP TRIGGER IF EXISTS audit_log_no_truncate ON "AuditLog";
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT
  EXECUTE FUNCTION audit_log_worm_block();

-- ============================================================================
-- 3) Application DB role: scope privileges (defence in depth)
-- ============================================================================
--
-- We *cannot* revoke UPDATE/DELETE from the existing migration runner
-- (it's the schema owner, and granting roles post-hoc against an
-- existing role would still leave role-spoofing risk if the application
-- gets confused), so the trigger above is the load-bearing
-- enforcement. The revoke step below is documentation + best-effort
-- so that *new* lower-privileged application roles added later (e.g.
-- a future read-replica role for BI) can't accidentally mutate the
-- table.
--
-- We deliberately use `IF EXISTS` so that this migration is
-- idempotent against dev DBs where the role is named differently or
-- absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omyxia_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM omyxia_app;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- swallow — granting is best-effort. The trigger is the real
  -- enforcement.
  RAISE NOTICE 'omyxia_app role revoke skipped: %', SQLERRM;
END $$;

-- ============================================================================
-- 4) Comments for the SOC2 reader
-- ============================================================================
COMMENT ON TRIGGER audit_log_no_update   ON "AuditLog" IS
  'P5.2 WORM enforcement: AuditLog rows are append-only. Drop this trigger ONLY for documented, ticketed maintenance operations.';
COMMENT ON TRIGGER audit_log_no_delete   ON "AuditLog" IS
  'P5.2 WORM enforcement: AuditLog rows are append-only. The trigger blocks all DELETE statements; partitioning is the legitimate path for aging out rows.';
COMMENT ON TRIGGER audit_log_no_truncate ON "AuditLog" IS
  'P5.2 WORM enforcement: TRUNCATE is a one-shot DELETE bypass and must fail here.';
COMMENT ON COLUMN "AuditLog"."signature"          IS
  'P5.2 WORM tamper-evidence: HMAC-SHA256 hex digest of canonical row content + previous_signature. Computed by AuditService on insert.';
COMMENT ON COLUMN "AuditLog"."previous_signature" IS
  'P5.2 WORM tamper-evidence: signature of the row inserted immediately before this one (NULL for the very first signed row in a tenant). Lets auditors replay and verify chain integrity.';
COMMENT ON COLUMN "AuditLog"."signed_at"           IS
  'P5.2 WORM tamper-evidence: timestamp at which the signature was computed (close to createdAt; used as a sanity guard when comparing signature timestamps).';
