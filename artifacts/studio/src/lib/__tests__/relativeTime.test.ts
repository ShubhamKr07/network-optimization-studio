import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "@/lib/relativeTime";

const base = Date.parse("2026-09-03T12:00:00Z");

describe("formatRelativeTime", () => {
  it("returns 'just now' under a minute", () => {
    expect(formatRelativeTime("2026-09-03T11:59:30Z", base)).toBe("just now");
  });
  it("minutes / hours / days", () => {
    expect(formatRelativeTime("2026-09-03T11:58:00Z", base)).toBe("2m ago");
    expect(formatRelativeTime("2026-09-03T09:00:00Z", base)).toBe("3h ago");
    expect(formatRelativeTime("2026-08-29T12:00:00Z", base)).toBe("5d ago");
  });
  it("clamps a future timestamp to 'just now'", () => {
    expect(formatRelativeTime("2026-09-03T12:05:00Z", base)).toBe("just now");
  });
});
