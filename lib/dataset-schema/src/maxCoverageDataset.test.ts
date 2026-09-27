import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { SOLVERS_ROOT } from "./index.js";

const dir = path.join(SOLVERS_ROOT, "max-coverage-us", "dataset");
const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));
const MI2KM = 1.609344;

describe("max-coverage-us dataset package", () => {
  it("has 26 warehouses and 200 customers, keyed by entity id", () => {
    const w = read("warehouses.json");
    const c = read("customers.json");
    expect(Object.keys(w)).toHaveLength(26);
    expect(Object.keys(c)).toHaveLength(200);
    expect(w["ALN"]).toMatchObject({ id: "ALN", city: "Allentown", state: "PA" });
    expect(c["C1"]).toMatchObject({ id: "C1", city: "Akron", state: "OH", demand: 205375 });
    for (const [key, row] of Object.entries(w)) expect((row as { id: string }).id).toBe(key);
    for (const [key, row] of Object.entries(c)) expect((row as { id: string }).id).toBe(key);
  });

  it("has all 5200 distance pairs, keyed '<warehouseId>,<customerId>' in km", () => {
    const d = read("distances.json");
    const src = read2("distances.json");
    expect(Object.keys(d)).toHaveLength(5200);
    // Chapter 3's ALN->C1 in miles, converted, with NO circuity transform (MIG-6).
    const alnC1Mi = src["1,1"];
    expect(d["ALN,C1"]).toBeCloseTo(alnC1Mi * MI2KM, 6);
  });

  it("preserves co-located pairs rather than recomputing them (MIG-6)", () => {
    const d = read("distances.json");
    const zeros = Object.values(d).filter((v) => v === 0);
    expect(zeros).toHaveLength(4);
    const twos = Object.values(d).filter((v) => Math.abs((v as number) - 2 * MI2KM) < 1e-9);
    expect(twos).toHaveLength(8);
  });

  it("version.json's sha256 equals computeSha256 over the package", () => {
    const v = read("version.json");
    expect(v.version).toBe(1);
    // A 64-hex-character check alone would let a STALE but well-formed hash
    // pass. Recompute and compare -- this is the assertion that catches a
    // dataset regenerated without refreshing version.json.
    const hash = createHash("sha256");
    for (const name of ["customers.json", "distances.json", "warehouses.json"]) {
      hash.update(readFileSync(path.join(dir, name)));
    }
    expect(v.sha256).toBe(hash.digest("hex"));
  });
});

function read2(f: string) {
  return JSON.parse(readFileSync(path.join(SOLVERS_ROOT, "p-median-us", "dataset", f), "utf8"));
}
