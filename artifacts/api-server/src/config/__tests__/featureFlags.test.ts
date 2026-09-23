// A11 — tests for the staged v1->v2 rollout flag module.
//
// `featureFlags.ts` resolves `isV2WriteEnabled()`'s value ONCE, at module
// load (so it can log the resolved value exactly once at startup — see the
// module's own comment). That means any test exercising a specific env-var
// value needs a *fresh* module instance: `vi.resetModules()` + a dynamic
// `import()` after setting `process.env.SOLVER_V2_WRITE_ENABLED`, mirroring
// the pattern `jobRunnerConcurrency.test.ts` established for the same
// "read env once at module load" shape.
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStrictBool } from "../featureFlags";

const ENV_VAR_NAME = "SOLVER_V2_WRITE_ENABLED";

describe("parseStrictBool", () => {
  it('accepts "true" -> true', () => {
    expect(parseStrictBool("true")).toBe(true);
  });

  it('accepts "false" -> false', () => {
    expect(parseStrictBool("false")).toBe(false);
  });

  it("rejects unset (undefined) -> false", () => {
    expect(parseStrictBool(undefined)).toBe(false);
  });

  it("rejects blank string -> false", () => {
    expect(parseStrictBool("")).toBe(false);
  });

  it("rejects whitespace-only string -> false", () => {
    expect(parseStrictBool("   ")).toBe(false);
  });

  it('rejects "1" -> false', () => {
    expect(parseStrictBool("1")).toBe(false);
  });

  it('rejects "0" -> false', () => {
    expect(parseStrictBool("0")).toBe(false);
  });

  it('rejects mixed case "True" -> false', () => {
    expect(parseStrictBool("True")).toBe(false);
  });

  it('rejects mixed case "TRUE" -> false', () => {
    expect(parseStrictBool("TRUE")).toBe(false);
  });

  it('rejects mixed case "False" -> false', () => {
    expect(parseStrictBool("False")).toBe(false);
  });

  it('rejects trailing/leading whitespace around "true" -> false (no trimming)', () => {
    expect(parseStrictBool(" true ")).toBe(false);
  });

  it("rejects garbage input -> false", () => {
    expect(parseStrictBool("enabled")).toBe(false);
  });
});

describe("isV2WriteEnabled (module-load-time resolution)", () => {
  const originalValue = process.env[ENV_VAR_NAME];

  afterEach(() => {
    if (originalValue === undefined) delete process.env[ENV_VAR_NAME];
    else process.env[ENV_VAR_NAME] = originalValue;
    vi.resetModules();
  });

  it('resolves true when SOLVER_V2_WRITE_ENABLED="true"', async () => {
    vi.resetModules();
    process.env[ENV_VAR_NAME] = "true";
    const mod = await import("../featureFlags");
    expect(mod.isV2WriteEnabled()).toBe(true);
  });

  it('resolves false when SOLVER_V2_WRITE_ENABLED="false"', async () => {
    vi.resetModules();
    process.env[ENV_VAR_NAME] = "false";
    const mod = await import("../featureFlags");
    expect(mod.isV2WriteEnabled()).toBe(false);
  });

  it("defaults to false (OFF) when the env var is unset", async () => {
    vi.resetModules();
    delete process.env[ENV_VAR_NAME];
    const mod = await import("../featureFlags");
    expect(mod.isV2WriteEnabled()).toBe(false);
  });

  it('resolves false for a non-strict value ("1") — fail-closed', async () => {
    vi.resetModules();
    process.env[ENV_VAR_NAME] = "1";
    const mod = await import("../featureFlags");
    expect(mod.isV2WriteEnabled()).toBe(false);
  });

  it('resolves false for mixed-case ("True") — fail-closed', async () => {
    vi.resetModules();
    process.env[ENV_VAR_NAME] = "True";
    const mod = await import("../featureFlags");
    expect(mod.isV2WriteEnabled()).toBe(false);
  });
});
