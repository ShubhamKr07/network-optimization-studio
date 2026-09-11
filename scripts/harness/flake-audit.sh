#!/usr/bin/env bash
# Flake audit: run the e2e gate lane N times on a FROZEN commit with retries=0, aggregate per-test
# pass/fail into docs/superpowers/metrics/flake.csv, and print the flaky (0<rate<1) + broken (rate=1)
# tables. Exits non-zero if any test is flaky.
#
# Usage:  bash scripts/harness/flake-audit.sh [--runs N]        (default N=20)
#
# Prereqs (this repo has NO playwright webServer — start dev servers by hand first):
#   1) api-server:  DATABASE_URL=postgresql://shubhamkr@localhost:5432/nos_dev PORT=3001 \
#                     pnpm --filter api-server run dev
#   2) studio:      PORT=5174 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 \
#                     pnpm --filter studio run dev
#   3) export E2E_BASE_URL=http://localhost:5174   (else the config defaults to a dead Replit URL)
#
# Notes on the flake surface (why some specs are inherently unstable here):
#   - e2e currently drives REAL CBC solves through the running api-server (nothing is seeded); specs
#     that wait on solve completion depend on real CBC timing. e2e SHOULD seed solver results and
#     leave real CBC timing to pytest.
#   - some specs share DB rows / wait on wall-clock; those are the usual @flaky candidates.
#   - labs.spec.ts is pre-D0 dead (targets the old Replit API shape) and is excluded from the gate.
set -euo pipefail

RUNS=20
while [ $# -gt 0 ]; do
  case "$1" in
    --runs) RUNS="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Frozen-commit audit: only TRACKED modifications matter. Untracked files (PDFs, .pnpm-store, etc.)
# are irrelevant, so ignore them (-uno).
if [ -n "$(git status --porcelain -uno)" ]; then
  echo "flake-audit: refusing to run with uncommitted tracked changes (commit or stash first)" >&2
  exit 2
fi

SHA="$(git rev-parse HEAD)"
# Persistent (gitignored) work dir so a partial run survives an interrupt and stays aggregatable.
# Cleared at start; removed only on a clean finish (see end).
WORK="$ROOT/.harness/flake-runs"
rm -rf "$WORK"; mkdir -p "$WORK"
echo "flake-audit: $RUNS runs on $SHA (retries=0, gate lane = grep-invert @flaky)"
echo "flake-audit: run reports in $WORK (aggregate manually if interrupted)"

for i in $(seq 1 "$RUNS"); do
  echo "  run $i/${RUNS} ..."
  # Write JSON to a FILE via PLAYWRIGHT_JSON_OUTPUT_NAME (not stdout) so pnpm/node banners can't
  # contaminate the report. Failures must NOT abort the loop (a failing run is the signal).
  PLAYWRIGHT_JSON_OUTPUT_NAME="$WORK/run_$i.json" \
    pnpm --filter studio exec playwright test --retries=0 --grep-invert @flaky --reporter=json \
    > "$WORK/run_$i.out" 2> "$WORK/run_$i.err" || true
  # A run that produced no JSON (infra failure, servers down) is fatal — don't silently score 0.
  if [ ! -s "$WORK/run_$i.json" ] || ! head -c1 "$WORK/run_$i.json" | grep -q '{'; then
    echo "flake-audit: run $i produced no JSON report — are the dev servers up? See $WORK/run_$i.err" >&2
    tail -5 "$WORK/run_$i.err" >&2 || true
    exit 3
  fi
done

# Aggregate + write flake.csv + print tables + exit non-zero if any flaky.
pnpm --filter @workspace/scripts exec tsx ./src/harness/lib/flakeAggregate.ts --sha "$SHA" "$WORK"/run_*.json
STATUS=$?
# Clean the work dir only on a clean finish; keep it for inspection if aggregation flagged flaky.
if [ "$STATUS" -eq 0 ]; then rm -rf "$WORK"; fi
exit "$STATUS"
