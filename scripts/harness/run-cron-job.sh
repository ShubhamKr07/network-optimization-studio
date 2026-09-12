#!/usr/bin/env bash
# Cron wrapper: run a harness job prompt headlessly via the Claude CLI.
# Usage: run-cron-job.sh <prompt-file-relative-to-repo>
#
# NOTE: unattended runs need gh auth (keyring) + any MCP auth already established, and bypass
# permission prompts (--allow-dangerously-skip-permissions) since there is no TTY. The Sunday job
# opens a PR but never merges; the weekly job only writes a report on a branch. Logs land in
# .harness/cron/ (gitignored). If a job can't proceed (dirty tree, servers down) its prompt tells it
# to stop cleanly rather than force.
set -euo pipefail

REPO="/Users/shubhamkr/network-optimization-studio"
# cron has a minimal PATH — add the tools the jobs need.
export PATH="/Users/shubhamkr/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

PROMPT_REL="${1:?usage: run-cron-job.sh <prompt-file>}"
PROMPT_FILE="$REPO/$PROMPT_REL"
[ -f "$PROMPT_FILE" ] || { echo "prompt not found: $PROMPT_FILE" >&2; exit 1; }

cd "$REPO"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOGDIR="$REPO/.harness/cron"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/$(basename "$PROMPT_REL" .md)-$STAMP.log"

echo "[$STAMP] running $PROMPT_REL" >> "$LOG"
claude -p "$(cat "$PROMPT_FILE")" --allow-dangerously-skip-permissions >> "$LOG" 2>&1
echo "[$(date +%Y%m%d-%H%M%S)] done (exit $?)" >> "$LOG"
