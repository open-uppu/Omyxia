# Self-Hosting Omyxia

Run the entire Omyxia platform on your own server. Perfect for:

- 🏢 Companies that want full data sovereignty
- 🇪🇺 EU/GDPR-compliant deployments (data never leaves your infra)
- 🔒 Air-gapped environments
- 💰 Avoiding per-seat SaaS pricing

## 📋 Prerequisites

### Hardware (minimum for ~50 users)

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB | 100 GB+ SSD |
| Network | 100 Mbps | 1 Gbps |

### Software

- **OS**: Ubuntu 22.04+ / Debian 12+ / RHEL 9+ (macOS for dev)
- **Docker** 24.0+ with Compose v2
- **Domain** pointing to your server (for production TLS)
- **Ports** 80 + 443 open in firewall

## 🚀 Quick Install (5 minutes)

```bash
curl -fsSL https://get.omyxia.io | bash
```

This will:
1. Check Docker is installed
2. Prompt for domain + admin email
3. Generate random secrets
4. Clone the repo
5. Start all 7 services (postgres, redis, minio, stalwart, api, web, caddy)
6. Run database migrations
7. Optionally seed demo data

### Non-interactive install (for automation)

```bash
export OMYXIA_DOMAIN=omyxia.example.com
export OMYXIA_EMAIL=admin@example.com
export OMYXIA_SEED=y
curl -fsSL https://get.omyxia.io | bash
```

## 🎯 Post-Install

Once installed:

| URL | What |
|---|---|
| `https://yourdomain.com` | Web UI |
| `https://yourdomain.com/api` | REST API |
| `https://yourdomain.com/api/health` | Health check |
| `https://yourdomain.com/realtime` | WebSocket gateway |
| `smtp://yourdomain.com:587` | SMTP (send email) |
| `imap://yourdomain.com:143` | IMAP (receive email) |

## 🛠️ Common Operations

### View logs

```bash
cd /opt/omyxia
docker compose -f infra/docker-compose.prod.yml logs -f          # all services
docker compose -f infra/docker-compose.prod.yml logs -f api      # just API
docker compose -f infra/docker-compose.prod.yml logs --tail=100  # last 100 lines
```

### Restart a service

```bash
docker compose -f infra/docker-compose.prod.yml restart api
docker compose -f infra/docker-compose.prod.yml restart web
```

### Update Omyxia

```bash
cd /opt/omyxia
git pull
docker compose -f infra/docker-compose.prod.yml pull
docker compose -f infra/docker-compose.prod.yml up -d
docker compose -f infra/docker-compose.prod.yml exec api pnpm db:migrate
```

### Access database directly

```bash
docker compose -f infra/docker-compose.prod.yml exec postgres psql -U omyxia -d omyxia
```

## 💾 Backups

### Manual backup

```bash
cd /opt/omyxia
./infra/backup.sh
# Output: ./backups/2026-06-28T21-50-00Z.tar.gz
```

### Automated daily backups (cron)

```bash
crontab -e
# Add line:
0 3 * * * /opt/omyxia/infra/backup.sh >> /var/log/omyxia-backup.log 2>&1
```

Backups include:
- PostgreSQL dump (compressed)
- MinIO object storage mirror
- Redis RDB snapshot
- Manifest with version info

Old backups (beyond 7 most recent) are auto-deleted.

### Restore

```bash
cd /opt/omyxia
./infra/restore.sh ./backups/2026-06-28T21-50-00Z.tar.gz
```

⚠️ Restore **replaces** current database. Confirm prompt required.

## 🔧 Configuration

### Environment variables

All config in `.env.prod` (auto-generated):

```bash
# Domain
DOMAIN=omyxia.example.com
WEB_URL=https://omyxia.example.com

# Database
POSTGRES_PASSWORD=<random>

# Auth
JWT_SECRET=<random>

# MinIO
MINIO_ROOT_USER=omyxia_admin
MINIO_ROOT_PASSWORD=<random>

# SMTP/IMAP
SMTP_USER=noreply@omyxia.example.com
SMTP_PASS=<random>
```

After editing `.env.prod`:

```bash
docker compose -f infra/docker-compose.prod.yml up -d
```

### Custom domain

1. Point DNS A record to your server
2. Re-run installer with new domain, OR
3. Edit `.env.prod` `DOMAIN` and restart caddy:
   ```bash
   docker compose -f infra/docker-compose.prod.yml restart caddy
   ```

### Adding HTTPS for subdomain tenants

For multi-tenant SaaS deployment, edit `infra/Caddyfile`:

```caddyfile
*.omyxia.example.com {
    reverse_proxy web:3000
}
```

Then add DNS wildcard `*.omyxia.example.com → your-server`.

## 🔒 Security Hardening

### 1. Enable firewall

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable
```

### 2. Disable direct database access

In `infra/docker-compose.prod.yml`, remove `postgres` from `external` network. Keep only `internal`.

### 3. Rotate secrets

```bash
cd /opt/omyxia
./infra/rotate-secrets.sh    # see script in docs
```

### 4. Enable MFA

After signup, users go to **Settings → Security → Enable MFA**.

### 5. Audit logs

All sensitive actions are logged. View at:
- **Web UI**: Settings → Audit Log (Admin only)
- **API**: `GET /api/audit` (Admin scope)

## 📊 Monitoring

### Built-in health checks

```bash
curl https://omyxia.example.com/api/health
```

Returns:

```json
{
  "status": "ok",
  "version": "0.2.0",
  "services": {
    "postgres": "up",
    "redis": "up",
    "minio": "up",
    "stalwart": "up"
  }
}
```

### Resource usage

```bash
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
```

### Logs to external service (optional)

Edit `infra/docker-compose.prod.yml` and add to api service:

```yaml
logging:
  driver: syslog
  options:
    syslog-address: "tcp://logs.example.com:514"
```

## 🚨 Troubleshooting

### Services won't start

```bash
docker compose -f infra/docker-compose.prod.yml ps
docker compose -f infra/docker-compose.prod.yml logs api
```

Common causes:
- Port 80/443 already in use → stop nginx/apache
- Insufficient memory → check `docker stats`
- Disk full → `df -h`

### Database connection errors

```bash
docker compose -f infra/docker-compose.prod.yml exec postgres pg_isready -U omyxia
```

If not ready, check logs: `docker compose -f infra/docker-compose.prod.yml logs postgres`

### Reset admin password

```bash
docker compose -f infra/docker-compose.prod.yml exec api pnpm ts-node -e "
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
const hash = await bcrypt.hash('newpassword123!', 12);
await prisma.user.update({
  where: { email: 'admin@example.com' },
  data: { passwordHash: hash }
});
console.log('Password reset');
process.exit(0);
"
```

## 🆘 Getting Help

- 📖 [Full documentation](https://github.com/open-uppu/Omyxia)
- 💬 [Community forum](https://github.com/open-uppu/Omyxia/discussions)
- 🐛 [Issue tracker](https://github.com/open-uppu/Omyxia/issues)
- 🔒 [Security issues](mailto:security@openuppu.example)

---

**License**: AGPL-3.0 — see [LICENSE](../LICENSE)