// artifacts/api-server/src/__tests__/watbotEvalFiles.test.ts
// FR-44 committed files: shape and coverage. Drafts may be status "draft";
// the live run (not this test) refuses until the owner approves them.
import { describe, it, expect } from "vitest";
import { WATBOT_MESSAGE_TYPES } from "@workspace/db";
import { listModels } from "../registry/modelRegistry.js";
import { loadEvalJson, parseAnswerKeys, parsePersonas, parseTestSet } from "../watbot/eval/testSet.js";

const appModels = listModels().filter((m) => m.tutor).map((m) => m.id);

describe("testSet.json", () => {
  const set = parseTestSet(loadEvalJson("testSet.json"), appModels);
  it("has 100 messages, 20 per type, across all 8 app models", () => {
    expect(appModels).toHaveLength(8); // non-vacuity: the registry really lists the app models
    expect(set.messages).toHaveLength(100);
    for (const t of WATBOT_MESSAGE_TYPES) expect(set.messages.filter((m) => m.type === t), t).toHaveLength(20);
    expect(new Set(set.messages.map((m) => m.modelId))).toEqual(new Set(appModels));
  });
  it("tests D14's 'already visible' case with solved contexts, including stuck_or_wants_answer", () => {
    const solved = set.messages.filter((m) => m.context?.summary.includes("{{objective}}"));
    expect(solved.length).toBeGreaterThanOrEqual(10);
    expect(solved.filter((m) => m.type === "stuck_or_wants_answer").length).toBeGreaterThanOrEqual(3);
  });
  it("gives every attempt the tutor question it answers", () => {
    for (const m of set.messages.filter((x) => x.type === "incorrect_attempt" || x.type === "correct_attempt")) {
      expect(m.history?.at(-1)?.role, m.id).toBe("tutor");
    }
  });
  it("holds student-style questions, not book text", () => {
    for (const m of set.messages) {
      expect(m.question.length, m.id).toBeLessThanOrEqual(300);
      expect(m.question, m.id).not.toContain("$$");
    }
  });
});

describe("personas.json", () => {
  it("has the six spec personas, 8 turns each, on app models", () => {
    const p = parsePersonas(loadEvalJson("personas.json"), appModels);
    expect(p.turns).toBe(8);
    expect(p.personas.map((x) => x.name)).toEqual([
      "confused beginner", "answer-seeker", "off-topic wanderer",
      "confident but wrong", "quick and correct", "persistent \"just give me the answer\"",
    ]);
  });
});

describe("answerKeys.json", () => {
  it("has one numbers-only key per app model", () => {
    const keys = parseAnswerKeys(loadEvalJson("answerKeys.json"), appModels);
    expect(Object.keys(keys).sort()).toEqual([...appModels].sort());
    // Non-vacuity: at least the p-median key carries a real objective and site set.
    expect(keys["p-median-us"]!.objective).toBeGreaterThan(0);
    expect(keys["p-median-us"]!.openSites.length).toBeGreaterThan(0);
  });
});
