import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { UI_RATE_MAX, UI_MIN_CHARGE_MAX, TEXTBOOK_TRANSPORT_COSTS } from "@/lib/transportCosts";

const HERE = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repo root (pnpm-workspace.yaml) not found above " + start);
}

// ch9-tc — the maxima are declared in THREE places (manifest JSON Schema,
// api-server Zod, this UI constant) and the spec requires them pinned
// equal. jadeTransportCosts.test.ts pins manifest<->Zod on the server side;
// this is the UI leg of the same triangle, read from the manifest on disk
// so a server-side bound change that forgets the UI goes red here.
describe("ch9-tc — UI transport-cost bounds match the manifest", () => {
  const manifest = JSON.parse(
    readFileSync(join(findRepoRoot(HERE), "solvers/two-echelon-jade-us/manifest.json"), "utf8"),
  );
  const tc = manifest.inputsSchema.properties.transportCosts.properties;

  it("pins the rate maximum", () => {
    expect(tc.icTransCost.maximum).toBe(UI_RATE_MAX);
    expect(tc.obTransCost.maximum).toBe(UI_RATE_MAX);
  });

  it("pins the minimum-charge maximum", () => {
    expect(tc.icMinTrans.maximum).toBe(UI_MIN_CHARGE_MAX);
    expect(tc.obMinTrans.maximum).toBe(UI_MIN_CHARGE_MAX);
  });

  it("keeps the textbook defaults equal to solve.py's constants", () => {
    const solvePy = readFileSync(
      join(findRepoRoot(HERE), "artifacts/api-server/src/solver/solve.py"), "utf8",
    );
    const readPythonNumber = (name: string): number => {
      const match = solvePy.match(new RegExp(`^${name}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)`, "m"));
      if (!match) throw new Error(`missing numeric Python constant ${name}`);
      return Number(match[1]);
    };
    expect({
      icTransCost: readPythonNumber("JADE_IC_RATE"),
      icMinTrans: readPythonNumber("JADE_IC_MIN"),
      obTransCost: readPythonNumber("JADE_OB_RATE"),
      obMinTrans: readPythonNumber("JADE_OB_MIN"),
    }).toEqual(TEXTBOOK_TRANSPORT_COSTS);
  });
});
