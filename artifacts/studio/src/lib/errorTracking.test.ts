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

  // ERR-4 — SCND_STUDIO-2: Microsoft's link scanner (Outlook Safe Links)
  // opens emailed links headlessly and rejects with this non-Error value.
  // Sentry treats a string entry as a substring match on the event message.
  it("ignores the Microsoft link-scanner rejection, and only that", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://x@o.ingest.sentry.io/1");
    const m = await import("./errorTracking");
    m.initErrorTracking();
    const ignored: (string | RegExp)[] = init.mock.calls[0][0].ignoreErrors ?? [];
    const matches = (msg: string) =>
      ignored.some((p) => (typeof p === "string" ? msg.includes(p) : p.test(msg)));

    expect(matches(
      "Non-Error promise rejection captured with value: Object Not Found Matching Id:3, MethodName:update, ParamCount:4",
    )).toBe(true);
    expect(matches("TypeError: Cannot read properties of undefined (reading '_leaflet_pos')")).toBe(false);
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
