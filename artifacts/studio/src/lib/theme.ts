// DU-5.3 — master §A interface. Mirrors UnitContext's storage handling:
// every localStorage access is wrapped, and the app renders without storage.
// index.html carries a copy of applyTheme's logic so the class lands before
// first paint; theme.test.ts pins the shared storage key.
export type ThemePref = "light" | "dark" | "system";
const STORAGE_KEY = "nos:theme-pref";

export function getThemePref(): ThemePref {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

export function setThemePref(p: ThemePref): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, p);
  } catch {
    // not persisted (private mode, quota); this session still switches
  }
  applyTheme(p);
}

export function applyTheme(p: ThemePref): void {
  const dark = p === "dark" || (p === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
  document.documentElement.classList.toggle("dark", dark);
}
