#!/usr/bin/env bash
# permissions-capture-weekly.sh — permission-review-loop Task 10.
#
# Weekly LOCAL capture of the permission-review candidate list, committed onto a dedicated
# `permissions-capture` branch off a freshly-fetched origin/main (never the primary's branch, never
# blocked by a dirty primary). The harness-weekly GitHub workflow (Task 16) fetches this branch and
# renders the artifact into the Monday PR.
#
# WHY the split: the candidate data (`.harness/permissions/ledger.jsonl` + the session transcripts
# under ~/.claude/projects/<slug>) lives ONLY in the primary checkout and is gitignored/machine-local
# — CI can't see it. So capture COMPUTES in the primary checkout, but the git COMMIT is isolated in a
# throwaway worktree on the capture branch. The primary checkout is restored to pristine afterward.
#
# Run by launchd/cron (see docs/ops/permission-review-cron.md), or manually. Never blocks; safe to
# re-run. Uses --force-with-lease so a concurrent push is detected rather than clobbered.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # scripts/harness/ -> repo root
cd "$ROOT"

WT="$ROOT/.harness/permissions-wt"
BRANCH="permissions-capture"
REMOTE="origin"
REVIEW_REL="docs/superpowers/metrics/permissions-review"
MANAGED_REL="docs/superpowers/metrics/permissions-managed.json"
WEEK=""

cleanup() {
  git worktree remove --force "$WT" 2>/dev/null || true
  rm -rf "$WT" 2>/dev/null || true
  # Restore the primary checkout so this wrapper never leaves it dirtied: revert the tracked managed
  # map and delete the (untracked) review artifacts this run produced.
  if [ -n "$WEEK" ]; then
    git checkout -- "$MANAGED_REL" 2>/dev/null || true
    rm -f "$REVIEW_REL/$WEEK.json" "$REVIEW_REL/$WEEK.md" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 0. Clear any stale worktree from a hard-killed prior run.
git worktree remove --force "$WT" 2>/dev/null || true
rm -rf "$WT" 2>/dev/null || true

# 1. Capture in the PRIMARY checkout (reads local ledger + transcripts), refreshing managed usage.
OUT="$(pnpm --filter @workspace/scripts harness:permissions:capture -- --write-managed)"
printf '%s\n' "$OUT"
WEEK="$(printf '%s\n' "$OUT" | sed -n 's/.*(week \([0-9][0-9A-Za-z-]*\)).*/\1/p' | head -1)"
if [ -z "$WEEK" ]; then
  echo "permissions-capture-weekly: could not determine the capture week from output" >&2
  exit 1
fi

JSON="$REVIEW_REL/$WEEK.json"
MD="$REVIEW_REL/$WEEK.md"
for f in "$JSON" "$MD" "$MANAGED_REL"; do
  [ -f "$ROOT/$f" ] || { echo "permissions-capture-weekly: expected artifact missing: $f" >&2; exit 1; }
done

# 2. Fresh capture-branch worktree off the freshly-fetched origin/main (clean base).
git fetch "$REMOTE" main
git worktree add --force -B "$BRANCH" "$WT" "$REMOTE/main"

# 3. Copy exactly the three artifacts into the worktree.
mkdir -p "$WT/$REVIEW_REL"
cp "$ROOT/$JSON" "$WT/$JSON"
cp "$ROOT/$MD" "$WT/$MD"
cp "$ROOT/$MANAGED_REL" "$WT/$MANAGED_REL"

# 4. Stage exactly those paths; assert nothing unexpected is staged, and the review artifacts are.
git -C "$WT" add -- "$JSON" "$MD" "$MANAGED_REL"
while IFS= read -r p; do
  [ -z "$p" ] && continue
  case "$p" in
    "$JSON" | "$MD" | "$MANAGED_REL") ;;
    *) echo "permissions-capture-weekly: unexpected staged path: $p" >&2; exit 1 ;;
  esac
done < <(git -C "$WT" diff --cached --name-only)
git -C "$WT" diff --cached --name-only | grep -qxF "$JSON" || { echo "review json not staged" >&2; exit 1; }
git -C "$WT" diff --cached --name-only | grep -qxF "$MD" || { echo "review md not staged" >&2; exit 1; }

# 5. Commit + lease-protected push (no-op-safe when the week's artifacts are byte-identical).
if git -C "$WT" diff --cached --quiet; then
  echo "permissions-capture-weekly: no changes vs origin/main; nothing to push"
else
  git -C "$WT" -c user.name="permissions-capture" -c user.email="permissions-capture@local" \
    commit -m "[permissions] weekly capture $WEEK"
  git -C "$WT" push --force-with-lease "$REMOTE" "$BRANCH"
  echo "permissions-capture-weekly: pushed $BRANCH ($WEEK)"
fi
