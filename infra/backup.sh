#!/usr/bin/env bash
# Omyxia — Automated Backup Script
# Usage: ./infra/backup.sh [--output /path/to/backups]
# Cron:  0 3 * * * /opt/omyxia/infra/backup.sh

set -euo pipefail

readonly COMPOSE_FILE="infra/docker-compose.prod.yml"
readonly ENV_FILE=".env.prod"
readonly BACKUP_ROOT="${1:-./backups}"
readonly TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
readonly BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

log() { printf "\033[1;34m[backup]\033[0m %s\n" "$*"; }
ok()  { printf "\033[1;32m[ok]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[error]\033[0m %s\n" "$*" >&2; }

# Load env
if [[ ! -f "$ENV_FILE" ]]; then
    err "$ENV_FILE not found. Run install.sh first."
    exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

mkdir -p "$BACKUP_DIR"

log "Backing up to $BACKUP_DIR"

# ===== PostgreSQL =====
log "Dumping PostgreSQL..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner \
    > "$BACKUP_DIR/postgres.dump"

ok "PostgreSQL dumped: $(du -h "$BACKUP_DIR/postgres.dump" | cut -f1)"

# ===== MinIO =====
log "Mirroring MinIO bucket..."
docker compose -f "$COMPOSE_FILE" exec -T minio \
    sh -c "mc alias set local http://localhost:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD 2>/dev/null && mc mirror --overwrite local/omyxia /tmp/minio-backup" || \
    log "MinIO mirror skipped (no mc client in container)"

# Note: For production, install mc in minio image or use aws cli
# For now, we recommend using `mc` from host:
#   mc alias set omyxia http://localhost:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD
#   mc mirror --overwrite omyxia/omyxia "$BACKUP_DIR/minio/"

# ===== Redis (optional, RDB snapshot) =====
log "Snapshotting Redis..."
docker compose -f "$COMPOSE_FILE" exec -T redis \
    sh -c "redis-cli BGSAVE" >/dev/null 2>&1 || log "Redis snapshot skipped"

# ===== Manifest =====
cat > "$BACKUP_DIR/manifest.json" <<EOF
{
  "timestamp": "$TIMESTAMP",
  "omyxia_version": "$(git describe --tags --always 2>/dev/null || echo 'unknown')",
  "components": ["postgres", "minio", "redis"]
}
EOF

# ===== Compress =====
log "Compressing..."
tar -czf "$BACKUP_DIR.tar.gz" -C "$BACKUP_ROOT" "$TIMESTAMP"
rm -rf "$BACKUP_DIR"

ok "Backup complete: $BACKUP_DIR.tar.gz"
ok "Size: $(du -h "$BACKUP_DIR.tar.gz" | cut -f1)"

# Cleanup old backups (keep last 7)
log "Cleaning up old backups (keeping last 7)..."
ls -1t "$BACKUP_ROOT"/*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f

ok "Done"