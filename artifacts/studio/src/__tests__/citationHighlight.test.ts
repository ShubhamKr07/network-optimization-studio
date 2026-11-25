import { describe, it, expect } from "vitest";
import { citationSegments } from "@/components/workspace/watbot/citationHighlight";

// Made-up text throughout: this repo is public.
const marked = (body: string, cited: string) => citationSegments(body, cited).filter((s) => s.mark).map((s) => s.text);

describe("citationSegments (WQF-A5)", () => {
  it("marks the first exact occurrence of a shorter cited span", () => {
    expect(citationSegments("A b. C d. C d.", "C d.")).toEqual([
      { text: "A b. ", math: false, mark: false },
      { text: "C d.", math: false, mark: true },
      { text: " C d.", math: false, mark: false },
    ]);
  });
  it("matches across runs of whitespace and marks the body's own characters", () => {
    expect(marked("Intro.\n\nEach  customer\nis served.", "  Each customer is   served.\n")).toEqual(["Each  customer\nis served."]);
  });
  it("marks nothing when the cited text is the whole body, missing, or empty", () => {
    expect(marked("Whole page.", "Whole page.")).toEqual([]);
    expect(marked(" Whole\npage. ", "Whole page.")).toEqual([]);
    expect(marked("Whole page.", "Other text.")).toEqual([]);
    expect(marked("Whole page.", "   ")).toEqual([]);
  });
  it("never marks a formula: only the text around it inside the range", () => {
    expect(citationSegments("Pre. A $$x_i$$ B. Post.", "A $$x_i$$ B.")).toEqual([
      { text: "Pre. ", math: false, mark: false },
      { text: "A ", math: false, mark: true },
      { text: "$$x_i$$", math: true, mark: false },
      { text: " B.", math: false, mark: true },
      { text: " Post.", math: false, mark: false },
    ]);
  });
  it("treats $\\cmd…$ inline math as a formula and a price as text", () => {
    expect(citationSegments("Pay $2 for $\\forall$ j. End.", "Pay $2 for $\\forall$ j.")).toEqual([
      { text: "Pay $2 for ", math: false, mark: true },
      { text: "$\\forall$", math: true, mark: false },
      { text: " j.", math: false, mark: true },
      { text: " End.", math: false, mark: false },
    ]);
  });
  it("keeps every character of the body, in order", () => {
    for (const [body, cited] of [["Pre. A $$x$$ B. Post.", "A $$x$$ B."], ["a\n\nb  c", "b c"], ["no math", "zzz"], ["$$x$$", "$$x$$"]]) {
      expect(citationSegments(body!, cited!).map((s) => s.text).join("")).toBe(body);
    }
  });
});
