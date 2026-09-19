# Weekly permission-review capture (local cron)

The permission-review loop's candidate list is built from **machine-local** data — the PreToolUse
ledger (`.harness/permissions/ledger.jsonl`) and the session transcripts under
`~/.claude/projects/<slug>/` — which GitHub Actions cannot see. So the capture step runs **locally**,
on a schedule, and pushes a committed artifact to the dedicated `permissions-capture` branch. The
Monday harness-weekly workflow fetches that branch and renders the artifact into the PR.

`scripts/harness/permissions-capture-weekly.sh` does the capture + commit + lease-protected push. It
runs the capture in the primary checkout (the only place the local data lives), commits onto a
throwaway worktree on the `permissions-capture` branch off a freshly-fetched `origin/main`, then
restores the primary checkout to pristine. It never blocks on a dirty primary and is safe to re-run.

## Manual run / smoke check

```bash
# Dry-run (writes nothing, prints the week + candidate count):
pnpm harness:permissions:capture --dry-run

# Real weekly capture + push to the permissions-capture branch:
bash scripts/harness/permissions-capture-weekly.sh
```

## Schedule it (macOS launchd)

Run early Monday (before the 13:00 UTC harness-weekly workflow). Create
`~/Library/LaunchAgents/com.nos.permission-capture.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.nos.permission-capture</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/shubhamkr/network-optimization-studio/scripts/harness/permissions-capture-weekly.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <!-- Mondays 12:30 (local time); adjust for your TZ so it lands before 13:00 UTC. -->
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>12</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/nos-permission-capture.log</string>
  <key>StandardErrorPath</key><string>/tmp/nos-permission-capture.err</string>
  <key>WorkingDirectory</key><string>/Users/shubhamkr/network-optimization-studio</string>
</dict>
</plist>
```

Install / uninstall:

```bash
launchctl load   ~/Library/LaunchAgents/com.nos.permission-capture.plist
launchctl unload ~/Library/LaunchAgents/com.nos.permission-capture.plist
```

(Linux cron equivalent: `30 12 * * 1 cd /path/to/repo && bash scripts/harness/permissions-capture-weekly.sh >> /tmp/nos-permission-capture.log 2>&1`.)

## Notes / caveats

- **Staleness is accepted.** If the local job doesn't run a given week, the Monday PR renders the last
  committed artifact; the apply step enforces a freshness limit (`--max-age-days`, default 8) so a
  stale artifact can't silently grant a capability.
- **The capture branch is reset off origin/main each run** (`-B`), so it always carries just the
  latest week's artifact — a transient carrier, not a history.
- **Primary-checkout restoration** reverts `permissions-managed.json` and removes the week's review
  files after committing them to the capture branch. If you happen to have an *uncommitted* edit to
  `permissions-managed.json` when the job runs, it will be reverted — don't hand-edit that file and
  leave it dirty across a Monday run.
