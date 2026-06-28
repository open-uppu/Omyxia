#!/usr/bin/env bash
# Omyxia — Restore from Backup
# Usage: ./infra/restore.sh /path/to/backup.tar.gz

set -euo pipefail

readonly COMPOSE_FILE="infra/docker-compose.prod.yml"
readonly ENV_FILE=".env.prod"
readonly BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" ]]; then
    echo "Usage: $0 <backup.tar.gz>"
    echo ""
    echo "Available backups:"
    ls -1t ./backups/*.tar.gz 2>/dev/null | head -10 || echo "  (none found)"
    exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
    echo "Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Load env
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

WORK_DIR=$(mktemp -d)
echo "Extracting to $WORK_DIR..."
tar -xzf "$BACKUP_FILE" -C "$WORK_DIR"

# Find the latest subdir
BACKUP_DIR=$(ls -1td "$WORK_DIR"/*/ | head -1)
echo "Restoring from $BACKUP_DIR"

# ===== Confirm =====
read -rp "⚠️  This will REPLACE the current database. Continue? (yes/no): " confirm
if [[ "$confirm" != "yes" ]]; then
    echo "Aborted"
    rm -rf "$WORK_DIR"
    exit 1
fi

# ===== PostgreSQL =====
echo "Restoring PostgreSQL..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --no-owner --if-exists \
    < "$BACKUP_DIR/postgres.dump"

echo "✅ PostgreSQL restored"

# ===== MinIO =====
if [[ -d "$BACKUP_DIR/minio" ]]; then
    echo "Restoring MinIO..."
    docker compose -f "$COMPOSE_FILE" exec -T minio \
        sh -c "mc alias set local http://localhost:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD && mc mirror --overwrite /tmp/minio-restore local/omyxia" || true
    echo "✅ MinIO restored"
fi

# ===== Cleanup =====
rm -rf "$WORK_DIR"

echo "✅ Restore complete. Restart services: docker compose -f $COMPOSE_FILE restart"