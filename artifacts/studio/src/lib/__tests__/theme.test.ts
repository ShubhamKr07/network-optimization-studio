import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// theme.ts keeps the in-session pref in module state: re-import fresh per test.
let getThemePref: typeof import("@/lib/theme").getThemePref;
let setThemePref: typeof import("@/lib/theme").setThemePref;
let applyTheme: typeof import("@/lib/theme").applyTheme;

// vi.stubGlobal + unstubAllGlobals, the NetworkBackground.test.tsx:8-15,39
// pattern; a direct window.matchMedia assignment would leak across tests.
function mockSystemDark(dark: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: dark, addEventListener: vi.fn() }));
}
beforeEach(async () => {
  vi.resetModules();
  ({ getThemePref, setThemePref, applyTheme } = await import("@/lib/theme"));
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

describe("storage-blocked session (DU-5.R1)", () => {
  // `current` is module state: re-import fresh per case so tests stay independent.
  async function blocked() {
    vi.resetModules();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    return await import("@/lib/theme");
  }
  it("getThemePref returns the in-session choice", async () => {
    mockSystemDark(false);
    const t = await blocked();
    expect(t.getThemePref()).toBe("system");
    t.setThemePref("dark");
    expect(t.getThemePref()).toBe("dark");
  });
  it("an OS theme change (main.tsx's guard) does not undo it", async () => {
    mockSystemDark(false);
    const t = await blocked();
    t.setThemePref("dark");
    mockSystemDark(false); // OS flips; listener body: if (getThemePref() === "system") applyTheme("system")
    if (t.getThemePref() === "system") t.applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

