// artifacts/studio/src/__tests__/watbotEvalDefaults.test.ts
// Drift guard: the WatBot test set solves each model's DEFAULT scenario for its
// answer keys, so defaultInputs.json must equal what a new scenario gets.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defaultInputsForModel } from "@/pages/Workspace";

const file = JSON.parse(readFileSync(path.resolve(process.cwd(), "../api-server/src/watbot/eval/defaultInputs.json"), "utf8")) as Record<string, unknown>;
const DATASET_MODELS = [
  "p-median-us", "max-coverage-us", "p-median-brazil", "delivery-teaching-us",
  "transport-coal", "two-echelon-jade-us", "two-echelon-gold-au",
];

describe("WatBot test-set default inputs", () => {
  it("covers every dataset model (super-model reads superDefaults.json directly)", () => {
    expect(Object.keys(file).sort()).toEqual([...DATASET_MODELS].sort());
  });
  // WATBOT-KEYS (owner decision, 2026-11-21): Brazil's default solves infeasible, so its answer key
  // uses the solvable single-source=false variant. Every other field must still equal the default.
  const DEVIATIONS: Record<string, Record<string, unknown>> = { "p-median-brazil": { singleSource: false } };
  it.each(DATASET_MODELS)("%s equals defaultInputsForModel, plus its documented deviation", (id) => {
    expect(file[id]).toEqual({ ...defaultInputsForModel(id as Parameters<typeof defaultInputsForModel>[0]), ...DEVIATIONS[id] });
  });
  it("each deviation actually differs from the default (otherwise delete it)", () => {
    for (const [id, dev] of Object.entries(DEVIATIONS)) {
      const base = defaultInputsForModel(id as Parameters<typeof defaultInputsForModel>[0]) as Record<string, unknown>;
      for (const [k, v] of Object.entries(dev)) expect(base[k], `${id}.${k}`).not.toEqual(v);
    }
  });
});
