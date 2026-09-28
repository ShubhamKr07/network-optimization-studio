import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { MODEL_IDS, PACKAGE_SPECS } from "@workspace/dataset-schema";
import { KNOWN_MODEL_IDS } from "../registry/modelRegistry.js";
import { VALID_MODEL_IDS } from "../routes/scenarios.js";

function repoRoot(): string {
  let dir = process.cwd();
  while (!readFileSyncSafe(path.join(dir, "pnpm-workspace.yaml"))) dir = path.dirname(dir);
  return dir;
}
function readFileSyncSafe(p: string): string | null { try { return readFileSync(p, "utf8"); } catch { return null; } }

describe("model-id registries are one set", () => {
  const canonical = new Set<string>(MODEL_IDS);

  it("KNOWN_SCHEMAS, VALID_MODEL_IDS and PACKAGE_SPECS match MODEL_IDS exactly", () => {
    expect(new Set(KNOWN_MODEL_IDS)).toEqual(canonical);
    expect(new Set(VALID_MODEL_IDS)).toEqual(canonical);
    expect(new Set(PACKAGE_SPECS.map((s) => s.modelId))).toEqual(canonical);
  });

  it("every openapi modelId enum lists every id (and no extra)", () => {
    const yaml = readFileSync(path.join(repoRoot(), "lib/api-spec/openapi.yaml"), "utf8");
    // Three multi-line sites use "- <id>" list items (:166-172, :1418-1424, :1619-1625).
    for (const id of canonical) expect(yaml.split(`- ${id}\n`).length - 1).toBe(3);
    // The GET /dataset site (:47) is a single-line "enum: [a, b, c]" whose ORDER
    // does not match MODEL_IDS - compare as sets, never as a joined string.
    const single = yaml.match(/enum: \[([^\]]+)\]/g) ?? [];
    const site = single.find((s) => s.includes("p-median-us"))!;
    const ids = site.slice("enum: [".length, -1).split(",").map((s) => s.trim());
    expect(new Set(ids)).toEqual(canonical);
  });

  it("chapters.ts' StudioModelType names exactly the same ids", () => {
    const src = readFileSync(path.join(repoRoot(), "artifacts/studio/src/lib/chapters.ts"), "utf8");
    const union = src.split("\n")[0]!;
    const ids = [...union.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(new Set(ids)).toEqual(canonical);
  });
});
