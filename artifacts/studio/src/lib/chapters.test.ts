import { describe, it, expect } from "vitest";
import { CHAPTERS, chapterForModelId, chapterPathForModelId } from "./chapters";

// Task 9 (Chapter 9 — JADE multi-product two-echelon): registration guard.
// Mirrors the exact bug class that shipped for two-echelon-gold-au (Chapter
// 10) — a hardcoded per-model ternary silently fell through to another
// chapter's title because it had no branch for the new model. chapterForModelId
// is a pure CHAPTERS lookup with no ternary/fallback branch at all, so any
// registered model gets its own distinct entry by construction — these tests
// pin that invariant down for two-echelon-jade-us specifically.

describe("chapters — two-echelon-jade-us (Chapter 9) registration", () => {
  it("chapterForModelId resolves the JADE entry with the expected fields", () => {
    const chapter = chapterForModelId("two-echelon-jade-us");
    expect(chapter).toBeDefined();
    expect(chapter?.path).toBe("/chapter-9/jade");
    expect(chapter?.chapter).toBe("Chapter 9");
    expect(chapter?.workspace).toBe(true);
    // Unhidden on Landing as of jade-T17 (browser-verified full build).
    expect(chapter?.hiddenFromLanding).toBeUndefined();
    expect(chapter?.labHeaderTitle).toMatch(/JADE/);
    expect(chapter?.labHeaderSubtitle).toMatch(/Ch 9/);
  });

  it("chapterPathForModelId resolves /chapter-9/jade for two-echelon-jade-us", () => {
    expect(chapterPathForModelId("two-echelon-jade-us")).toBe("/chapter-9/jade");
  });

  // Regression guard for the exact bug class that shipped for Chapter 10
  // ("Al's Athletics" rendering on every Chapter 10 screen): every
  // registered chapter must resolve to ITS OWN title, never another
  // chapter's, when looked up by modelId.
  it("every registered chapter's modelId resolves to its own title, not another chapter's", () => {
    for (const chapter of CHAPTERS) {
      const resolved = chapterForModelId(chapter.modelId);
      expect(resolved?.title).toBe(chapter.title);
      expect(resolved?.labHeaderTitle).toBe(chapter.labHeaderTitle);
    }
  });

  it("an unregistered modelId resolves to undefined, never a fallback chapter", () => {
    expect(chapterForModelId("not-a-real-model")).toBeUndefined();
    expect(chapterForModelId(undefined)).toBeUndefined();
  });

  it("CHAPTERS is registered exactly once for two-echelon-jade-us", () => {
    const matches = CHAPTERS.filter((c) => c.modelId === "two-echelon-jade-us");
    expect(matches).toHaveLength(1);
  });
});

// C4.11 — Al's Athletics Max Coverage (Chapter 4, max-coverage-us)
// registration guard (ch4-mig-8: rewritten off the retired
// `chens-cosmetics-cn`/China copy onto the US cutover's real title). Same
// registration-point invariant as the JADE block above: a real Chapter
// entry (all required fields) so App.tsx's CHAPTERS.map derives /chapter-4
// automatically — no manual route, no per-model ternary fallthrough.
describe("chapters — max-coverage-us (Chapter 4) registration", () => {
  it("chapterForModelId resolves the max-coverage-us entry with the expected fields", () => {
    const chapter = chapterForModelId("max-coverage-us");
    expect(chapter).toBeDefined();
    expect(chapter?.path).toBe("/chapter-4");
    expect(chapter?.chapter).toBe("Chapter 4");
    expect(chapter?.workspace).toBe(true);
    expect(chapter?.hiddenFromLanding).toBe(false);
    expect(chapter?.title).toMatch(/AL's Athletics/);
    // Real one-line lab description, not a placeholder.
    expect(chapter?.description).toBeTruthy();
    expect(chapter?.description.length).toBeGreaterThan(20);
    expect(chapter?.labHeaderTitle).toMatch(/AL's Athletics/);
    expect(chapter?.labHeaderSubtitle).toMatch(/Ch 4/);
  });

  it("chapterPathForModelId resolves /chapter-4 for max-coverage-us", () => {
    expect(chapterPathForModelId("max-coverage-us")).toBe("/chapter-4");
  });

  it("CHAPTERS is registered exactly once for max-coverage-us", () => {
    const matches = CHAPTERS.filter((c) => c.modelId === "max-coverage-us");
    expect(matches).toHaveLength(1);
  });
});

// Workspace fixups 2 / T2 — AL's Athletics Landing title no longer carries
// "P-Median" (the header bar's labHeaderTitle/labHeaderSubtitle intentionally
// keep it — this only scopes the Landing-facing chapter title).
describe("chapters — AL's Athletics (p-median-us) Landing title", () => {
  it("title does not mention P-Median", () => {
    const chapter = chapterForModelId("p-median-us");
    expect(chapter).toBeDefined();
    expect(chapter?.title).toBe("AL's Athletics");
    expect(chapter?.title).not.toMatch(/P-Median/i);
  });

  it("labHeaderTitle/labHeaderSubtitle are left untouched", () => {
    const chapter = chapterForModelId("p-median-us");
    expect(chapter?.labHeaderTitle).toBe("AL's Athletics · Model Lab");
    expect(chapter?.labHeaderSubtitle).toMatch(/p-median/i);
  });
});
