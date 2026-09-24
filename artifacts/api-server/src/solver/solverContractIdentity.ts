import crypto from "crypto";
import { computeRecoveryContractIdentity } from "./recoveryContractIdentity.js";
import type { RecoveryIdentityInputs } from "./recoveryContractIdentity.js";

// A6 (SCND Correctness) — SOLVER_CONTRACT_VERSION + the composite
// SOLVER_CONTRACT_IDENTITY. Per the APPROVED G-cache artifact
// (docs/superpowers/specs/2026-09-23-scnd-gcache-artifact.md, Option 1 —
// per-runtime-build), this is NOT a second, independently-maintained
// manifest. It is A1's already-shipped RECOVERY_CONTRACT_IDENTITY manifest
// (recoveryContractIdentity.ts — solve.py, cbc_termination.py,
// resultEnvelope.ts, solverProcessMessage.ts, the installed PuLP version,
// the actual runtime CBC executable's own sha256, and every model
// package's dataset content + version.json), PLUS exactly one new
// component this task adds: SOLVER_CONTRACT_VERSION — an integer, bumped
// ONLY by an explicit human/product-owner decision (never an automated
// path), changelog-recorded, capturing a semantic contract change that
// isn't reflected in any file/binary hash at all (e.g. deciding to
// re-interpret an existing field's meaning).
//
// "One manifest, two consumers, two different final hashes": A1/A2 use
// RECOVERY_CONTRACT_IDENTITY (recoveryContractIdentity.ts's own exported
// hash) for recovery correctness — "can a queued row be safely
// claimed/executed under a DIFFERENT runtime generation." This module's
// export, SOLVER_CONTRACT_IDENTITY (computed by jobRunner.ts, see its own
// header comment), is the SAME underlying manifest plus the version
// component, consumed ONLY by jobRunner.ts's v2 cache key
// (computeInputsHashV2) — never by A2's claim-time check, which stays on
// its own separately-computed RECOVERY_CONTRACT_IDENTITY untouched by this
// module.
//
// Fail-closed: computeRecoveryContractIdentity() already throws at module
// load (via jobRunner.ts's eager top-level call) on any unreadable artifact
// or failed PuLP/CBC runtime probe — A1's contract. This wrapper introduces
// no new failure mode of its own; it purely combines that already-fail-
// closed hash with the fixed SOLVER_CONTRACT_VERSION integer.

/**
 * Bumped ONLY by an explicit product-owner decision, recorded in
 * docs/CHANGELOG-implementation.md — see the G-cache artifact's Decision 2.
 * Never bumped by an automated path. Starts at 1.
 */
export const SOLVER_CONTRACT_VERSION = 1;

export type SolverContractIdentityInputs = RecoveryIdentityInputs;

/**
 * Computes the composite SOLVER_CONTRACT_IDENTITY: A1's full
 * RECOVERY_CONTRACT_IDENTITY manifest hash combined with
 * SOLVER_CONTRACT_VERSION into one full, untruncated sha256 hex digest (64
 * characters) — never truncated, matching computeRecoveryContractIdentity's
 * own convention.
 *
 * The two components are combined via explicit, self-describing labels
 * rather than a bare concatenation. This is safe against delimiter
 * collision without needing recoveryContractIdentity.ts's own length-
 * framing machinery: computeRecoveryContractIdentity() always returns a
 * FIXED-LENGTH 64-hex-character string (guaranteed by its own `sha256(...)
 * .digest("hex")` return type), so there is no ambiguity between where the
 * recovery identity ends and the version label begins.
 *
 * Pure given its inputs — no caching. A caller that wants a "computed once
 * at boot" constant should call this exactly once and hold the result,
 * matching jobRunner.ts's existing SOLVER_CODE_HASH / RECOVERY_CONTRACT_IDENTITY
 * pattern (jobRunner.ts does exactly this for SOLVER_CONTRACT_IDENTITY).
 */
export function computeSolverContractIdentity(
  inputs: SolverContractIdentityInputs,
  /**
   * Overridable for tests only — real code always uses the module-level
   * SOLVER_CONTRACT_VERSION constant (never passes this argument). Exists
   * solely so a test can prove version-bump sensitivity (the manifest hash
   * genuinely changes when the version component changes) without needing
   * to mutate the exported constant itself, mirroring
   * RecoveryIdentityInputs's own `pythonBin` "overridable for tests only"
   * convention.
   */
  solverContractVersionOverride?: number,
): string {
  const recoveryContractIdentity = computeRecoveryContractIdentity(inputs);
  const version = solverContractVersionOverride ?? SOLVER_CONTRACT_VERSION;
  return crypto
    .createHash("sha256")
    .update(`recoveryContractIdentity:${recoveryContractIdentity};solverContractVersion:${version}`)
    .digest("hex");
}
