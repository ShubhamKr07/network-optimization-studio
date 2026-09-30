# Gate proposal: flaky_test

**Symptom:** Both vitest suites produce spurious `Test timed out in 5000ms` failures under concurrent load. A clean serial run is green; a loaded one invents 6-31 failures. So a gate result is **load-dependent**, and neither a red nor a green run means what it says.

**Occurrences:**
- 2026-09-29 `ch5-delivery` — api-server vitest, flaky at the merge gate.
- 2026-09-30 `CH4UX` — studio suite: 15 failures, then 31 on a re-run (293s), against **2135/2135 in 81s** on a quiet machine. Every failure a bare `Test timed out in 5000ms` with a 5-9s duration. api-server: 6 failures across 4 files the branch **does not touch** (0 api-server files changed), all passing **54/54** in isolation.

**Why this is more than noise.** On CH4UX the same load-sensitivity hid a **real** regression, not just invented fake ones. A cold-mount race snapped Chapter 4 to the wrong step on ~60% of reloads, and it survived **two full green gate runs** because 4-worker parallelism happened to favour the benign branch of the race. It was found only by an isolated-repeat probe (10/16 failing isolated vs 0/16 in the gate). A suite that is noisy under load is also a suite that can be *quiet* about something real.

**Proposed automated gate — two parts, both cheap:**

1. **Make the timeout not the discriminator.** Raise `testTimeout` from the 5000ms default to 15000 in `artifacts/studio/vitest.config.ts` and the api-server equivalent. Nothing legitimately takes 5-9s here; the failures are scheduling delay, not slow code.

2. **Refuse to accept a gate run that contains any timeout.** A wrapper (`pnpm gate`) that runs each suite and greps its output for `Test timed out`; non-zero count exits non-zero with `GATE RESULT NOT TRUSTWORTHY — re-run serially`. This is the part that matters: it stops a human or an agent from reading a load-poisoned run as signal in either direction.

Optionally also: `--no-file-parallelism` in the gate path only, trading ~3x wall-clock for determinism. Left out of the proposal because part 2 catches the problem without slowing the common case.

**How to enable:**
- `artifacts/studio/vitest.config.ts` → `test: { testTimeout: 15000 }`
- api-server's vitest config → same
- new `scripts/harness/gate.sh` wrapping the suites with the timeout-count check; reference it from `CLAUDE.md`'s verification-gate block

**Status:** proposed — awaiting human approval (not enabled)
