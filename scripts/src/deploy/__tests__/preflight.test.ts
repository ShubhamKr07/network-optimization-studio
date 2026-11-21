import { describe, it, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mapPath, isCommentOnlyDiff, newEnvVars, envVars, studioLibs, verifyStudio, main, ROOT_BOTH, ROOT_API_ONLY } from "../preflight.js";

const root = join(__dirname, "../../../..");
const libs = ["api-client-react", "units"];
const svc = (p: string) => { const m = mapPath(p, libs); return m.kind === "deploy" ? m.services : m.kind; };

describe("mapPath", () => {
  it("maps source dirs", () => {
    expect(svc("solvers/max-coverage-us/manifest.json")).toEqual(["nos-api"]);
    expect(svc("artifacts/studio/src/App.tsx")).toEqual(["nos-studio"]);
    expect(svc("lib/db/src/schema/users.ts")).toEqual(["nos-api"]);
    expect(svc("lib/units/src/index.ts")).toEqual(["nos-api", "nos-studio"]);
  });
  it("maps root build inputs", () => {
    expect(svc("pnpm-lock.yaml")).toEqual(["nos-api", "nos-studio"]);
    expect(svc("Dockerfile")).toEqual(["nos-api"]);
    expect(svc("render.yaml")).toBe("config-sync");
  });
  it("never drops an unknown path", () => {
    expect(svc("some-new-dir/x.ts")).toBe("unmapped");
    expect(svc("docs/ops/x.md")).toBe("no-deploy");
  });
  it("every listed root file exists, and studio libs derive from its package.json", () => {
    for (const f of [...ROOT_BOTH, ...ROOT_API_ONLY, "render.yaml"]) expect(existsSync(join(root, f)), f).toBe(true);
    expect(studioLibs(root)).toEqual(expect.arrayContaining(["api-client-react", "units"]));
  });
});

describe("isCommentOnlyDiff", () => {
  it("accepts comment/blank edits", () => {
    expect(isCommentOnlyDiff("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-// old\n+// new\n+ * doc\n+\n")).toBe(true);
  });
  it("rejects a column change", () => {
    expect(isCommentOnlyDiff("+++ b/x\n+// note\n+  resetAt: timestamp(\"reset_at\"),\n")).toBe(false);
  });
});

describe("env var extraction", () => {
  it("finds process.env and VITE vars", () => {
    expect(envVars('const k = process.env.RESEND_API_KEY ?? process.env["SENTRY_DSN"]; import.meta.env.VITE_X1')).toEqual(["RESEND_API_KEY", "SENTRY_DSN", "VITE_X1"]);
  });
  it("finds Python os.environ.get / os.environ[] / os.getenv reads", () => {
    expect(envVars('a = os.environ.get("PY_A"); b = os.environ[\'PY_B\']; c = os.getenv("PY_C", "x")')).toEqual(["PY_A", "PY_B", "PY_C"]);
    expect(envVars("d = os.environ.get('PY_D')")).toEqual(["PY_D"]);
  });
  it("reports added vars per file, ignoring moved lines, tests and docs", () => {
    const d = [
      "diff --git a/artifacts/api-server/src/a.ts b/artifacts/api-server/src/a.ts", "+const a = process.env.NEW_ONE;", "-const b = process.env.OLD;", "+const b = process.env.OLD;",
      "diff --git a/artifacts/api-server/src/__tests__/a.test.ts b/artifacts/api-server/src/__tests__/a.test.ts", "+process.env.TEST_ONLY",
      "diff --git a/docs/x.md b/docs/x.md", "+process.env.IN_DOCS", "",
    ].join("\n");
    const r = newEnvVars(d);
    expect([...r.keys()]).toEqual(["artifacts/api-server/src/a.ts"]);
    expect([...r.get("artifacts/api-server/src/a.ts")!]).toEqual(["NEW_ONE"]);
  });
});

describe("verifyStudio", () => {
  const f = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
  it("passes on 200 + root, fails otherwise", async () => {
    expect(await verifyStudio("u", f(200, '<div id="root"></div>'))).toBeNull();
    expect(await verifyStudio("u", f(404, "x"))).toMatch(/404/);
    expect(await verifyStudio("u", f(200, "nope"))).toMatch(/id="root"/);
  });
});

describe("schema check", () => {
  // vitest runs from scripts/, the same cwd as `pnpm deploy:preflight`, so this reproduces the
  // blind check: 5a43bdf4 (PWR-1) added two columns to users and was reported "unchanged".
  it("flags a real schema change when run from a subdirectory", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["5a43bdf4~1..5a43bdf4"]);
      const out = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(out).toContain("SCHEMA CHANGED (substantive)");
      expect(out).not.toContain("lib/db/src/schema unchanged");
    } finally {
      log.mockRestore();
    }
  });
});
