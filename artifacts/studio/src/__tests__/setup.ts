import "@testing-library/jest-dom";

// Radix UI components (Slider, Select, etc.) use ResizeObserver — jsdom doesn't implement it.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Some Node versions (24+) ship an experimental global `localStorage` that
// is disabled unless `--localstorage-file` is passed; combined with
// vitest-environment-jsdom (which merges jsdom's `window` onto `globalThis`
// under some Node versions), `window.localStorage` can come back `undefined`
// in this test environment even though real browsers/plain jsdom provide it.
// Polyfill a minimal in-memory Storage only when it's genuinely missing, so
// tests that persist a preference (e.g. UnitContext's display-unit pref)
// can run consistently across Node versions.
if (typeof window !== "undefined" && !window.localStorage) {
  const store = new Map<string, string>();
  const storage: Storage = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
}
