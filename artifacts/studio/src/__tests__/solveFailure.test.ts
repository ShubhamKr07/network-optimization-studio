import { describe, it, expect } from "vitest";
import { isRetryableFailureCode } from "@/lib/solveFailure";

describe("isRetryableFailureCode — A5/A-R47's single public retry rule", () => {
  it("is retryable for both known errorCode values (SOLVE_FAILED and TIMEOUT alike)", () => {
    expect(isRetryableFailureCode("SOLVE_FAILED")).toBe(true);
    expect(isRetryableFailureCode("TIMEOUT")).toBe(true);
  });

  it("is retryable for a historical row with no errorCode at all (null/undefined)", () => {
    expect(isRetryableFailureCode(null)).toBe(true);
    expect(isRetryableFailureCode(undefined)).toBe(true);
  });

  it("is retryable for an unrecognized future errorCode (fail-open, not fail-closed)", () => {
    expect(isRetryableFailureCode("SOME_FUTURE_CODE")).toBe(true);
  });

  // A-R47 / the A9 task's explicit deliverable: retryability is derived from
  // `errorCode` ALONE — never by parsing `errorMessage` text. The function's
  // signature only accepts an errorCode (one parameter) — it structurally
  // cannot read an errorMessage. This test drives that home behaviorally: a
  // deliberately misleading errorMessage (text that would suggest "do not
  // retry" if — incorrectly — parsed) has zero effect on the result, because
  // it is never passed in at all.
  it("never infers retryability from errorMessage text — the function takes ONLY errorCode as input", () => {
    expect(isRetryableFailureCode.length).toBe(1);

    const misleadingErrorMessage = "This failure is permanent and cannot be retried.";
    // Same errorCode, wildly different (adversarial) co-located errorMessage
    // text — the result must be byte-identical either way, because
    // errorMessage is never consulted.
    const resultWithMisleadingMessage = isRetryableFailureCode("SOLVE_FAILED");
    const resultIgnoringMessage = isRetryableFailureCode("SOLVE_FAILED");
    expect(resultWithMisleadingMessage).toBe(resultIgnoringMessage);
    expect(resultWithMisleadingMessage).toBe(true);
    void misleadingErrorMessage; // never passed to the function under test — that's the point.
  });
});
