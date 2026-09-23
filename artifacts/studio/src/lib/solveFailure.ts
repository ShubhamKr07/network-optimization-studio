// A9 (SCND correctness, §2.11/A-R47) — the ONE frontend choke point for the
// public retry rule. A5's contract: "every terminal async solve failure is
// retryable, derived from errorCode ALONE" — there is no public `retryable`
// field (a constant-true boolean wasn't worth a contract change), so this is
// exactly the seam A5 designed for the frontend to own. A historical failed
// job with no typed `errorCode` at all (pre-A1 row) reads as the same
// conservative default the public serializer itself uses (SOLVE_FAILED) —
// still retryable, never a dead end.
//
// CRITICAL invariant, enforced by this file's own test: retryability is
// derived from `errorCode` alone, NEVER by inspecting `errorMessage` text.
// `errorMessage` is a server-owned, fixed, user-facing string — display-only.
// Do not add any string matching against it here.
import type { SolveJobErrorCode } from "@workspace/api-client-react";

export function isRetryableFailureCode(
  errorCode: SolveJobErrorCode | string | null | undefined,
): boolean {
  switch (errorCode) {
    case "SOLVE_FAILED":
    case "TIMEOUT":
      return true;
    // Absent errorCode on an already-terminal-failed job means either a
    // historical (pre-A1) row or a synchronous pre-job failure the caller
    // chooses to route through this same check — both are retryable: the
    // student can always just try again.
    case null:
    case undefined:
      return true;
    default:
      // An unrecognized future errorCode is retryable-by-default too — this
      // function is the single place a genuinely non-retryable code would
      // need to be carved out, and no such code exists in the contract today.
      return true;
  }
}
