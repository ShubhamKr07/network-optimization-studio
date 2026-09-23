// A11 — staged v1->v2 rollout config (SCN v0.3 correctness Option A).
//
// This module is the ONLY place that reads `process.env.SOLVER_V2_WRITE_ENABLED`.
// Per the plan (docs/superpowers/plans/2026-09-22-scnd-correctness-A-full-contract.md,
// Task A11), the intended consumers are `solver/jobRunner.ts` (the v2 cache +
// publication write paths) and `routes/scenarios.ts` (serializer gating) — both
// land in later tasks (A6/A7) that import `isV2WriteEnabled()` from here rather
// than touching `process.env` directly. This task lands the flag itself,
// default OFF; it does not wire any consumer (see this task's commit body for
// the recorded scope deviation).
//
// Landing this default-off flag is a Git commit. ENABLING it is a separate,
// external, product-owner-authorized Render environment change — the two must
// never be conflated. See docs/ops/v2-write-activation.md for the full
// activation runbook, evidence-record fields, and R3 prerequisite list.

import { logger } from "../lib/logger";

const ENV_VAR_NAME = "SOLVER_V2_WRITE_ENABLED";

/**
 * Strict boolean parser — accepts ONLY the literal strings `"true"` and
 * `"false"`. Everything else (`undefined`, `""`, whitespace, `"1"`, `"0"`,
 * `"TRUE"`, `"True"`, garbage) resolves to `false`. This intentionally
 * matches `jobRunner.ts`'s existing `parsePositiveIntEnv` strictness
 * (unset/blank/non-conforming input falls back to a safe default rather than
 * being coerced) — fail-closed by construction, not by convention.
 */
export function parseStrictBool(raw: string | undefined): boolean {
  if (raw === "true") return true;
  return false;
}

// Resolved once, at module load — this is what makes "logged once at
// startup" true regardless of which consumer imports this module first.
// Tests that need a different resolved value must reset the module
// registry (`vi.resetModules()`) and re-import after setting the env var
// themselves; nothing here reads ambient state implicitly at call time.
const resolvedV2WriteEnabled = parseStrictBool(process.env[ENV_VAR_NAME]);

logger.info(
  { flag: ENV_VAR_NAME, v2WriteEnabled: resolvedV2WriteEnabled },
  "[A11] resolved SOLVER_V2_WRITE_ENABLED at startup (default OFF, fail-closed)",
);

/**
 * Whether v2 cache/publication writes are enabled. Default OFF (R1/R2
 * behavior — nullable-schema three-way reads, B-format writes). Flipping
 * this to `true` in a real environment is a product-owner decision gated by
 * the full R3 activation prerequisite list — see
 * docs/ops/v2-write-activation.md.
 */
export function isV2WriteEnabled(): boolean {
  return resolvedV2WriteEnabled;
}
