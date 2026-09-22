# Shutdown budget — `nos-api`

Scope: `nos-api` only (`srv-d9hglg6pbkes73a1j8b0`, Render Docker web service). Not
applicable to `nos-studio` (static site, no running process to drain) or
`nos-postgres` (managed by Render).

## Two deadlines, not one

There are two separate clocks running from the moment Render decides to stop
the instance (deploy, scale-down, restart):

1. **Platform deadline — 120 s.** Render's `maxShutdownDelaySeconds` on the
   `nos-api` service in `render.yaml`. This is the hard ceiling: Render sends
   `SIGTERM`, waits up to this many seconds, then **unconditionally
   `SIGKILL`s** the process (and everything in it) regardless of what the app
   is doing. Valid range is 1–300 s; the platform default is 30 s. 120 s is
   chosen deliberately:
   - Well below the 300 s cap, so one long solve can never block a deploy for
     minutes — a deploy that always waits the full cap would make every
     rollback/redeploy slow regardless of whether a solve was actually
     in-flight.
   - Generous relative to the teaching datasets' actual solve times (all
     sub-second per `docs/CHANGELOG-implementation.md`'s recorded
     `runTimeSec` values across every shipped model) — the budget exists for
     the tail case, not the common case.

2. **App-internal deadline — 90 s.** The budget the running Node process
   allocates itself for its own shutdown sequence, enforced entirely
   in-process (this is app logic, not a Render setting — owned by A2/A3, not
   this task). It is **90 s = 120 s − 30 s margin**. The margin exists
   because the platform's `SIGKILL` at 120 s is unconditional and gives the
   app zero chance to react, clean up, or log anything once it fires — the
   app must finish (or safely abandon) its own sequence with room to spare,
   not race the platform's kill signal.

## App-internal allocation (sums to 90 s)

| Step | Budget | Notes |
|---|---|---|
| Stop admission + stop scan | immediate | Reject new solve requests; stop the job-runner from picking up new queued jobs. No meaningful time cost — this is a flag flip, not I/O. |
| In-flight solve grace | 60 s | Let any already-running CBC solve finish naturally. This is the dominant share of the budget on purpose — a solve that's already running is the one thing worth waiting for; everything else below is cleanup that should be fast and bounded. |
| TERM grace | 5 s | If a solve is still running after the 60 s grace, send `SIGTERM` to the child process group and wait briefly for a clean exit. |
| KILL + bounded group-death probe | 10 s | If TERM didn't work, `SIGKILL` the process group and poll/verify it's actually dead (CBC can fork helper processes — A3's process-group supervisor owns killing the whole group, not just the immediate child). |
| Temp cleanup | 5 s | Remove any solver scratch files/temp directories left by the interrupted or completed solve. |
| DB terminal/ownership-release update | 5 s | Move the job's `solve_jobs` row to a terminal state (see below) and release any ownership/lock markers, so nothing is left claimed by a process that's about to disappear. |
| PostHog/Sentry flush | 5 s | Best-effort flush of any buffered telemetry before the process exits. |
| **Total** | **90 s** | |

## What happens to an in-flight solve that doesn't finish in time

An in-flight solve that is still running when the remaining budget runs out
is **interrupted by the deploy**, not paused or resumed later:

- It is terminated via A3's process-group supervisor (both the immediate
  child and any of its forked helpers).
- Its `solve_jobs` row is moved, ownership-checked, to a **terminal**
  outcome — `interrupted` or `failed` — never left `"running"` or
  `"queued"`.
- **Nothing requeues it.** This bundle performs no automatic retry of an
  interrupted solve; a student/operator who needs the result re-runs it
  explicitly.
- Deploys are therefore **never held open by an unbounded solve** — the
  platform's 120 s ceiling guarantees a deploy always completes (successfully
  or by killing whatever's left) within a bounded, known window.

## Live-setting verification — deferred

This task changes `render.yaml` (the Blueprint source of truth) and adds
this runbook. It does **not** verify the *live* `nos-api` service setting on
Render — no Render API access was used or attempted here. The controller is
responsible for confirming, via Render MCP/dashboard after this change
merges and deploys, that the live service's shutdown-delay setting actually
matches this Blueprint value (120 s), the same "Blueprint vs. live drift"
risk already documented for `nos-studio`'s SPA-fallback rewrite in
`CLAUDE.md`'s gotchas.
