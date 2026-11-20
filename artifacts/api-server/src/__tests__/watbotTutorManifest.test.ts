import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_TAB_IDS } from "@workspace/dataset-schema";
import { listModels, getManifest } from "../registry/modelRegistry.js";

const EXPECTED_MODELS = [
  "p-median-us", "max-coverage-us", "p-median-brazil", "delivery-teaching-us",
  "transport-coal", "two-echelon-jade-us", "two-echelon-gold-au", "super-model",
];

describe("tutor manifest block", () => {
  it("every app model ships reading list + exactly 3 fixed questions", () => {
    for (const id of EXPECTED_MODELS) {
      const m = getManifest(id);
      expect(m, id).toBeDefined();
      expect(m!.tutor, id).toBeDefined();
      expect(m!.tutor!.readingList.length, id).toBeGreaterThan(0);
      expect(m!.tutor!.fixedQuestions.map((q) => q.id), id).toEqual(["q1", "q2", "q3"]);
    }
  });

  it("GET /models projection carries tutor", () => {
    const jade = listModels().find((m) => m.id === "two-echelon-jade-us")!;
    expect(jade.tutor?.readingList).toEqual([
      { kind: "book", chapter: 9 }, { kind: "book", chapter: 6 },
      { kind: "book", chapter: 7 }, { kind: "notebook", chapter: 9 },
    ]);
  });

  // Drift guard, both directions. Every sidebar entry id in Workspace.tsx must be in
  // WORKSPACE_TAB_IDS (else asking WatBot on that tab 400s), and every list entry must be real.
  const sidebarIds = () => {
    const src = readFileSync(path.resolve(process.cwd(), "../studio/src/pages/Workspace.tsx"), "utf8");
    return new Set([...src.matchAll(/\{ id: "([A-Za-z0-9_-]+)", label: "/g)].map((m) => m[1]!));
  };
  const missingFrom = (list: readonly string[], ids: Set<string>) => [...ids].filter((id) => !list.includes(id));

  it("every WORKSPACE_TAB_IDS entry is a real Workspace sidebar id", () => {
    const ids = sidebarIds();
    for (const tab of WORKSPACE_TAB_IDS) expect(ids.has(tab), tab).toBe(true);
  });

  it("every Workspace sidebar id is in WORKSPACE_TAB_IDS", () => {
    const ids = sidebarIds();
    expect(ids.size).toBeGreaterThan(20); // the scan must find the sidebar, not match nothing
    expect(missingFrom(WORKSPACE_TAB_IDS, ids)).toEqual([]);
  });

  it("the reverse check can fail: a list missing one id is reported", () => {
    expect(missingFrom(WORKSPACE_TAB_IDS.filter((t) => t !== "laneCosts"), sidebarIds())).toEqual(["laneCosts"]);
  });
});
