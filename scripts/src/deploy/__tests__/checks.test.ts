import { describe, it, expect } from "vitest";
import { parseSmokeArgs, resolveEnv, rollupByService, formatResults } from "../smoke.js";
import { findBundleSrc } from "../checks/viteEnvBaked.js";
import { cookiePair } from "../checks/types.js";
import { postgresTls } from "../checks/postgresTls.js";
import type { CheckResult, SmokeCtx } from "../checks/types.js";

describe("smoke arg/env resolution", () => {
  it("defaults to production live URLs", () => {
    const env = resolveEnv(parseSmokeArgs([]), {});
    expect(env.apiBase).toBe("https://nos-api-uwf8.onrender.com");
    expect(env.studioBase).toBe("https://nos-studio.onrender.com");
  });

  it("flags beat env beat default, and trailing slashes are trimmed", () => {
    const env = resolveEnv(parseSmokeArgs(["--api-base", "http://localhost:3001/"]), {
      NOS_API_BASE: "http://env:9",
      NOS_STUDIO_BASE: "http://env-studio:8/",
    });
    expect(env.apiBase).toBe("http://localhost:3001"); // flag wins over env
    expect(env.studioBase).toBe("http://env-studio:8"); // env wins over default, slash trimmed
  });
});

describe("rollupByService", () => {
  const mk = (name: string, pass: boolean, warn = false): CheckResult => ({ name, pass, warn, detail: "", ms: 1 });
  it("groups api vs studio and treats warn as non-failing", () => {
    const roll = rollupByService([
      mk("postgres_tls", true),
      mk("free_tier_wakeup", false, true), // warn → not a failure
      mk("vite_env_baked", false), // hard fail on studio
      mk("cors_preflight", false), // hard fail on api
    ]);
    const api = roll.find((r) => r.service === "nos-api")!;
    const studio = roll.find((r) => r.service === "nos-studio")!;
    expect(api.smokePass).toBe(false);
    expect(api.failedChecks).toEqual(["cors_preflight"]); // warn excluded
    expect(studio.smokePass).toBe(false);
    expect(studio.failedChecks).toEqual(["vite_env_baked"]);
  });
});

describe("pure helpers", () => {
  it("findBundleSrc extracts the first module script", () => {
    expect(findBundleSrc('<script type="module" crossorigin src="/assets/index-abc.js"></script>')).toBe("/assets/index-abc.js");
    expect(findBundleSrc("<html>no script</html>")).toBeNull();
  });
  it("cookiePair takes the name=value before the first semicolon", () => {
    expect(cookiePair("nos_session=abc123; Path=/; Secure; SameSite=None")).toBe("nos_session=abc123");
  });
  it("formatResults tags PASS/WARN/FAIL", () => {
    const s = formatResults([
      { name: "a", pass: true, detail: "ok", ms: 1 },
      { name: "b", pass: false, warn: true, detail: "slow", ms: 2 },
      { name: "c", pass: false, detail: "bad", ms: 3 },
    ]);
    expect(s).toContain("[PASS] a");
    expect(s).toContain("[WARN] b");
    expect(s).toContain("[FAIL] c");
  });
});

describe("postgresTls check with injected fetch", () => {
  const ctx = (impl: typeof fetch): SmokeCtx => ({ fetch: impl, cookieJar: { value: null } });
  const env = { apiBase: "http://api", studioBase: "http://studio" };

  it("passes when healthz reports db:ok", async () => {
    const fakeFetch = (async () => ({ ok: true, status: 200, json: async () => ({ status: "ok", db: "ok" }) })) as unknown as typeof fetch;
    const r = await postgresTls(env, ctx(fakeFetch));
    expect(r.pass).toBe(true);
  });

  it("fails when db is down", async () => {
    const fakeFetch = (async () => ({ ok: true, status: 200, json: async () => ({ status: "ok", db: "down" }) })) as unknown as typeof fetch;
    const r = await postgresTls(env, ctx(fakeFetch));
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("db=down");
  });
});
