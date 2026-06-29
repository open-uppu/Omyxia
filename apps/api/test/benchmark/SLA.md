# SLA Targets (v1.0.0)

| Metric | Target | Notes |
|---|---|---|
| p50 latency | < 50ms | |
| p95 latency | < 200ms | hot endpoints |
| p99 latency | < 500ms | |
| Error rate | < 0.1% | across all endpoints |
| Uptime | 99.9% | monthly |
| RTO | 4 hours | (see DR runbook) |
| RPO | 1 hour | hourly DB snapshots |

## Reporting

- Weekly: cost + uptime summary
- Monthly: full SLA report
- Quarterly: capacity planning

## Support tiers

| Severity | Response | Resolve |
|---|---|---|
| Sev 1 (outage) | 15 min | 4 hours |
| Sev 2 (degraded) | 1 hour | 24 hours |
| Sev 3 (minor) | 4 hours | 5 days |
