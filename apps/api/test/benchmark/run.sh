#!/usr/bin/env bash
set -euo pipefail

# Run benchmarks against a local API instance.
# Usage: ./run.sh [BASE_URL] [TOKEN]

BASE="${1:-http://localhost:3001}"
TOKEN="${2:-$(cat /tmp/test-token.txt 2>/dev/null || echo '')}"

mkdir -p reports

export BASE TOKEN

for f in scenarios/*.js; do
  echo "==> $f"
  k6 run --env BASE="$BASE" --env TOKEN="$TOKEN" \
    --out json=reports/"$(basename $f .js)".json \
    --out text=reports/"$(basename $f .js)".txt \
    "$f" || true
done

echo ""
echo "Reports in reports/"
ls -la reports/
