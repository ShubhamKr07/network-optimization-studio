#!/usr/bin/env bash
# Verification gate that refuses to report a load-poisoned run (gates/flaky_test.md).
#
# Runs the same four steps as CLAUDE.md's verification gate, in order, stopping at
# the first failure. After each vitest suite it searches the output for vitest's
# timeout strings; any hit means the result reflects machine load rather than the
# code, so the gate exits 3 instead of reporting pass/fail.
#
# Usage:  pnpm gate        (DATABASE_URL must be set for api-server, as for the bare gate)
# Exit:   0 green · 1 a step failed (a real failure) · 3 timeout seen, re-run serially
set -uo pipefail

cd "$(git rev-parse --show-toplevel)"
LOG="$(mktemp "${TMPDIR:-/tmp}/nos-gate.XXXXXX")"
trap 'rm -f "$LOG"' EXIT

step() {
  local name="$1"; shift
  echo "== gate: $name"
  "$@" 2>&1 | tee "$LOG"
  local rc=${PIPESTATUS[0]}
  local timeouts; timeouts=$(grep -cE "(Test|Hook) timed out" "$LOG")
  if [ "$timeouts" -gt 0 ]; then
    echo "GATE RESULT NOT TRUSTWORTHY — '$name' hit a vitest timeout ($timeouts lines)."
    echo "Re-run serially with zero concurrent vitest before reading this as pass or fail."
    exit 3
  fi
  [ "$rc" = "0" ] || { echo "== gate: $name FAILED (exit $rc)"; exit 1; }
}

step typecheck pnpm run typecheck
step api-server pnpm --filter api-server test
step studio pnpm --filter studio test
step solver bash -c "cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x"
echo "== gate: GREEN"
