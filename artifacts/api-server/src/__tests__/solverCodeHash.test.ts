import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { readVersion } from "@workspace/dataset-schema";
import { computeInputsHash } from "../solver/jobRunner.js";
import type { SolveInput } from "../solver/pmedian.js";

// SM-2: the cache key's solver-code component must cover merge_inputs.py as
// well as solve.py (jade's merge and super's distance logic live there).
describe("SOLVER_CODE_HASH covers merge_inputs.py", () => {
  const dir = path.join(__dirname, "..", "solver");
  const key = (code: Buffer[]) => {
    const h = crypto.createHash("sha256");
    code.forEach((b) => h.update(b));
    const codeHash = h.digest("hex").slice(0, 12);
    const version = String(readVersion("p-median-us").version);
    return crypto.createHash("sha256").update("p-median-us" + version + codeHash + "{}").digest("hex");
  };
  const solvePy = readFileSync(path.join(dir, "solve.py"));
  const mergePy = readFileSync(path.join(dir, "merge_inputs.py"));
  const input = { modelId: "p-median-us", inputs: {} } as unknown as SolveInput;

  it("equals the hash over solve.py + merge_inputs.py", () => {
    expect(computeInputsHash(input)).toBe(key([solvePy, mergePy]));
  });
  it("differs from a hash of solve.py alone", () => {
    expect(computeInputsHash(input)).not.toBe(key([solvePy]));
  });
});
