# Omyxia Cloud (omyxia.cloud) — SaaS Deployment Guide

Run Omyxia as a **managed multi-tenant SaaS** — similar to how Supabase, Vercel, or Linear operate.

## 🎯 Target Market

- 🚀 **Startups** that want enterprise IT without enterprise cost
- 🏢 **SMBs** (10-500 employees) needing ERP + HRM + CRM without $100k+ licenses
- 🌍 **Multi-region** deployments (EU/US/APAC)

## 🏗️ Architecture

```
                ┌────────────────────────────────────┐
                │       omyxia.cloud (CDN/WAF)       │
                │       (Cloudflare / Fastly)        │
                └─────────────┬──────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼─────┐         ┌─────▼─────┐         ┌─────▼─────┐
   │   US     │         │    EU     │         │   APAC    │
   │  region  │         │  region   │         │  region   │
   └────┬─────┘         └─────┬─────┘         └─────┬─────┘
        │                     │                     │
   ┌────▼────────────────────▼─────────────────────▼────┐
   │   Kubernetes cluster (per region)                   │
   │   - api (3+ replicas, HPA)                          │
   │   - web (3+ replicas)                               │
   │   - postgres (RDS Multi-AZ + read replicas)         │
   │   - redis (ElastiCache cluster)                     │
   │   - minio → S3 with cross-region replication       │
   │   - stalwart → SES / SendGrid for outbound          │
   └────────────────────────────────────────────────────┘
```

## 🌐 Multi-Tenant Routing

Each tenant gets a unique subdomain: `<tenant-slug>.omyxia.cloud`

### DNS Setup

```
omyxia.cloud           → A/CNAME → CDN
*.omyxia.cloud         → CNAME   → omyxia.cloud (wildcard)
```

### Reverse Proxy (Caddy / nginx)

```caddyfile
*.omyxia.cloud {
    @subapi host api.*
    reverse_proxy @subapi api-internal:3001

    reverse_proxy web-internal:3000 {
        header_up X-Tenant-Host {host}
    }
}
```

The `X-Tenant-Host` header tells the API which tenant to scope queries to.

## 💳 Billing Tiers

| Tier | Price | Limits | Features |
|---|---|---|---|
| **Free** | $0 | 5 users, 1 GB storage, 100 emails/day | All core features, Omyxia branding |
| **Starter** | $29/mo | 25 users, 50 GB, 10k emails/mo | Custom domain, remove branding |
| **Pro** | $99/mo | 100 users, 500 GB, 100k emails/mo | API access, webhooks, priority support |
| **Enterprise** | Custom | Unlimited | SLA, SSO, dedicated instance, audit log retention 7yr |

### Stripe Integration

Webhook events handled:
- `customer.subscription.created` → provision tenant
- `customer.subscription.updated` → adjust plan limits
- `customer.subscription.deleted` → suspend tenant
- `invoice.payment_failed` → grace period → suspend

```typescript
// apps/api/src/billing/stripe-webhook.controller.ts
@Post('webhooks/stripe')
async handleStripeWebhook(@Req() req: RawBodyRequest<Request>) {
    const sig = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(
        req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET
    );
    await this.billingService.handleEvent(event);
}
```

## 🛡️ Multi-Tenant Security

Beyond RLS, cloud adds:

### 1. Tenant isolation enforcement
- `TenantResolverMiddleware` extracts tenant from JWT or subdomain
- Every API call MUST have valid tenant context
- Cross-tenant tokens rejected

### 2. Per-tenant rate limits
```yaml
rate_limits:
  free:    { rps: 10,  burst: 20 }
  starter: { rps: 50,  burst: 100 }
  pro:     { rps: 200, burst: 500 }
  enterprise: { rps: 1000, burst: 2000 }
```

### 3. Tenant suspension
When subscription lapses:
- Read-only mode (queries allowed, writes blocked)
- After 7 days: suspended (login disabled)
- After 30 days: tenant data archived

### 4. Data export
GDPR Article 20 — tenants can export all their data:
```bash
GET /api/export
# Returns: ZIP with all tenant data as JSON + CSV
```

### 5. Account deletion
GDPR Article 17 — tenants can delete:
```bash
DELETE /api/tenant
# 30-day grace period, then hard delete
```

## 📊 Observability Stack

| Concern | Tool |
|---|---|
| Metrics | Prometheus + Grafana |
| Logs | Loki + Grafana |
| Traces | Tempo + Grafana |
| Errors | Sentry |
| Uptime | Better Stack |
| Alerts | PagerDuty |

### Key SLIs

- API p95 latency < 200ms
- API success rate > 99.9%
- WebSocket reconnection < 3s
- Database connection pool < 80% utilization

## 🚀 Deployment Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy to omyxia.cloud

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: pnpm test
      - run: pnpm type-check
      - run: pnpm build

  deploy-staging:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: kubectl apply -k k8s/overlays/staging
      - run: kubectl rollout status deployment/omyxia-api -n staging

  deploy-prod:
    needs: deploy-staging
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: kubectl apply -k k8s/overlays/prod
      - run: ./scripts/smoke-test.sh https://omyxia.cloud
```

## 💰 Cost Estimates (per region, 1000 tenants)

| Service | Spec | Monthly |
|---|---|---|
| EKS (3 nodes, m5.large) | 6 vCPU, 24 GB | $300 |
| RDS postgres (db.r5.xlarge, Multi-AZ) | 4 vCPU, 32 GB, 500 GB | $700 |
| ElastiCache redis (cache.r5.large) | 2 vCPU, 13 GB | $200 |
| S3 + CloudFront | 10 TB egress | $850 |
| SES | 1M emails | $100 |
| DataDog / Grafana Cloud | Pro tier | $300 |
| **Total per region** | | **~$2,450** |

At 1000 tenants × $29/mo Starter = $29,000/mo revenue → **gross margin ~75%** before support costs.

## 📅 Roadmap

- **v0.3.0** (Q3 2026): Self-host + cloud MVP launch
- **v0.4.0** (Q4 2026): Stripe billing, plan tiers
- **v0.5.0** (Q1 2027): Multi-region replication
- **v1.0.0** (Q2 2027): Enterprise SLA + SSO + audit log retention

---

**Self-hosting?** See [SELF-HOST.md](SELF-HOST.md)