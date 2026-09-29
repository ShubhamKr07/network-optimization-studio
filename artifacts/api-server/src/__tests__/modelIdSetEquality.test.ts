import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { MODEL_IDS, PACKAGE_SPECS } from "@workspace/dataset-schema";
import { KNOWN_MODEL_IDS, KNOWN_SCHEMAS } from "../registry/modelRegistry.js";
import { VALID_MODEL_IDS } from "../routes/scenarios.js";

function repoRoot(): string {
  let dir = process.cwd();
  while (!readFileSyncSafe(path.join(dir, "pnpm-workspace.yaml"))) dir = path.dirname(dir);
  return dir;
}
function readFileSyncSafe(p: string): string | null { try { return readFileSync(p, "utf8"); } catch { return null; } }

// solve.py's dispatcher (the one registration point on the Python side)
// keys on a wire `modelType` string that is DELIBERATELY different from the
// public model id (MIG-21, confirmed in pmedian.ts's buildPayload — e.g.
// "p-median-us" -> "p_median", "delivery-teaching-us" -> "delivery"). This
// map mirrors buildPayload's own modelId -> modelType translation 1:1 so the
// dispatcher's branch set can be compared against MODEL_IDS at all; the
// `satisfies` clause makes the TS compiler itself refuse to typecheck if a
// future model id is added here without a wire-value entry.
const WIRE_MODEL_TYPE_BY_MODEL_ID = {
  "p-median-us": "p_median",
  "p-median-brazil": "capacitated_pmedian",
  "transport-coal": "transport",
  "two-echelon-gold-au": "two_echelon",
  "two-echelon-jade-us": "two_echelon_jade",
  "max-coverage-us": "max_coverage_us",
  "delivery-teaching-us": "delivery",
} satisfies Record<(typeof MODEL_IDS)[number], string>;

describe("model-id registries are one set", () => {
  const canonical = new Set<string>(MODEL_IDS);

  it("KNOWN_SCHEMAS, KNOWN_MODEL_IDS, VALID_MODEL_IDS and PACKAGE_SPECS match MODEL_IDS exactly", () => {
    expect(new Set(Object.keys(KNOWN_SCHEMAS))).toEqual(canonical);
    expect(new Set(KNOWN_MODEL_IDS)).toEqual(canonical);
    expect(new Set(VALID_MODEL_IDS)).toEqual(canonical);
    expect(new Set(PACKAGE_SPECS.map((s) => s.modelId))).toEqual(canonical);
  });

  it("solve.py's dispatcher has exactly one modelType branch per MODEL_IDS entry", () => {
    const src = readFileSync(
      path.join(repoRoot(), "artifacts/api-server/src/solver/solve.py"),
      "utf8",
    );
    // Isolate the dispatcher function so a `model_type == '...'` comparison
    // elsewhere in the file (there is none today, but this keeps the probe
    // scoped to the actual registration point rather than a repo-wide grep)
    // can't inflate or corrupt the extracted branch set.
    const fnStart = src.indexOf("def solve(inp):");
    expect(fnStart, "solve.py must still define a solve(inp) dispatcher").toBeGreaterThan(-1);
    const nextDef = src.indexOf("\ndef ", fnStart + 1);
    const dispatcherSrc = src.slice(fnStart, nextDef === -1 ? src.length : nextDef);

    const branches = [...dispatcherSrc.matchAll(/model_type == '([a-z_]+)'/g)].map((m) => m[1]!);
    const expectedWireValues = new Set(Object.values(WIRE_MODEL_TYPE_BY_MODEL_ID));
    expect(new Set(branches)).toEqual(expectedWireValues);
    // No duplicate branch for the same wire value (a copy-paste that shadows
    // an earlier model's branch rather than adding a new one).
    expect(branches.length).toBe(expectedWireValues.size);
  });

  it("every openapi modelId enum lists every id (and no extra)", () => {
    const yaml = readFileSync(path.join(repoRoot(), "lib/api-spec/openapi.yaml"), "utf8");
    // Three multi-line sites use "- <id>" list items (:166-172, :1418-1424, :1619-1625).
    for (const id of canonical) expect(yaml.split(`- ${id}\n`).length - 1).toBe(3);
    // The GET /dataset site (:47) is a single-line "enum: [a, b, c]" whose ORDER
    // does not match MODEL_IDS - compare as sets, never as a joined string.
    const single: string[] = yaml.match(/enum: \[([^\]]+)\]/g) ?? [];
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
