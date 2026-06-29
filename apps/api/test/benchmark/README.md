# Performance Benchmarks (v1.0.0 Production Hardening)

**Target: p95 < 200ms** for hot endpoints.

## Endpoints measured

| Endpoint | Method | Target p95 | Notes |
|---|---|---|---|
| `/auth/login` | POST | <300ms | bcrypt + JWT issue |
| `/tenants` | GET | <200ms | list with pagination |
| `/tenants/:id/switch` | POST | <150ms | token issue |
| `/auth/me` | GET | <80ms | session lookup |
| `/bi/dashboards` | GET | <200ms | tenant-scoped list |
| `/audit-logs` | GET | <300ms | pagination + RBAC |
| `/files/presign` | POST | <200ms | S3 client call |
| `/projects` | GET | <200ms | specialized.list |

## How to run

```bash
# 1. Install k6 (https://k6.io)
brew install k6     # macOS
apt install k6      # Linux

# 2. Start the API
cd apps/api && pnpm start

# 3. Run baseline benchmark
cd apps/api/test/benchmark
./run.sh
```

## Scripts

- `run.sh` — wrapper that boots the API + runs k6 + writes report
- `scenarios/auth.js` — auth + session flows
- `scenarios/bi.js` — BI dashboard reads
- `scenarios/files.js` — file upload presign

## SLA doc

See `SLA.md` — defines p95/p99 thresholds, error budgets, RTO/RPO.
