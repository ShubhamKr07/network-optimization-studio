import { describe, it, expect } from "vitest";
import { escapeHtml } from "@/lib/escapeHtml";

describe("escapeHtml", () => {
  it("escapes tags and attribute-breaking characters", () => {
    expect(escapeHtml("<img onerror=x>")).toBe("&lt;img onerror=x&gt;");
    expect(escapeHtml(`"&'`)).toBe("&quot;&amp;&#39;");
  });
  it("leaves plain text untouched", () => {
    expect(escapeHtml("Kansas City, MO")).toBe("Kansas City, MO");
  });
});
