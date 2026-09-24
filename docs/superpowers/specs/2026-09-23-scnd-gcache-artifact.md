# G-cache Artifact — Composite Solver-Contract Cache Identity (A6)

**Date:** 2026-09-23
**Status:** **APPROVED — product owner, 2026-09-23, Option 1 (cache per-runtime-build; CBC binary + PuLP version IN the cache key).** All 4 decisions accepted as designed. Per the A plan's gate matrix, **G-cache** is now closed; A6 may execute. A0–A5 do not touch it.
**Source:** `docs/superpowers/plans/2026-09-22-scnd-correctness-A-full-contract.md` §Task A6 + design §2.10; builds directly on A1's shipped `artifacts/api-server/src/solver/recoveryContractIdentity.ts`.

## What A6 changes

Today the solve-result cache (`result_cache.inputs_hash`) is keyed on `computeInputsHash()` = `modelId + datasetVersion + SOLVER_CODE_HASH + canonicalJson(inputs)`, where **`SOLVER_CODE_HASH` hashes only `solve.py`, truncated to 12 hex chars**. That key cannot detect a semantics change in `cbc_termination.py` (which decides "Proven optimal" vs "Feasible — within gap"), the Node result parser, the CBC **build**, or PuLP's version — so a cache hit can return a result whose *truthful status* no longer matches what the current solver would produce. B1 (`f215832`) was a parser-only change: this drift is demonstrated, not hypothetical.

**A6 replaces `SOLVER_CODE_HASH` in the cache key with the composite `SOLVER_CONTRACT_IDENTITY`** = A1's already-shipped `computeRecoveryContractIdentity()` **+ a `SOLVER_CONTRACT_VERSION` constant**. Recovery identity (A1/A2) and cache identity (A6) become **one manifest, two consumers** — no second artifact to keep in sync.

## The manifest (already built + tested in A1)

A **sorted, length-framed** list of `{name, value}` components, hashed to a **full untruncated sha256** (64 hex):
- `solve.py`, `cbc_termination.py`, `resultEnvelope.ts`, `solverProcessMessage.ts` — full-file sha256.
- `pulpVersion` — the installed PuLP version string (runtime probe).
- `cbcBuildIdentity` — **sha256 of the actual CBC executable** `PULP_CBC_CMD().path` resolves to on this instance (not the pinned version string — P0R.1 found the real build differs by arch: `2.10.3` x64 vs `2.10.10` linux/arm64).
- `dataset:<modelId>` — each model package's content sha256 + `version.json` version.
- **NEW for A6 — `SOLVER_CONTRACT_VERSION`** — a single integer constant (start `1`) capturing semantic contract changes **not** reflected in any file/binary hash (e.g. a decision to re-interpret an existing field). Bumping it invalidates the whole cache by construction.

Fail-closed: any unreadable artifact or failed PuLP/CBC probe throws at module load → **boot fails**, never a default/skip. (A1 ships this.)

## Decisions requiring your approval (product owner)

1. **Cache is now per-runtime-build.** Because `cbcBuildIdentity` + `pulpVersion` are in the key, **any CBC binary change, architecture change, or PuLP upgrade fully invalidates the result cache** — every prior entry becomes a miss, and the first post-upgrade solve of each input re-runs CBC. This is the *correct* behavior (a different CBC build can legitimately produce a different status/incumbent/bound), and at this pilot's tiny sub-second solves the re-warm cost is negligible — but it is a real change from today's `solve.py`-only key, which survived CBC/PuLP changes (incorrectly). **Approve: cache resets on any solver-runtime change.**
2. **`SOLVER_CONTRACT_VERSION` owner = product owner.** It is bumped only by an explicit human decision (like DEC-2026-09-21-01), recorded in the changelog; no automated path bumps it. **Approve: human-only bump, changelog-recorded.**
3. **Existing v1 cache rows (keyed on `SOLVER_CODE_HASH`) are a cache MISS under the new key** — never read, never trusted, left in place (a later cleanup may prune them; not required). No row is rewritten. **Approve: unversioned rows = miss, untouched.**
4. **Rollback floor = R1.** If v2 write is disabled/rolled back after any v2 cache row exists, v2 rows remain readable by whatever reads them; unversioned rows stay a miss. Consistent with A11's R1 floor. **Approve.**

## A6 implementation scope (once approved)

- Add `SOLVER_CONTRACT_VERSION` to the manifest, export a `computeSolverContractIdentity()` wrapper (reuses A1's function + the version const).
- `jobRunner.ts` cache read/write keyed on it; a parser or contract-version bump invalidates even with `solve.py` unchanged; unversioned rows are a miss.
- Worked hash vectors with expected digests + per-component invalidation tests (bump each component → key changes; stability → same inputs → same key), mirroring A1's existing `recoveryContractIdentity.test.ts`.
- Commit: `[A6] composite solver-contract cache identity + v2 cache`.

**Nothing else in A6 activates the v2 *write* path — that stays behind A11's `SOLVER_V2_WRITE_ENABLED` flag (default off). A6 defines the key and the v2 cache read/write plumbing; A7 the outcome policy; A11 the flag; the R3 flip is a separate product-owner event.**
