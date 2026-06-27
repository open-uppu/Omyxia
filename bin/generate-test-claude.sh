#!/usr/bin/env bash
set -uo pipefail

usage() {
  echo "Usage: $0 path/to/service.ts" >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

service_path="$1"

if [[ "$service_path" != *.ts ]]; then
  echo "Error: service file path must end with .ts" >&2
  usage
  exit 1
fi

spec_path="${service_path%.ts}.spec.ts"

prompt=$(printf '%s\n' \
  "Create a Vitest unit test file for the service at ${service_path}." \
  "" \
  "Write the test to ${spec_path}." \
  "" \
  "Requirements:" \
  "- Use Vitest." \
  "- Mock PrismaService." \
  "- Mock TenantContextService." \
  "- Follow the repository's existing unit test conventions." \
  "- Keep the test focused on the service behavior and do not modify unrelated files." \
  "- Run an appropriate targeted test or typecheck command if one is available.")

echo "Generating Vitest unit test with Claude..."
echo "Service: ${service_path}"
echo "Spec:    ${spec_path}"
echo

claude -p --dangerously-skip-permissions "$prompt"
status=$?

echo
echo "Summary:"
echo "- Service file: ${service_path}"
echo "- Spec file: ${spec_path}"
echo "- claude exit code: ${status}"

exit "$status"