# SCND Solver Result Contract — Spec

**Date:** 2026-09-21
**Status:** Implementation-ready draft. Pending user sign-off.
**Program context:** Carved out of the SCND scaling program (`2026-09-20-scnd-scaling-phase0-design.md`) per the 2026-09-21 split decision (Q1=Split). This is the near-term, standalone deliverable: fix the verified result-status defect with a truthful, versioned contract. It has **no** dependency on the deferred reliability/queue/measurement work and can ship on its own.

**Goal:** Replace the hardcoded `status:"optimal"` envelope with a truthful two-dimensional outcome contract (`solutionStatus` + `terminationReason`), migrate every consumer, and keep the sacred `e2e_accuracy.py` byte-for-byte passing.

**Out of scope (other specs):** durable queue / restart-safety / worker split / scheduler / horizontal scaling / single-flight / retention / stale-result publication guard (→ B2 spec); benchmark harness, MIP-start, warm-worker, Render baseline (→ measurement spec); student-facing Quick mode (→ later, once measurement justifies gap values).

---

## 1. Problem (verified)

`solve.py` returns `_envelope("optimal", status_str, …)` on every non-infeasible path (`solve_jade` ~line 1186): the envelope `status` is hardcoded `"optimal"` and the real CBC status (`LpStatus[prob.status]`) is only carried in `quality`. A gap-stopped or time-limited incumbent is reported as proven-optimal — a teaching-integrity defect. All solve functions share `_envelope`.

Requested tolerance does **not** determine achieved status. PuLP 3.3.2's `COIN_CMD.get_status()` can map a `Stopped … objective` header to `LpStatusOptimal` while the separate solution status is integer-feasible. So `LpStatus`, requested gap, and wall-clock inference are all insufficient — classification must read CBC's actual terminal records.

`e2e_accuracy.py` reads `status` and asserts `status == "optimal"` (lines 116/152/167) / `== "infeasible"` (146), and only ever runs at the default `gap=0` (genuinely proven-optimal). Any contract change must keep `status:"optimal"` emitted for proven-optimal solves so this sacred test stays unmodified (hard rule #2).

## 2. Target contract (§12.3/12.5 of the parent)

### 2.1 Two dimensions

- `solutionStatus`: `optimal | feasible | infeasible | unbounded | no_solution | error`
- `terminationReason`: `optimality_proven | gap_limit | time_limit | node_limit | infeasible | unbounded | interrupted | solver_error | unknown`

### 2.2 Retained/changed fields

- `envelopeVersion`: new integer discriminator (`1` = legacy shape, `2` = this contract).
- `status`: **retained as a deprecated alias**, defined equal to a fixed projection of `solutionStatus` (`optimal→"optimal"`, `infeasible→"infeasible"`, `feasible→"optimal"?` — **no**: see §2.3). Kept so `e2e_accuracy.py` and any un-migrated reader still work.
- `objective`: made **nullable** — `null` when no incumbent exists (infeasible/unbounded/no_solution/error). No misleading `0` sentinel alongside a nullable `incumbentObjective`.
- `quality`: **derived-only/deprecated** — retained as a computed mirror of `solutionStatus` for one transition version, not an independent field.
- `infeasibilityReason`: retained; its population unchanged for `infeasible`.
- New metadata, **nullable when unavailable** (never `0`): `requestedGap`, `achievedGap`, `bestBound`, `incumbentObjective`, `configuredTimeLimitSec`. (`runTimeSec` already exists.)

### 2.3 The `status` alias mapping (rule #2 constraint)

`e2e_accuracy.py` runs only at `gap=0` and asserts `optimal`/`infeasible`. Define the alias so those exact cases are byte-identical:

- `solutionStatus=optimal` → `status="optimal"` (e2e proven cases: unchanged).
- `solutionStatus=infeasible` → `status="infeasible"` (unchanged).
- `feasible | no_solution | unbounded | error` → `status` takes a **new** value equal to `solutionStatus` (these never occur in `e2e_accuracy.py`, so it stays byte-identical; other readers get a truthful value instead of a false `"optimal"`).

This is the crux that lets the fix ship without touching the sacred test: proven-optimal at gap 0 still says `"optimal"`; the *only* behavioral change is that gap/time-limited and no-incumbent cases (which e2e never exercises) stop lying.

### 2.4 Contradiction rejection

The Zod schema (and a Python assertion in `_envelope`) reject contradictory combinations: `solutionStatus=optimal` with `terminationReason∈{time_limit,gap_limit,node_limit}`; a non-null `incumbentObjective` with `solutionStatus∈{infeasible,unbounded,no_solution}`; `status` disagreeing with its defined `solutionStatus` projection.

### 2.5 Job-lifecycle mapping (independent of math outcome)

- Completed **solver outcomes** (job `succeeded`): `optimal`, `feasible` (gap/time-limited with incumbent), `infeasible`, `unbounded`.
- Failed **jobs**: spawn/parser/solver errors (`error`).
- `no_solution` (time/node limit **without** incumbent): job `succeeded` with `solutionStatus=no_solution` (a valid solver outcome, not a job failure) — the result simply has a null objective. (This is the one the parent flagged for an explicit call; recorded here as the decision.)

## 3. Tasks (ordered to break the circular dependency, §12/11.10)

### P0R.1 — CBC termination-parser spike

- Against **pinned** PuLP 3.3.2 / bundled CBC: generate a unique CBC log + solution path per solve, parse a bounded set of known terminal records, clean the files up.
- Deliver `parse_cbc_termination(log_path, sol_path) -> (solutionStatus, terminationReason, {achievedGap, bestBound, incumbentObjective})` + a note naming exactly which CBC records are authoritative.
- **Never** classify a time-limit stop by comparing wall time to `timeLimitSec`.
- Files: `artifacts/api-server/src/solver/cbc_termination.py` (new, imported by `solve.py`); spike note in the commit body / a short `docs/` note.

### P0R.2 — parser unit tests (deterministic, §12.9)

- Commit **sanitized CBC log/solution fixtures** for: optimal-proven, gap-limited-with-incumbent, time-limited-with-incumbent, time-limited-without-incumbent (`no_solution`), infeasible, unbounded.
- Tests map each fixture → correct `(solutionStatus, terminationReason)` + metadata. **No live solving** — deterministic across machines/CBC builds. This fixture set is authoritative for time/gap/node-limit classification (CI never races a live timeout).
- Files: `artifacts/api-server/src/solver/tests/fixtures/cbc/*`, `tests/test_cbc_termination.py` (new).

### P0R.3 — contract implementation + OpenAPI + frontend + compatibility

- `solve.py`: `_envelope` gains `envelopeVersion`, two-dim status, nullable metadata; a shared `_termination(prob, log_path, sol_path, requested_gap, time_limit, run_time)` wraps P0R.1; every solve function's terminal return routed through it; `objective` emitted `null` when no incumbent.
- `lib/api-spec/openapi.yaml`: `SolveResult` gains the new fields (nullable per §2.2), `status` documented deprecated; **regenerate `lib/api-zod` + `lib/api-client-react` in the same commit** (rule #1).
- `resultEnvelope.ts` (Zod): match, incl. §2.4 contradiction rejection.
- **Frontend (required, §12.5 — dimensions kept distinct):** render outcome by `(solutionStatus, terminationReason)` combinations — at least `feasible+gap_limit`, `feasible+time_limit`, `no_solution+time_limit` — not the current catch-all **Error**. `quality.ts` wording derives from `terminationReason`/`achievedGap`, not requested gap.
- **Compatibility:** historical `scenarios.result` rows lack the new fields and their `status:"optimal"` may actually be a gap/time-limited result. **Read-time normalization** maps a legacy (`envelopeVersion` absent/1) row to `solutionStatus` best-effort **without** promoting to proven — a legacy `"optimal"` becomes `solutionStatus: unknown` (or an explicit `legacy_unverified` marker), never `optimal`. **No backfill / no re-solve** (result cache misses on the solver-hash change anyway).
- **Consumer migration (enumerate + update, §12.5):** OpenAPI `SolveResult`, `ResultEnvelopeSchema`, `solve_jobs` result summary, Studio + Workspace output views, `quality.ts`, analytics/telemetry (`solve-completed`), exports/templates, result-cache validation, API tests, deployment smoke checks.

### P0R.4 — integration tests + gate

- `test_result_contract.py`: deterministic optimal + infeasible cases from real solves; time/gap/node-limit states exercised via an **injectable solver/parser seam or committed subprocess fixture** (§12.9), **not** a wall-clock race.
- Frontend tests for every newly visible outcome + the normalized-legacy path.
- `resultEnvelope.test.ts`: schema accepts v2 for all models; rejects §2.4 contradictions.
- **Acceptance:** full repo verification gate green **and** `e2e_accuracy.py` run directly at **87/87 unmodified**; a gap-stopped JADE solve reports `feasible` + `gap_limit`; a legacy result renders as `unknown`, never `optimal`.

## 4. Hard-rule guardrails

- **#2:** `e2e_accuracy.py` unmodified; §2.3 alias guarantees byte-identical proven/infeasible output at gap 0.
- **#1:** OpenAPI edits + regen in one commit; generated code never hand-edited.
- **#4:** one task = one commit, `[P0R.N] <summary>`.
- No solver **math** changes (no golden objective moves); this is purely reporting/metadata.

## 5. Task/deliverable summary

| ID | Task | Kind |
|---|---|---|
| P0R.1 | CBC termination parser (pinned CBC/PuLP) | Code |
| P0R.2 | Parser unit tests on committed CBC-log fixtures | Tests |
| P0R.3 | Two-dim contract + OpenAPI/regen + Zod + frontend + read-time compat + consumer migration | Code + contract |
| P0R.4 | Integration tests (injectable seam, no timing race) + full gate + direct `e2e_accuracy.py` | Tests |
