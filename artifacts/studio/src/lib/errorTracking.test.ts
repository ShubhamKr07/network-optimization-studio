import { describe, it, expect, vi, beforeEach } from "vitest";

const init = vi.fn();
const setUser = vi.fn();
vi.mock("@sentry/react", () => ({ init, setUser, ErrorBoundary: () => null }));

describe("errorTracking", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("no-ops init when VITE_SENTRY_DSN unset", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const m = await import("./errorTracking");
    m.initErrorTracking();
    expect(init).not.toHaveBeenCalled();
  });

  it("inits + sets user when DSN set", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://x@o.ingest.sentry.io/1");
    const m = await import("./errorTracking");
    m.initErrorTracking();
    m.setErrorUser("u1");
    expect(init).toHaveBeenCalledOnce();
    expect(setUser).toHaveBeenCalledWith({ id: "u1" }); // id only, never email
  });

  it("scrubEvent strips body/email/cookies and reduces url to path-only", async () => {
    const m = await import("./errorTracking");
    const out = m.scrubEvent({
      request: {
        data: { inputs: { demand: 5 } },
        cookies: "x",
        headers: { authorization: "b", "user-agent": "UA" },
        url: "https://nos-studio.onrender.com/chapter-3?scenario=1&token=abc",
      },
      user: { id: "u1", email: "a@b.c" },
    } as any);
    expect(out!.request?.data).toBeUndefined();
    expect(out!.request?.cookies).toBeUndefined();
    expect(out!.request?.headers).toEqual({ "user-agent": "UA" });
    expect(out!.request?.url).toBe("/chapter-3"); // path-only, query stripped (Review 5)
    expect(out!.user).toEqual({ id: "u1" });
  });

  it("scrubEvent reduces a query-and-fragment url to path-only (no query leaked)", async () => {
    const m = await import("./errorTracking");
    const out = m.scrubEvent({
      request: {
        url: "https://nos-studio.onrender.com/chapter-3?scenario=1&token=super-secret",
      },
    } as any);
    expect(out!.request?.url).toBe("/chapter-3");
    expect(JSON.stringify(out)).not.toMatch(/token|super-secret|scenario=1/);
  });
});
