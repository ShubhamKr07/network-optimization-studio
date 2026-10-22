# Gate proposal: flaky_test

**Symptom:** Both vitest suites produce spurious `Test timed out in 5000ms` failures under concurrent load. A clean serial run is green; a loaded one invents 6-31 failures. So a gate result is **load-dependent**, and neither a red nor a green run means what it says.

**Occurrences:**
- 2026-09-29 `ch5-delivery` — api-server vitest, flaky at the merge gate.
- 2026-09-30 `CH4UX` — studio suite: 15 failures, then 31 on a re-run (293s), against **2135/2135 in 81s** on a quiet machine. Every failure a bare `Test timed out in 5000ms` with a 5-9s duration. api-server: 6 failures across 4 files the branch **does not touch** (0 api-server files changed), all passing **54/54** in isolation.

- 2026-10-10 `WF` — api-server red on **both** of WF-8's full runs with **different sets** (7 tests/4 files, then 4/2) at host load 3.17/28.25/74.10; `scenarioSolveAtomicity` was a new sighting. WF-9's run: 1673 passed / 3 failed, `collect` alone **171.46s against a 61.69s wall clock**, and **every** failure literally timeout-shaped (`cors` at 5077ms vs a 5000ms limit; `resultEnvelope` at 8006/6522ms). Direct evidence for Part 2 below: a refuse-any-timeout wrapper would have classified both runs correctly with no judgement call, where the human had to re-run four files twice each in isolation to reach the same answer.

**Why this is more than noise.** On CH4UX the same load-sensitivity hid a **real** regression, not just invented fake ones. A cold-mount race snapped Chapter 4 to the wrong step on ~60% of reloads, and it survived **two full green gate runs** because 4-worker parallelism happened to favour the benign branch of the race. It was found only by an isolated-repeat probe (10/16 failing isolated vs 0/16 in the gate). A suite that is noisy under load is also a suite that can be *quiet* about something real.

**Proposed automated gate — two parts, both cheap:**

1. **Make the timeout not the discriminator.** Raise `testTimeout` from the 5000ms default to 15000 in `artifacts/studio/vitest.config.ts` and the api-server equivalent. Nothing legitimately takes 5-9s here; the failures are scheduling delay, not slow code.

2. **Refuse to accept a gate run that contains any timeout.** A wrapper (`pnpm gate`) that runs each suite and greps its output for `Test timed out`; non-zero count exits non-zero with `GATE RESULT NOT TRUSTWORTHY — re-run serially`. This is the part that matters: it stops a human or an agent from reading a load-poisoned run as signal in either direction.

Optionally also: `--no-file-parallelism` in the gate path only, trading ~3x wall-clock for determinism. Left out of the proposal because part 2 catches the problem without slowing the common case.

**How to enable:**
- `artifacts/studio/vitest.config.ts` → `test: { testTimeout: 15000 }`
- api-server's vitest config → same
- new `scripts/harness/gate.sh` wrapping the suites with the timeout-count check; reference it from `CLAUDE.md`'s verification-gate block

**Status:** APPROVED AND ENABLED (human decision, 2026-10-22; FLK-2). Two changes from the proposal as written:
- `hookTimeout: 30000` alongside `testTimeout: 15000` in both configs — `failures.csv` already records hook timeouts at the 10 s default (CH4OS-4), which the proposal's testTimeout-only change would have left in place.
- The wrapper matches `Test timed out` **and** `Hook timed out`. It is `scripts/harness/gate.sh`, run as `pnpm gate`; exit 0 green, 1 a real step failure, 3 a timeout seen (result not trustworthy). Local only — CI calls the suites directly and runs unloaded.

Verified: a probe test sleeping 16 s exits 3; a probe asserting `1 === 2` exits 1. The first probe attempt of the failure path also exited 3 — at load average ~32 with zero vitest running, three real tests still timed out at 15 s (`jobRunnerDispatcher` ×2, `resultEnvelope` p-median-brazil) — which is the gate working, not a defect: 15 s narrows the window, it does not make a swapping 8-core machine trustworthy.
