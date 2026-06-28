#!/usr/bin/env bash
# Omyxia — One-command Self-host Installer
# Usage: curl -fsSL https://get.omyxia.io | bash
# Or:    ./install.sh [--domain example.com] [--email admin@example.com]

set -euo pipefail

# ===== Constants =====
readonly REPO_URL="https://github.com/open-uppu/Omyxia.git"
readonly INSTALL_DIR="${OMYXIA_INSTALL_DIR:-./omyxia}"
readonly COMPOSE_FILE="infra/docker-compose.prod.yml"
readonly ENV_FILE=".env.prod"
readonly MIN_PASSWORD_LEN=16
REQUIRED_CMDS=(docker openssl curl)

# ===== Helpers =====
log() { printf "\033[1;34m[omyxia]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[error]\033[0m %s\n" "$*" >&2; }
ok()  { printf "\033[1;32m[ok]\033[0m %s\n" "$*"; }

gen_secret() { openssl rand -hex 32; }
gen_password() { openssl rand -base64 24 | tr -d '+/=' | head -c 32; }

die() { err "$*"; exit 1; }

# ===== Pre-flight checks =====
preflight() {
    log "Pre-flight checks..."

    for cmd in "${REQUIRED_CMDS[@]}"; do
        command -v "$cmd" >/dev/null 2>&1 || die "Missing required command: $cmd"
    done

    if ! docker compose version >/dev/null 2>&1; then
        die "Docker Compose v2 not found. Install: https://docs.docker.com/compose/install/"
    fi

    if ! docker info >/dev/null 2>&1; then
        die "Docker daemon not running. Start Docker first."
    fi

    ok "All checks passed"
}

# ===== Prompt for config =====
prompt_config() {
    local domain="${OMYXIA_DOMAIN:-}"
    local email="${OMYXIA_EMAIL:-}"

    if [[ -z "$domain" ]]; then
        read -rp "Domain (default: localhost): " domain
        domain="${domain:-localhost}"
    fi

    if [[ -z "$email" ]]; then
        read -rp "Admin email: " email
        [[ -z "$email" ]] && die "Admin email required"
    fi

    DOMAIN="$domain"
    ADMIN_EMAIL="$email"

    if [[ "$domain" == "localhost" ]]; then
        WEB_URL="http://localhost"
        CORS_ORIGIN="http://localhost"
        ok "Localhost mode (self-signed cert via Caddy)"
    else
        WEB_URL="https://$domain"
        CORS_ORIGIN="https://$domain"
        ok "Domain mode: $WEB_URL (auto-TLS via Let's Encrypt)"
    fi
}

# ===== Generate secrets =====
generate_env() {
    log "Generating secrets..."

    local jwt_secret db_password minio_password smtp_pass
    jwt_secret=$(gen_secret)
    db_password=$(gen_password)
    minio_password=$(gen_password)
    smtp_pass=$(gen_password)

    cat > "$ENV_FILE" <<EOF
# Omyxia Production Environment
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

DOMAIN=$DOMAIN
WEB_URL=$WEB_URL
CORS_ORIGIN=$CORS_ORIGIN

POSTGRES_USER=omyxia
POSTGRES_PASSWORD=$db_password
POSTGRES_DB=omyxia

REDIS_URL=redis://redis:6379

MINIO_ROOT_USER=omyxia_admin
MINIO_ROOT_PASSWORD=$minio_password
MINIO_PUBLIC_URL=${MINIO_PUBLIC_URL:-http://localhost:9000}

JWT_SECRET=$jwt_secret
JWT_EXPIRES_IN=15m
REFRESH_EXPIRES_IN=7d

SMTP_USER=noreply@$DOMAIN
SMTP_PASS=$smtp_pass
STALWART_HOSTNAME=mail.$DOMAIN
STALWART_DOMAIN=$DOMAIN

ADMIN_EMAIL=$ADMIN_EMAIL
EOF

    ok "Generated $ENV_FILE"
    echo "  DB password: $db_password"
    echo "  MinIO password: $minio_password"
    echo "  SMTP password: $smtp_pass"
}

# ===== Clone or update repo =====
clone_repo() {
    if [[ -d "$INSTALL_DIR" ]]; then
        log "Directory $INSTALL_DIR exists, skipping clone"
        cd "$INSTALL_DIR"
    else
        log "Cloning Omyxia repository..."
        git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
        ok "Cloned to $INSTALL_DIR"
    fi
}

# ===== Start services =====
start_services() {
    log "Starting services (this may take 2-3 minutes)..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

    log "Waiting for services to be healthy..."
    local retries=60
    while (( retries > 0 )); do
        if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps --format json 2>/dev/null | grep -q '"Health":"healthy"' ; then
            ok "Services healthy"
            return 0
        fi
        sleep 5
        (( retries-- ))
    done
    err "Services did not become healthy in 5 minutes. Check: docker compose -f $COMPOSE_FILE logs"
    return 1
}

# ===== Run migrations =====
run_migrations() {
    log "Running database migrations..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api pnpm db:migrate
    ok "Migrations applied"
}

# ===== Seed data =====
run_seed() {
    local answer="${OMYXIA_SEED:-}"
    if [[ -z "$answer" ]]; then
        read -rp "Seed demo data? (y/N): " answer
    fi

    if [[ "$answer" =~ ^[Yy]$ ]]; then
        log "Seeding demo data..."
        docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api pnpm db:seed
        ok "Seeded: tenant=acme-th-demo user=admin@acme-th.demo pass=demo123!"
    else
        log "Skipping seed"
    fi
}

# ===== Print success =====
print_success() {
    local url="$WEB_URL"
    cat <<EOF

$(ok "🎉 Omyxia installed successfully!")

  URL:           $url
  Admin email:   $ADMIN_EMAIL

  Next steps:
    1. Open $url in your browser
    2. Sign in (if seeded): admin@acme-th.demo / demo123!
    3. Or create your own tenant at /signup

  Useful commands:
    cd $INSTALL_DIR
    docker compose -f $COMPOSE_FILE logs -f       # View logs
    docker compose -f $COMPOSE_FILE ps             # Service status
    docker compose -f $COMPOSE_FILE restart api     # Restart API
    ./infra/backup.sh                              # Backup data

  Documentation: https://github.com/open-uppu/Omyxia/blob/main/docs/SELF-HOST.md

EOF
}

# ===== Main =====
main() {
    preflight
    prompt_config
    clone_repo
    generate_env
    start_services
    run_migrations
    run_seed
    print_success
}

main "$@"