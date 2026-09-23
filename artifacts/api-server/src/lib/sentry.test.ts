import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { scrubEvent } from "./sentry";

// A12 — captureSolveFailure/sanitizeErrorDetail need a FRESH module instance
// with SENTRY_ENABLED (computed once, at import time, from process.env.SENTRY_DSN)
// forced true — the static `scrubEvent` import above already froze one
// instance with whatever SENTRY_DSN was unset at file-load time. `vi.mock`
// is hoisted (applies to every future import of "@sentry/node", including
// after vi.resetModules()), so mocking `captureMessage` here and re-importing
// "./sentry" inside beforeAll (after setting SENTRY_DSN + resetModules) gives
// a real, enabled instance without disturbing the scrubEvent tests above.
const mockCaptureMessage = vi.hoisted(() => vi.fn((_message: string, _context?: unknown) => "mock-event-id"));
vi.mock("@sentry/node", () => ({ captureMessage: mockCaptureMessage }));

describe("scrubEvent", () => {
  it("strips request body, cookies, auth headers, query, email, ip", () => {
    const scrubbed = scrubEvent({
      request: {
        data: { inputs: { demand: 500 }, email: "a@b.c" },
        cookies: "nos_session=secret",
        headers: { authorization: "Bearer x", cookie: "nos_session=secret", "user-agent": "UA" },
        query_string: "scenario=1&token=abc",
        url: "https://api.example.com/scenarios/1/solve?token=abc&scenario=1",
        method: "POST",
      },
      user: { id: "u1", email: "a@b.c", ip_address: "1.2.3.4" },
      tags: { user_id: "u1", model_id: "p-median-us" },
      exception: { values: [{ type: "Error", value: "boom" }] },
    } as any);
    expect(scrubbed).toBeTruthy();
    expect(scrubbed!.request?.data).toBeUndefined();
    expect(scrubbed!.request?.cookies).toBeUndefined();
    expect(scrubbed!.request?.query_string).toBeUndefined();
    expect(scrubbed!.request?.url).toBe("/scenarios/1/solve"); // path-only, query stripped (Review 5)
    expect(scrubbed!.request?.headers).toEqual({ "user-agent": "UA" }); // auth/cookie removed
    expect(scrubbed!.user).toEqual({ id: "u1" }); // email + ip removed
    expect(scrubbed!.tags).toEqual({ user_id: "u1", model_id: "p-median-us" });
    expect(scrubbed!.exception).toBeTruthy(); // error preserved
  });

  it("reduces request.url to path-only, stripping query params", () => {
    const scrubbed = scrubEvent({
      request: {
        url: "https://nos-api-uwf8.onrender.com/scenarios/1/solve?token=abc&other=1",
      },
    } as any);
    expect(scrubbed!.request?.url).toBe("/scenarios/1/solve");
  });
});

// A12 — sanitizeErrorDetail: the second, independent allowlist layer inside
// the operator sink itself (never trust solve.py's own SolverFailureSchema
// cap to be the only thing standing between "structured allowlisted
// diagnostic" and "an accidental leak").
describe("sanitizeErrorDetail", () => {
  let sanitizeErrorDetail: typeof import("./sentry").sanitizeErrorDetail;

  beforeAll(async () => {
    ({ sanitizeErrorDetail } = await import("./sentry"));
  });

  it("returns null for a null/undefined detail", () => {
    expect(sanitizeErrorDetail(null)).toBeNull();
    expect(sanitizeErrorDetail(undefined)).toBeNull();
  });

  it("keeps primitive (string/number/boolean/null) values under the length cap", () => {
    expect(sanitizeErrorDetail({ code: "cbc_parse", line: 42, fatal: true, hint: null })).toEqual({
      code: "cbc_parse",
      line: 42,
      fatal: true,
      hint: null,
    });
  });

  it("drops keys whose name suggests forbidden content, regardless of value", () => {
    const detail = {
      stdout: "harmless-looking-short-value",
      stderr: "also short",
      traceback: "short",
      exception: "short",
      path: "/etc/passwd",
      secret: "short",
      token: "short",
      password: "short",
      apiKey: "short",
      cookie: "short",
      authorization: "short",
      safe_code: "cbc_parse",
    };
    expect(sanitizeErrorDetail(detail)).toEqual({ safe_code: "cbc_parse" });
  });

  it("drops over-length string values (likely a raw path/traceback, not a closed-enum value)", () => {
    const longValue = "x".repeat(201);
    expect(sanitizeErrorDetail({ longField: longValue, shortField: "ok" })).toEqual({ shortField: "ok" });
  });

  it("drops nested objects/arrays entirely rather than recursing into them", () => {
    expect(
      sanitizeErrorDetail({ nestedObj: { inner: "value" }, nestedArr: [1, 2, 3], flat: "ok" }),
    ).toEqual({ flat: "ok" });
  });

  it("returns null (not an empty object) when every key is filtered out", () => {
    expect(sanitizeErrorDetail({ stdout: "x" })).toBeNull();
  });
});

// A12 — captureSolveFailure: the actual Sentry emission site (jobRunner.ts's
// only caller). Verifies the tag/extra allowlist AND the no-op-when-disabled
// gate, against a real (mocked-Sentry-SDK) module instance.
describe("captureSolveFailure", () => {
  let captureSolveFailure: typeof import("./sentry").captureSolveFailure;

  beforeAll(async () => {
    process.env.SENTRY_DSN = "https://fake@sentry.example/1";
    vi.resetModules();
    ({ captureSolveFailure } = await import("./sentry"));
  });

  beforeEach(() => {
    mockCaptureMessage.mockClear();
  });

  it("sends only a fixed message + bounded failureReason/failureStage tags when there is no errorDetail", () => {
    captureSolveFailure({ failureReason: "internal_error", failureStage: "spawn", errorDetail: null });
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const [message, context] = mockCaptureMessage.mock.calls[0]!;
    expect(message).toBe("solve job failed"); // fixed string — never built from raw diagnostic text
    expect(context).toMatchObject({
      level: "error",
      tags: { failureReason: "internal_error", failureStage: "spawn" },
    });
    expect((context as any).extra).toBeUndefined();
  });

  it("maps a null failureStage (e.g. TT-2 interrupted) to the fixed tag value 'none'", () => {
    captureSolveFailure({ failureReason: "interrupted", failureStage: null, errorDetail: null });
    const [, context] = mockCaptureMessage.mock.calls[0]!;
    expect((context as any).tags).toEqual({ failureReason: "interrupted", failureStage: "none" });
  });

  it("forwards a sanitized errorDetail as `extra.errorDetail`, stripping any leaking keys inline", () => {
    captureSolveFailure({
      failureReason: "solver_error",
      failureStage: "cbc_parse",
      errorDetail: { line: 7, stdout: "should never appear", code: "unparseable_incumbent" },
    });
    const [, context] = mockCaptureMessage.mock.calls[0]!;
    expect((context as any).extra).toEqual({ errorDetail: { line: 7, code: "unparseable_incumbent" } });
    expect(JSON.stringify(context)).not.toContain("should never appear");
  });

  it("never leaks a path, secret, or arbitrary exception text even if smuggled into errorDetail", () => {
    captureSolveFailure({
      failureReason: "internal_error",
      failureStage: "protocol",
      errorDetail: {
        path: "/home/student/secret-scenario.json",
        secretToken: "sk-should-not-leak",
        traceback: "Traceback (most recent call last): ...",
      },
    });
    const [, context] = mockCaptureMessage.mock.calls[0]!;
    expect((context as any).extra).toBeUndefined(); // every key was filtered -> sanitizeErrorDetail returns null
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("secret-scenario.json");
    expect(serialized).not.toContain("sk-should-not-leak");
    expect(serialized).not.toContain("Traceback");
  });

  it("is a no-op when SENTRY_DSN is unset (SENTRY_ENABLED false)", async () => {
    const originalDsn = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    vi.resetModules();
    const disabledModule = await import("./sentry");
    mockCaptureMessage.mockClear();
    disabledModule.captureSolveFailure({ failureReason: "internal_error", failureStage: "spawn", errorDetail: null });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    // Restore the enabled instance for any tests that might run after this one.
    process.env.SENTRY_DSN = originalDsn;
    vi.resetModules();
    ({ captureSolveFailure } = await import("./sentry"));
  });
});
