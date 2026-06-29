#!/usr/bin/env bash
# Apply @Roles() decorators to write endpoints across all module controllers.
# Idempotent. Skips files that already have @Roles decorators present.
set -euo pipefail
API="apps/api/src/modules"

DEFAULT_WRITE_ROLES="@Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')"
DELETE_ROLES="@Roles('OWNER', 'ADMIN')"
HR_WRITE="@Roles('OWNER', 'ADMIN', 'HR_MANAGER', 'MANAGER')"
FINANCE_WRITE="@Roles('OWNER', 'ADMIN', 'ACCOUNTANT')"
SENSITIVE_WRITE="@Roles('OWNER', 'ADMIN')"
SENSITIVE_DELETE="@Roles('OWNER')"
OWNER_ONLY_WRITE="@Roles('OWNER')"
OWNER_ONLY_DELETE="@Roles('OWNER')"

apply() {
  local file="$1"
  local write_dec="$2"
  local delete_dec="$3"

  if grep -qE "@Roles\\(" "$file"; then
    echo "skip (already decorated): $file"
    return 0
  fi

  python3 - "$file" "$write_dec" "$delete_dec" <<'PY'
import sys, re, pathlib
path = pathlib.Path(sys.argv[1])
WRITE_DEC = sys.argv[2]
DEL_DEC = sys.argv[3]
src = path.read_text()

# 1) Insert import line right after the last top-level import
lines = src.split('\n')
last_import = -1
for i, ln in enumerate(lines):
    if ln.startswith('import ') or ln.startswith('from '):
        last_import = i
if last_import == -1:
    raise SystemExit(f"No imports found in {path}")
lines.insert(last_import + 1, "import { Roles } from '../auth/rbac/roles.decorator';")
src = '\n'.join(lines)

# 2) For every @Post/@Patch/@Put/@Delete decorator line, prepend a @Roles(...)
#    line.  Use multiline regex on the full text. The decorator itself is the
#    whole match (e.g. "@Post('leads')") and we just insert the @Roles line
#    before it.
def insert_dec(m):
    verb = m.group(1)
    dec = DEL_DEC if verb == 'Delete' else WRITE_DEC
    return f"{dec}\n  @{verb}"

src = re.sub(r'@(Post|Patch|Put|Delete)\b', insert_dec, src)

path.write_text(src)
print(f"updated: {path}")
PY
}

mode_default() { apply "$1" "$DEFAULT_WRITE_ROLES" "$DELETE_ROLES"; }
mode_hr()      { apply "$1" "$HR_WRITE"                "$DELETE_ROLES"; }
mode_finance() { apply "$1" "$FINANCE_WRITE"           "$DELETE_ROLES"; }
mode_sens()    { apply "$1" "$SENSITIVE_WRITE"         "$SENSITIVE_DELETE"; }
mode_owner()   { apply "$1" "$OWNER_ONLY_WRITE"        "$OWNER_ONLY_DELETE"; }

for f in \
  departments/departments.controller.ts \
  employees/employees.controller.ts \
  workspace/chat.controller.ts \
  workspace/email.controller.ts \
  workspace/files.controller.ts \
  specialized/backup.controller.ts \
  specialized/dms.controller.ts \
  specialized/endpoint-security.controller.ts \
  specialized/fms.controller.ts \
  specialized/frm.controller.ts \
  specialized/itsm.controller.ts \
  specialized/mas.controller.ts \
  specialized/pms.controller.ts \
  specialized/srm.controller.ts \
  specialized/wms.controller.ts \
  governance/bi.controller.ts \
  governance/cmp.controller.ts
do
  mode_default "$API/$f"
done

for f in hr/attendance.controller.ts hr/leave.controller.ts hr/positions.controller.ts; do
  mode_hr "$API/$f"
done

for f in erp/ap.controller.ts erp/ar.controller.ts erp/chart-of-accounts.controller.ts erp/fiscal-period.controller.ts erp/journal.controller.ts erp/tax.controller.ts; do
  mode_finance "$API/$f"
done

mode_sens  "$API/hr/payroll.controller.ts"
mode_owner "$API/tenants/tenants.controller.ts"

echo "DONE"