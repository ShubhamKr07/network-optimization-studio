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
  it.each(DATASET_MODELS)("%s equals defaultInputsForModel", (id) => {
    expect(file[id]).toEqual(defaultInputsForModel(id as Parameters<typeof defaultInputsForModel>[0]));
  });
});
