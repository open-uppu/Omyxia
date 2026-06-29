# Disaster Recovery Runbook (v1.0.0)

## Targets

| Tier | RTO | RPO | Notes |
|---|---|---|---|
| Production (DB) | **4 hours** | **1 hour** | Hourly snapshots |
| Production (storage) | 4 hours | 1 hour | S3-compatible + versioning |
| Application (stateless) | **<30 min** | **0** | Helm redeploy |
| Cache (Redis) | **<5 min** | **0** | Cold start tolerable |

## Backup procedure

### Hourly DB snapshot (cron)

```bash
# /etc/cron.d/omyxia-backup
0 * * * * postgres /opt/omyxia/bin/pg-snapshot.sh
```

Script (`pg-snapshot.sh`):
```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%MZ)
pg_dump --no-owner --no-privileges \
  "$DATABASE_URL" \
  | aws s3 cp - "s3://${BACKUP_BUCKET}/db/${TS}.sql.gz" \
      --storage-class STANDARD_IA
aws s3 cp "s3://${BACKUP_BUCKET}/db/${TS}.sql.gz" \
        "s3://${BACKUP_BUCKET}/db/latest.sql.gz"
# retain 30 daily + 12 monthly
```

### Storage backup

S3 versioning + cross-region replication:
```yaml
# ops/s3-replication.yaml
Rules:
  - Status: Enabled
    Priority: 1
    Filter:
      Prefix: tenants/
    Destination:
      Bucket: arn:aws:s3:::omyxia-replicas
      ReplicationTime:
        Status: Enabled
        Time:
          Minutes: 15
```

### Verify (daily 09:00)

```bash
# tools/check-backup-freshness.sh
LATEST=$(aws s3 ls s3://omyxia/db/ | tail -1 | awk '{print $4}')
NOW=$(date -u +%Y%m%dT%H%MZ)
AGE_MIN=$(( ($(date -d $NOW +%s) - $(date -d ${LATEST%.sql.gz} +%s)) / 60 ))
[ $AGE_MIN -lt 90 ] || /opt/omyxia/bin/alert-oncall.sh "Backup stale: ${AGE_MIN}min"
```

## Restore procedure

### Step 1: Provision fresh DB

```bash
# 1. Create new DB from latest snapshot
RESTORE_TS=20260629T1200Z
aws s3 cp "s3://omyxia/db/${RESTORE_TS}.sql.gz" /tmp/restore.sql.gz
gunzip -c /tmp/restore.sql.gz | psql "$RESTORE_DATABASE_URL"
```

### Step 2: Update secrets + redeploy

```bash
# 2. Rotate DATABASE_URL in secret manager
aws secretsmanager update-secret --secret-id omyxia/database \
  --secret-string "{\"url\":\"$RESTORE_DATABASE_URL\"}"

# 3. Helm redeploy (auto on secret change via Reloader)
helm upgrade --install omyxia ./helm/omyxia \
  --set env.DATABASE_URL_REF=omyxia/database
```

### Step 3: Verify + open traffic

```bash
# 4. Smoke test
curl -s -X POST https://omyxia.example.com/api/health | jq .
# expect: {"status":"ok"}

# 5. Check data integrity
psql "$RESTORE_DATABASE_URL" -c "
  SELECT COUNT(*) FROM \"User\" WHERE tenantId IS NULL;
"  # expect: 0 (no orphaned users)
```

## Restore drill (quarterly)

Schedule a quarterly fire drill:
1. Provision separate restoration env
2. Restore latest snapshot
3. Run smoke tests
4. Document RTO actually achieved
5. Update this runbook with findings

## Contact tree

```
Sev 1 (outage / data loss):
  - DevOps oncall → CTO → CEO
  - Customer comms within 1 hour
  - Postmortem within 5 business days

Sev 2 (degraded service):
  - DevOps oncall → CTO
  - Status page update within 30 min
```

## What "disaster" looks like

- DB unreachable > 5 min → page oncall
- Storage region loss → fail over to replica region (DNS TTL 60s)
- Cluster-wide outage → multi-region standby takes over via Route 53 health check
