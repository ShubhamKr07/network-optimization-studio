import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getThemePref, setThemePref, applyTheme } from "@/lib/theme";

// vi.stubGlobal + unstubAllGlobals, the NetworkBackground.test.tsx:8-15,39
// pattern; a direct window.matchMedia assignment would leak across tests.
function mockSystemDark(dark: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: dark, addEventListener: vi.fn() }));
}
beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme preference (DU-5.3)", () => {
  it("defaults to system", () => expect(getThemePref()).toBe("system"));
  it("ignores an invalid stored value", () => { localStorage.setItem("nos:theme-pref", "purple"); expect(getThemePref()).toBe("system"); });
  it("round-trips a stored value", () => { mockSystemDark(false); setThemePref("dark"); expect(getThemePref()).toBe("dark"); });
  it("survives storage that throws on read and write", () => {
    mockSystemDark(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(getThemePref()).toBe("system");
    expect(() => setThemePref("dark")).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true); // applied even if not persisted
  });
  it("system follows prefers-color-scheme", () => {
    mockSystemDark(true); applyTheme("system"); expect(document.documentElement.classList.contains("dark")).toBe(true);
    mockSystemDark(false); applyTheme("system"); expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
  it("explicit light/dark override the OS", () => {
    mockSystemDark(true); applyTheme("light"); expect(document.documentElement.classList.contains("dark")).toBe(false);
    mockSystemDark(false); applyTheme("dark"); expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
  it("index.html's no-flash script uses the same storage key", () => {
    expect(readFileSync(resolve(__dirname, "../../../index.html"), "utf8")).toContain("nos:theme-pref");
  });
});
