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
