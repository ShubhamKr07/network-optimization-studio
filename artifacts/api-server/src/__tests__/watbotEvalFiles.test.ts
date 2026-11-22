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
  const base = set.messages.filter((m) => !m.repair);
  const repairs = set.messages.filter((m) => m.repair);
  it("has 100 base messages, 20 per type, across all 8 app models", () => {
    expect(appModels).toHaveLength(8); // non-vacuity: the registry really lists the app models
    expect(base).toHaveLength(100);
    for (const t of WATBOT_MESSAGE_TYPES) expect(base.filter((m) => m.type === t), t).toHaveLength(20);
    expect(new Set(base.map((m) => m.modelId))).toEqual(new Set(appModels));
  });
  // WATBOT-FB Task 6: 15 owner-approved re-answer cases (2026-11-22), weighted to where a leak is likeliest.
  it("has the 15 approved repair cases: 6 too_many_questions, 4 hard_to_follow, 5 not_what_i_asked", () => {
    expect(repairs).toHaveLength(15);
    const by = (r: string) => repairs.filter((m) => m.repair!.reason === r);
    expect(by("too_many_questions")).toHaveLength(6);
    expect(by("hard_to_follow")).toHaveLength(4);
    expect(by("not_what_i_asked")).toHaveLength(5);
    expect(by("too_many_questions").filter((m) => m.type === "incorrect_attempt" || m.type === "stuck_or_wants_answer")).toHaveLength(6);
    for (const m of by("not_what_i_asked")) expect(m.repair!.excludeType, m.id).toBeDefined();
    for (const m of repairs) expect(m.history!.at(-2)?.text, m.id).toBe(m.question); // history ends at the answer being repaired
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

describe("repair cases", () => {
  const withRepair = (repair: unknown, history?: unknown) => ({
    version: 1, status: "draft",
    messages: [{ id: "r1", modelId: appModels[0], type: "concept_question", question: "q", context: null, repair, ...(history ? { history } : {}) }],
  });
  const hist = [{ role: "student", text: "q" }, { role: "tutor", text: "a" }];
  it("rejects an unknown repair reason", () => {
    expect(() => parseTestSet(withRepair({ reason: "still_stuck" }, hist), appModels))
      .toThrow("repair.reason must be one of too_many_questions, hard_to_follow, not_what_i_asked");
  });
  it("rejects a repair case with no history", () => {
    expect(() => parseTestSet(withRepair({ reason: "hard_to_follow" }), appModels))
      .toThrow("a repair case needs the history up to the answer being repaired");
  });
  it("accepts a valid repair case", () => {
    expect(parseTestSet(withRepair({ reason: "hard_to_follow" }, hist), appModels).messages[0]!.repair).toEqual({ reason: "hard_to_follow" });
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
