# v2 write activation — `SOLVER_V2_WRITE_ENABLED`

Scope: `nos-api` only (`srv-d9hglg6pbkes73a1j8b0`, Render Docker web service). This
runbook governs the R3 step of the staged v1→v2 rollout (SCN v0.3 Correctness
Option A) — see `docs/superpowers/plans/2026-09-22-scnd-correctness-A-full-contract.md`
Task A11 and `docs/superpowers/specs/2026-09-21-scnd-solver-result-contract-design.md`
§2.13/§2.14 for the full release-state matrix this runbook implements.

## The flag

- **Env var:** `SOLVER_V2_WRITE_ENABLED`, read by `nos-api` at process start.
- **Strict accepted values:** the literal strings `"true"` or `"false"` only.
  Anything else — unset, blank, `"1"`, `"0"`, mixed case (`"True"`, `"TRUE"`) —
  resolves to `false`. Implemented by `parseStrictBool()` in
  `artifacts/api-server/src/config/featureFlags.ts`, which mirrors
  `jobRunner.ts`'s existing `parsePositiveIntEnv` strictness.
- **Default: OFF (`false`).** Consumers call `isV2WriteEnabled()`; nothing else
  reads `process.env.SOLVER_V2_WRITE_ENABLED` directly.
- **Fail-closed.** A misconfigured or missing value never silently enables v2
  writes.
- The resolved value is logged once at process startup (see the module's own
  `logger.info` call) alongside the build/contract-version signal, so a
  deployed instance's actual resolved flag state is visible in logs without
  needing to inspect the Render dashboard.

## A commit is not an environment flip — two different operations

**Landing this flag module (default OFF) is a Git commit** — task A11,
reviewed and merged like any other code change.

**Enabling it is a separate, external, product-owner-authorized Render
environment change.** It is never done by editing `render.yaml` and pushing —
`SOLVER_V2_WRITE_ENABLED` is deliberately **not** declared in `render.yaml`'s
`envVars` list. It is set directly in the Render dashboard for `nos-api`, out
of band from any Git commit, specifically so that toggling it does not itself
require (or accidentally trigger) a code deploy.

These two operations must never be conflated in any record: a PR merging code
that references `isV2WriteEnabled()` is not evidence the flag is on in any
real environment, and flipping the flag in Render is not evidence any
particular commit's code is what's running.

## Who authorizes

The `SOLVER_V2_WRITE_ENABLED` flip is a **product-owner decision** — the same
authority that signed **DEC-2026-09-21-01** (the `e2e_accuracy.py` truthful-
status correction). No agent, and no task in this plan, may flip it
unilaterally. This runbook is the artifact the product owner uses to execute
that decision once they've made it; it does not itself constitute approval.

## R3 activation prerequisites (normative — ALL required)

Activation is blocked if ANY of the following is missing, regardless of the
flag's own state:

- `A0`, `A1`, `A2`, `A3`, `A4`, `A5`, `A6`, `A7`, `A8`, `A9`, `A12`, `A14a`,
  `A14b` — all landed. (`A10` removed from the plan — not a prerequisite.)
- This task (**A11**)'s default-off flag module + this runbook — landed.
- **A13a** (QA pre-activation gate) — **committed and reviewed**, before the
  flag is flipped in any real environment.
- The **Linux no-orphan evidence** from A3 (process-group kill/cleanup proof
  on the production OS).
- **Pre-R1 drain evidence**, per the Render-lifecycle rule below.
- The **approved G-cache artifact**
  (`docs/superpowers/specs/2026-09-23-scnd-gcache-artifact.md`) — approved
  2026-09-23, Option 1 (cache per-runtime-build).

Any missing item is a stop condition for activation — this list is checked in
full every time, not assumed satisfied because it was satisfied before.

## Drain proof — from the Render deploy lifecycle, not health sampling

Version-signal polling (hitting a live endpoint and checking a reported build
version) **cannot prove drain**: once Render's proxy switches traffic to the
new revision, every request is routed to the new revision while the old one
may still be draining in the background and is no longer externally
sampleable. "No response carries a pre-R1 version" proves *routing*, not old-
process *death*.

**Primary evidence is the platform's own deploy lifecycle record:**

1. Record the successful deploy and its revision id.
2. Wait **`maxShutdownDelaySeconds` (120 s) + a 60 s margin = 180 s**
   (see `docs/ops/shutdown-budget.md` for where the 120 s figure comes from).
3. Capture Render deploy/instance/log evidence that the **prior** revision
   received `SIGTERM` and exited (or was killed) — via
   `mcp__render__list_deploys` / instance history / logs for the prior
   revision's instance id.

The build/contract-version signal (a version string embedded in a health
response) is **corroboration only** — record it if convenient, but it is
never the proof of drain by itself.

## Out-of-band activation evidence record

**Written here, in this file, BEFORE the flip** — then mirrored to
`docs/CHANGELOG-implementation.md` once the evidence commit lands (see the
suppression procedure below for why the mirror is a separate, later step).

Required fields for every activation (and every later rollback) event:

| Field | Value |
|---|---|
| Approver | (product owner name/identity) |
| UTC timestamp | (ISO 8601, when the env var was actually changed in Render) |
| Service | `nos-api` (`srv-d9hglg6pbkes73a1j8b0`) |
| Deploy id | (the Render deploy id active at the time of the flip — flipping an env var does not itself create a new deploy, so this is the deploy id already running) |
| Commit SHA | (the exact commit SHA `nos-api` was running when the flip was applied) |
| Old value | `false` (or whatever it was) |
| New value | `true` (or whatever it was set to) |
| Rollback step | Set `SOLVER_V2_WRITE_ENABLED=false` in the Render dashboard for `nos-api`. No redeploy is required — the app reads the env var at process start, so the effective change takes hold on the *next* restart/deploy; if an immediate effective change is required, trigger a manual restart of the existing revision (not a rollback to a prior deploy) so the running commit is unchanged. |

**(No activation event has occurred as of this task's commit — the table
above is the schema; a real row is appended here the first time this
procedure is actually executed, then mirrored to the changelog.)**

## `autoDeployTrigger` suppression procedure (owner: `devops-engineer`)

**Why suppression exists:** `render.yaml` previously set no
`autoDeployTrigger` for `nos-api`, meaning any push could trigger a deploy.
Writing the activation evidence record (above) to Git and pushing it could
itself trigger a **new** deploy — which would mean the flag-enabled state
described by the evidence record no longer corresponds to a stable, already-
running commit, invalidating the very commit/deploy pairing the evidence
exists to prove.

**Control:** `autoDeployTrigger: off` on the `nos-api` service in
`render.yaml`. The Blueprint is authoritative for this service (the Dashboard
is not used to configure it independently), so the Blueprint value and the
live setting cannot diverge — consistent with this repo's prior Blueprint-vs-
MCP-created-resource incident (see `CLAUDE.md`'s Render gotchas).

**Sequence:**

1. **Commit `autoDeployTrigger: off`** (this task, A11) and let that one
   deploy land normally.
2. **Verify** via `mcp__render__list_deploys` that no further deploy is
   queued or running after step 1's deploy completes.
3. The **product owner** flips `SOLVER_V2_WRITE_ENABLED` in the Render
   dashboard environment for `nos-api`. The out-of-band evidence record
   (above) is written **first**, before any Git action.
4. **Mirror the evidence to Git** — commit the filled-in evidence table to
   this file (and the changelog), confirming via `list_deploys` that this
   commit's push did **not** trigger a deploy (suppression from step 1 is
   still in effect).
5. **Restore `autoDeployTrigger`** (remove the line, or set it back to its
   prior state) in a follow-up commit, and record **that** deploy with the
   same deploy-id/commit-SHA discipline as every other deploy in this
   procedure.

**Every deploy caused by steps 1 and 5 is itself recorded** (deploy id,
commit SHA, timestamp) — suppression and restoration are not silent
operations.

## Compatibility window (7 days, R2)

- Minimum observation window: **7 days** after R2 (frontend) ships.
- Exit threshold: **zero requests from a pre-R2 client build** across that
  window, measured by the client version signal.
- The transitional `error` alias is removed in the **first release after**
  the threshold is met — never automatically, never on a timer alone.

### `error` is a safe alias, not the raw diagnostic

During the compatibility window, the public `error` field on a failed
`SolveJob` is a **serializer alias of `errorMessage`** — a fixed, server-owned
safe message derived from the `errorCode` mapping (§2.11 of the design spec).
It is **never** the raw stored `solve_jobs` diagnostic (which can hold
spawn/stderr/stdout/schema text). `error` is nullable — `null` for any
non-failed job. `errorCode`/`errorMessage` are **permanent** or the design's
public contract; only the transitional `error` alias itself is removed at
cleanup.

## Row behavior on writer disable and rollback

- Disabling `SOLVER_V2_WRITE_ENABLED` (or rolling back to a pre-R3 revision)
  **does not rewrite or delete** any already-written v2 `scenarios.result`,
  `solve_jobs.result`, or v2 `result_cache` row. They stay in place and
  readable.
- R1's three-way reader (legacy / B-unversioned / v2) is what makes this
  safe — it already knows how to read a v2 row whether or not the writer is
  currently producing new ones. This is exactly why the **rollback floor is
  R1**: rollback is never allowed below the revision that shipped the
  three-way reader once any v2 row exists.
- Unversioned (pre-A6 composite-key) `result_cache` rows remain a cache
  **miss** under the v2 key — never read, never trusted, left in place.
- No automatic backfill or re-solve of any row ever happens as a side effect
  of enabling, disabling, or rolling back the flag.

## Rollback floor (standing rule)

Once any v2 row exists anywhere in the database, this service must never be
rolled back below the R1 revision (the one that shipped the three-way
reader). If rollback is needed:

1. Disable `SOLVER_V2_WRITE_ENABLED` **first** (product-owner action, evidence
   recorded per the table above, reusing the rollback-step field).
2. Only then perform any deploy-level rollback, and never past R1.

## Summary — the full state machine

| State | Writer | `SOLVER_V2_WRITE_ENABLED` | Who moves it |
|---|---|---|---|
| R1 (this repo, pre-activation) | B-format | `false` | Task A11 lands the flag; no flip yet |
| R2 | B-format | `false` | Frontend deploy only; flag unchanged |
| R3 (activated) | v2 (`PublishedSolveResultV2`) | `true` | Product owner, after ALL prerequisites above, evidence-recorded here first |
| Rollback | reverts to B-format | `false` | Product owner disables **before** any deploy-level rollback |

See `docs/superpowers/specs/2026-09-21-scnd-solver-result-contract-design.md`
§2.14 for the complete five-representation / release-state matrix this table
summarizes.
