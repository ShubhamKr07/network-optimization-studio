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

  // Drift guard: the tab-id enum is copied from Workspace.tsx's sidebar entries.
  // If a sidebar id is renamed, this fails instead of a starter silently losing "For this tab".
  it("every WORKSPACE_TAB_IDS entry is a real Workspace sidebar id", () => {
    const src = readFileSync(path.resolve(process.cwd(), "../studio/src/pages/Workspace.tsx"), "utf8");
    const ids = new Set([...src.matchAll(/\{ id: "([a-z-]+)", label: "/g)].map((m) => m[1]));
    for (const tab of WORKSPACE_TAB_IDS) expect(ids.has(tab), tab).toBe(true);
  });
});
