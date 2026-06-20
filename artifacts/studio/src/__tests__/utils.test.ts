import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn (class merge utility)", () => {
  it("merges multiple class strings", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("deduplicates conflicting Tailwind classes (last wins)", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("ignores falsy values", () => {
    expect(cn("foo", false && "bar", undefined, null as unknown as string, "baz")).toBe("foo baz");
  });

  it("handles conditional class objects", () => {
    expect(cn({ "font-bold": true, "italic": false })).toBe("font-bold");
  });

  it("returns empty string when no valid classes given", () => {
    expect(cn()).toBe("");
  });

  it("merges padding variants correctly", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
