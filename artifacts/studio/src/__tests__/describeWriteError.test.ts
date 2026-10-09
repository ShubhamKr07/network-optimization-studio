import { describe, it, expect } from "vitest";
import { describeWriteError } from "@/lib/describeWriteError";

/** Shaped like custom-fetch.ts's ApiError: an Error whose `message` carries
 *  the HTTP prefix and whose `data` holds the parsed body. */
function apiError(status: number, data: unknown, message: string): Error {
  const e = new Error(message) as Error & { status: number; data: unknown };
  e.status = status;
  e.data = data;
  return e;
}

describe("describeWriteError", () => {
  it("prefers the server's sentence over the prefixed message", () => {
    const err = apiError(422, { error: "Coverage floor is required." },
      "HTTP 422 Unprocessable Content: Coverage floor is required.");
    expect(describeWriteError(err)).toBe("Coverage floor is required.");
  });

  it("never leaks the HTTP prefix", () => {
    const err = apiError(422, { error: "Coverage floor is required." },
      "HTTP 422 Unprocessable Content: Coverage floor is required.");
    expect(describeWriteError(err)).not.toContain("HTTP 422");
  });

  // The second body shape, found in review. `data.error` alone is a LABEL here
  // and every actual reason lives in `errors`.
  it("renders the network-edit precheck's detail, not just its label", () => {
    const err = apiError(422, {
      error: "Network-edit precheck failed",
      errors: [{ message: "Warehouse ALN is referenced by an override" },
               { message: "Customer C9 does not exist" }],
    }, "HTTP 422 Unprocessable Content: Network-edit precheck failed");
    const out = describeWriteError(err);
    expect(out).toContain("Warehouse ALN is referenced by an override");
    expect(out).toContain("Customer C9 does not exist");
  });

  it("handles precheck errors given as plain strings", () => {
    const err = apiError(422, { error: "Network-edit precheck failed", errors: ["bad lane"] },
      "HTTP 422 …");
    expect(describeWriteError(err)).toContain("bad lane");
  });

  it("ignores an empty errors array and uses the label", () => {
    const err = apiError(422, { error: "Network-edit precheck failed", errors: [] }, "HTTP 422 …");
    expect(describeWriteError(err)).toBe("Network-edit precheck failed");
  });

  it("falls back to a plain Error's message", () => {
    expect(describeWriteError(new Error("Save failed."))).toBe("Save failed.");
  });

  it("uses the caller's fallback for a non-Error", () => {
    expect(describeWriteError({ nope: true }, "Couldn't do that.")).toBe("Couldn't do that.");
  });

  it("has a generic last resort when no fallback is given", () => {
    expect(describeWriteError(null)).toBe("Something went wrong. Please try again.");
  });

  it("does not surface a raw JSON dump even if the server somehow sends one", () => {
    const err = apiError(422, { error: '[{"code":"too_small","path":["x"]}]' }, "HTTP 422 …");
    expect(describeWriteError(err)).toBe("Something went wrong. Please try again.");
  });
});
