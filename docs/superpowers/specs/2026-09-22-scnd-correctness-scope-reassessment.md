# SCND Correctness Contract — Scope / Proportionality Reassessment

**Date:** 2026-09-22
**Status:** Decision doc for the product owner. Triggered by the §34 consolidated review + the assumptions challenge. No implementation decision is made here — this frames the options.
**Branch:** `scnd-scaling`.

---

## 1. How we got here

What began as a **small, verified bug** — `solve.py` hard-codes envelope `status:"optimal"` even when CBC stopped on a gap/time limit (real, confirmed against Brazil@`gap=0.05`) — has, over **13 review rounds** (§14–§34), grown into a fully-specified but large contract: two-dimensional status, five schemas, a `solve_jobs` migration, an fd3 private failure protocol + errorCode taxonomy, Node process-group supervision, a composite cache identity (Q35/Q41, still open), a staged v1→v2 rollout with a rollback floor, telemetry changes, and a legacy-reader-forever policy.

The **P0R.1 spike landed GO** (parser + fixtures + 32 tests, `e2e_accuracy` 99/99) — but in doing so it surfaced assumptions that make the *full* contract's cost/benefit worth a deliberate check before committing to P0R.3/P0R.4.

## 2. Assumptions that undercut the full-contract case

1. **The truthful-status paths rarely fire.** The spike found the real teaching datasets (≤26 WH / 200 cust) prove optimal in **<0.2 s** — too fast to reach gap/time/node limits; the limit fixtures needed a *synthetic* hard knapsack. The mislabel only bites when a student sets `gap>0` **and** CBC stops on it. Practical incidence is probably small.
2. **The parser is brittle** — it scrapes **free-text CBC log lines** that already differ across builds (2.10.3 vs 2.10.10) and depends on **`PULP_CBC_CMD`, which PuLP 4.0 deprecates**. A routine dependency/base-image bump could break it silently.
3. **The load is unmeasured.** 50×50 and the 20/60/20 cache split are hypotheses for a **cohort that doesn't exist yet**; B2/worker-tier/single-flight/cache-identity are sized off them.
4. **Process-group / no-orphan machinery** defends against mid-flight kills that, at <0.2 s solves, are vanishingly rare.
5. **Proportionality:** 13 review rounds + a migration + rollout + supervisor, for a pre-cohort pilot with ~no users, is plausibly far more than the downside warrants.

## 3. Options

| | **A — Full contract** | **B — Minimal correctness (recommended)** | **C — Spec-only / defer** |
|---|---|---|---|
| Scope | All of P0R.3/P0R.4 as specified: 5 schemas, DB migration, fd3 protocol, Node process-group supervisor, composite cache identity, staged rollout, telemetry, legacy-reader | Fix the **verified mislabel**: capture the CBC log (pass `logPath`), classify the actually-reachable outcomes (`optimal` vs `feasible/gap_limit`), truthful `status`/`quality`, the **DEC-approved `e2e_accuracy` assertion correction**. Harden the parser (contradiction fix, fail-closed on unsupported PuLP). **No** DB migration / rollout machinery / process supervisor / cache-identity / single-flight — those stay in the B2 spec, gated on a real cohort. | Keep the contract as an approved spec; implement nothing until a real cohort exists and telemetry validates the load + the mislabel's real incidence. |
| Effort | Large (multi-bundle) | Small–medium, one bundle | ~zero now |
| Fixes the real bug? | Yes | **Yes** | No (bug stays live) |
| Risk it addresses | Everything specified | The actual observed defect | — |
| Left unaddressed | — | Async-queue reliability, cache dedup, rollout safety (all deferred to when load is proven) | The mislabel remains in production |
| Brittleness exposure | High (full surface built now) | Low (smallest log-parsing footprint; revisit if CBC/PuLP move) | None added |

## 4. Recommendation — B

Ship the **minimal correctness fix** now: it eliminates the one *verified, production-visible* defect (proven-optimal claimed on a gap-limited result) at the smallest footprint, and defers the reliability/queue/rollout/cache machinery to the **B2 spec, gated on a real cohort** — the point at which the load assumptions (§2.3) can actually be measured instead of guessed. This keeps the parser's brittle surface (§2.2) as small as possible and avoids building process-supervision/rollout infrastructure for events that, at current solve times, rarely occur.

The already-written full contract is **not wasted** — it becomes the B2 design, revisited with real telemetry. The §34 findings that still apply under B (parser contradiction fix, fail-closed-on-PuLP, DB/error-taxonomy only if B touches persistence, status-line consistency) are folded into B's plan; the rest (rollout, process supervisor, cache identity, single-flight) move to B2.

## 5. What B concretely includes / excludes

**Includes:** `logPath` capture + `cbc_termination` parser (already built, hardened per §34.2.10 + §34.3.1); truthful `solutionStatus`/`terminationReason`/`quality` on `solve.py`'s success paths; the DEC-2026-09-21-01 `e2e_accuracy` assertion correction; frontend rendering of the reachable outcomes; `envelopeVersion` + read-time legacy normalization (so old rows aren't mislabeled). **Excludes (→ B2, cohort-gated):** `solve_jobs` failure/limit columns beyond what the envelope needs, fd3 private protocol, Node process-group supervisor + no-orphan proof, composite cache identity/v2 cache, single-flight, staged v1→v2 writer rollout, telemetry contract changes.

## 6. Decision needed

Confirm **B** (minimal) — then I'll write the B implementation plan (small bundle) and move the deferred machinery into the B2 spec. Or pick **A** (full build now) or **C** (defer all). Open question if B: does the minimal fix need the `envelopeVersion`/legacy-normalization at all, or can old rows simply be re-solved on next open? (Answerable during B planning.)
