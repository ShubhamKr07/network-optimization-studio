import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractReferences, isExemptByMarker, type InventoryRecord } from "../harness/lib/inventory.js";
import { repoRoot } from "../harness/lib/derive.js";
import { staleReference } from "../harness/lib/detectors/staleReference.js";
import { superseded } from "../harness/lib/detectors/superseded.js";
import { redundantPassage } from "../harness/lib/detectors/redundantPassage.js";
import { conflictingInstruction } from "../harness/lib/detectors/conflictingInstruction.js";
import { orphan } from "../harness/lib/detectors/orphan.js";
import { memoryContradiction } from "../harness/lib/detectors/memoryContradiction.js";
import { isExcluded } from "../harness/docs-audit.js";
import type { AuditConfig } from "../harness/lib/detectors/types.js";

const ROOT = repoRoot();
const CFG: AuditConfig = {
  include: [],
  exclude: ["docs/superpowers/specs/**", "docs/superpowers/plans/**", "replit.md"],
  memoryDir: "/tmp/none",
  authority: ["CLAUDE.md", "README.md", "*"],
};

function rec(path: string, text: string, over: Partial<InventoryRecord> = {}): InventoryRecord {
  const headings = text.split("\n").flatMap((l, i) => {
    const m = l.match(/^#{1,6}\s+(.*)$/);
    return m ? [{ text: m[1].trim(), line: i + 1 }] : [];
  });
  return {
    path,
    origin: "repo",
    title: headings[0]?.text ?? path,
    headings,
    lastChange: "2026-09-01",
    inboundLinks: [],
    references: extractReferences(text),
    text,
    ...over,
  };
}

describe("docs-audit detectors", () => {
  it("stale_reference: flags Arcadia and a nonexistent path", () => {
    const r = rec("README.md", "# Readme\nOn top sits **Arcadia**, a gamification layer with quests and XP badges.\nSee `artifacts/ghost/nope-xyz.ts` for details.\n");
    const cands = staleReference([r], CFG, ROOT);
    const types = cands.map((c) => c.evidence);
    expect(cands.length).toBeGreaterThanOrEqual(2);
    expect(types.some((e) => /Arcadia/i.test(e))).toBe(true);
    expect(types.some((e) => e.includes("artifacts/ghost/nope-xyz.ts"))).toBe(true);
    // line numbers point at the offending lines
    const arc = cands.find((c) => /Arcadia/i.test(c.evidence))!;
    expect(arc.lines[0]).toBe(2);
  });

  it("stale_reference: clean file yields zero", () => {
    const r = rec("docs/clean.md", "# Clean\nRun `pnpm typecheck` and read `CLAUDE.md`. Nothing stale here.\n");
    expect(staleReference([r], CFG, ROOT)).toEqual([]);
  });

  it("superseded: DEPRECATED marker and heading-overlap pair", () => {
    const dep = rec("old.md", "# Old plan\nDEPRECATED: see the new plan instead.\n");
    expect(superseded([dep], CFG, ROOT).length).toBeGreaterThanOrEqual(1);

    const a = rec("a.md", "# Title\n## Setup\n## Usage\n## Testing\n", { lastChange: "2026-01-01" });
    const b = rec("b.md", "# Title\n## Setup\n## Usage\n## Testing\n", { lastChange: "2026-08-01" });
    const pair = superseded([a, b], CFG, ROOT);
    expect(pair.some((c) => c.file === "a.md" && c.related.includes("b.md"))).toBe(true);
  });

  it("redundant_passage: near-duplicate paragraph across files (candidate = less authoritative)", () => {
    const para = "the solver wrapper never throws crashes timeouts and unparseable stdout all degrade to a well formed error envelope which the frontend renders as a friendly failure state rather than a blank screen or a hard crash in the studio application layer today";
    const a = rec("CLAUDE.md", `# A\n\n${para}\n`);
    const b = rec("docs/notes.md", `# B\n\n${para}\n`);
    const cands = redundantPassage([a, b], CFG, ROOT);
    expect(cands.length).toBe(1);
    expect(cands[0].file).toBe("docs/notes.md"); // less authoritative than CLAUDE.md
    expect(cands[0].related).toContain("CLAUDE.md");
  });

  it("conflicting_instruction: opposing modals sharing ≥3 tokens", () => {
    const a = rec("CLAUDE.md", "# A\nAlways run the database migration before every deploy.\n");
    const b = rec("docs/ops.md", "# B\nNever run the database migration before every deploy.\n");
    const cands = conflictingInstruction([a, b], CFG, ROOT);
    expect(cands.length).toBe(1);
    expect(cands[0].file).toBe("docs/ops.md"); // less authoritative
    expect(cands[0].related).toContain("CLAUDE.md");
  });

  it("orphan: no inbound links, not well-known, 90+ days old", () => {
    const oldDoc = rec("docs/forgotten.md", "# Forgotten\nnobody links here.\n", { lastChange: "2020-01-01", inboundLinks: [] });
    const fresh = rec("docs/active.md", "# Active\n", { lastChange: "2026-09-01" });
    const cands = orphan([oldDoc, fresh], CFG, ROOT);
    expect(cands.map((c) => c.file)).toEqual(["docs/forgotten.md"]);
  });

  it("memory_contradiction: memory asserts a removed feature", () => {
    const mem = rec("feedback_x.md", "# mem\nThe app deploys to Replit and uses the Arcadia gamification layer.\n", { origin: "memory" });
    const cands = memoryContradiction([mem], CFG, ROOT);
    expect(cands.length).toBeGreaterThanOrEqual(1);
    expect(cands[0].origin).toBe("memory");
  });

  it("exemption: an excluded glob path and the ignore marker are never in scope", () => {
    const exemptText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../harness/__fixtures__/docs/exempt-marker.md"), "utf8");
    expect(isExemptByMarker(exemptText)).toBe(true);
    expect(isExcluded("replit.md", CFG, "anything")).toBe(true);
    expect(isExcluded("docs/superpowers/plans/x.md", CFG, "anything")).toBe(true);
    expect(isExcluded("README.md", CFG, exemptText)).toBe(true); // marker wins even if path allowed
    expect(isExcluded("README.md", CFG, "# clean\nno marker")).toBe(false);
  });
});
