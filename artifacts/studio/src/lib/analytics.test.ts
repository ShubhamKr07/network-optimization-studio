import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const capture = vi.fn();
const identify = vi.fn();
const reset = vi.fn();
const init = vi.fn();

vi.mock("posthog-js", () => ({
  default: { init, capture, identify, reset,
    __loaded: false },
}));

describe("analytics wrapper", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("no-ops track() when VITE_POSTHOG_KEY is unset", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    const a = await import("./analytics");
    a.initAnalytics();
    a.track("solve triggered", { scenario_id: 1, model_id: "p-median-us" });
    expect(init).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("initializes and captures when the key is set", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const a = await import("./analytics");
    a.initAnalytics();
    a.track("solve triggered", { scenario_id: 1, model_id: "p-median-us" });
    expect(init).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith("solve triggered", {
      scenario_id: 1, model_id: "p-median-us",
    });
  });

  it("strips props outside the allowlist", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const a = await import("./analytics");
    a.initAnalytics();
    a.track("override edited", {
      model_id: "p-median-us", field: "demand",
      email: "leak@example.com", city: "Atlanta", demand: 500,
    });
    expect(capture).toHaveBeenCalledWith("override edited", {
      model_id: "p-median-us", field: "demand",
    });
  });

  it("identify/reset forward the id", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const a = await import("./analytics");
    a.initAnalytics();
    a.identifyUser("user-123");
    a.resetUser();
    expect(identify).toHaveBeenCalledWith("user-123");
    expect(reset).toHaveBeenCalledOnce();
  });

  it("every allowlist key is snake_case", () => {
    // guards against camelCase drift
    return import("./analytics").then(a => {
      for (const k of a.ALLOWED_PROP_KEYS) {
        expect(k).toMatch(/^[a-z]+(_[a-z]+)*$/);
      }
    });
  });
});
