import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { SOLVERS_ROOT } from "./index.js";

const dir = path.join(SOLVERS_ROOT, "delivery-teaching-us", "dataset");
const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));

describe("delivery-teaching-us dataset package", () => {
  it("has 33 warehouses and 313 customers, keyed by role-prefixed entity id", () => {
    const w = read("warehouses.json");
    const c = read("customers.json");
    expect(Object.keys(w)).toHaveLength(33);
    expect(Object.keys(c)).toHaveLength(313);
    expect(w["W1"]).toMatchObject({ id: "W1", city: "Los Angeles" });
    expect(c["C1"]).toMatchObject({ id: "C1", city: "Los Angeles" });
    for (const [key, row] of Object.entries(w)) expect((row as { id: string }).id).toBe(key);
    for (const [key, row] of Object.entries(c)) expect((row as { id: string }).id).toBe(key);
    for (const row of [...Object.values(w), ...Object.values(c)]) {
      expect((row as { zip: string }).zip).toMatch(/^\d{5}$/);   // spec 4.3 leading zeros
    }
  });

  it("has all 10,329 lanes in BOTH tables, identical at seed, with 33 zero self-lanes", () => {
    const d = read("distances.json");
    const k = read("costs.json");
    expect(Object.keys(d)).toHaveLength(10329);
    expect(k).toEqual(d);
    expect(Object.values(d).filter((v) => v === 0)).toHaveLength(33);
    expect(d["W1,C1"]).toBe(0);
  });

  it("version.json's sha256 equals a recomputation over the four files in sorted order", () => {
    const v = read("version.json");
    expect(v.version).toBe(1);
    const hash = createHash("sha256");
    for (const name of ["costs.json", "customers.json", "distances.json", "warehouses.json"]) {
      hash.update(readFileSync(path.join(dir, name)));
    }
    expect(v.sha256).toBe(hash.digest("hex"));
  });
});
