import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// SCU-2.P4.1 (spec D2) — the UI half of "history is read-only". The write
// half is pinned by historyReadOnlyGuards.test.ts (every mutator no-ops while
// browsing history), but that only makes a stale edit SILENT: the input still
// looks editable and the keystroke vanishes. D2 makes every editable cell in
// every input tab visibly disabled, which needs each tab mount in
// Workspace.tsx to pass the live history flag. This scans every mount, so a
// table that forgets the prop — or a new mount of a listed tab — fails here.
//
// Each P4 migration task flips its tab from "pending" to the prop it wires;
// "pending" also asserts the prop is still ABSENT, so the flip is a
// deliberate, reviewed edit. The last migration (SCU-2.P4.14) adds the
// assertion that nothing is left pending.
const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../pages/Workspace.tsx");

const INPUT_TAB_HISTORY_PROP: Record<string, "readOnly" | "disabled" | "pending"> = {
  WarehousesTab: "disabled", // warehouses + refineries mounts (pre-existing)
  CustomersTab: "disabled", // pre-existing
  TransportCostsTab: "disabled", // pre-existing
  DistancesTab: "pending", // SCU-2.P4.3
  LegDistancesTab: "pending", // SCU-2.P4.4
  JadeDistancesTab: "pending", // SCU-2.P4.5
  LaneCostsTab: "pending", // SCU-2.P4.6
  DeliveryCostsTab: "pending", // SCU-2.P4.7
  CapabilityMatrixTab: "pending", // SCU-2.P4.9
  PlantsTab: "pending", // SCU-2.P4.12
  MinesTab: "pending", // SCU-2.P4.13
  StationsTab: "pending", // SCU-2.P4.14
};

/** Every `<Name … />` mount's prop text (from the tag to its own `/>` line). */
function mounts(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b`, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const end = src.indexOf("\n", src.slice(m.index).search(/\n\s*\/>/) + m.index + 1);
    out.push(src.slice(m.index, end));
  }
  return out;
}

describe("Workspace — every input tab mount receives the history flag (D2)", () => {
  const src = fs.readFileSync(WORKSPACE, "utf8");

  it.each(Object.entries(INPUT_TAB_HISTORY_PROP))("%s → %s", (name, prop) => {
    const found = mounts(src, name);
    expect(found.length, `${name} is not mounted in Workspace.tsx`).toBeGreaterThan(0);
    for (const m of found) {
      if (prop === "pending") {
        expect(m).not.toMatch(/\b(readOnly|disabled)=\{isBrowsingHistoryNow\}/);
      } else {
        expect(m).toContain(`${prop}={isBrowsingHistoryNow}`);
      }
    }
  });

  it("the mount scanner is not vacuous: it finds both WarehousesTab mounts", () => {
    expect(mounts(src, "WarehousesTab")).toHaveLength(2);
    expect(mounts(src, "WarehousesTab").every(m => m.includes("onChange="))).toBe(true);
  });
});
