import { describe, expect, it } from "vitest";
import { cityCode, newUid, nextDisplayCode } from "../entityId";

describe("cityCode", () => {
  it("uppercases and strips non-letters", () => {
    expect(cityCode("Oklahoma City")).toBe("OKLAHOMACITY");
  });
});

describe("nextDisplayCode", () => {
  it("starts at 01 for a fresh city/state", () => {
    expect(nextDisplayCode("wh", "NV", "Reno", [])).toBe("WH-NV-RENO-01");
  });

  it("bumps sequence on collision", () => {
    expect(nextDisplayCode("wh", "TX", "Dallas", ["WH-TX-DALLAS-01"])).toBe(
      "WH-TX-DALLAS-02",
    );
  });

  it("keeps -01 when the caller excludes its own current code", () => {
    expect(nextDisplayCode("wh", "TX", "Dallas", [])).toBe("WH-TX-DALLAS-01");
  });

  it("bumps past a genuine other collision even when own code is excluded", () => {
    expect(nextDisplayCode("wh", "TX", "Dallas", ["WH-TX-DALLAS-01"])).toBe(
      "WH-TX-DALLAS-02",
    );
  });

  it("uses the CS prefix for customers", () => {
    expect(nextDisplayCode("cs", "OK", "Tulsa", [])).not.toBe("CS-OK-TULSA-04");
    expect(nextDisplayCode("cs", "OK", "Tulsa", [])).toBe("CS-OK-TULSA-01");
  });

  // T11 (Step A) — mines/stations join the same identity model.
  it("uses the MN prefix for mines", () => {
    expect(nextDisplayCode("mn", "KY", "Pikeville", [])).toBe("MN-KY-PIKEVILLE-01");
  });

  it("uses the ST prefix for stations", () => {
    expect(nextDisplayCode("st", "IL", "Chicago", [])).toBe("ST-IL-CHICAGO-01");
  });
});

describe("newUid", () => {
  it("returns distinct wh-prefixed strings on repeated calls", () => {
    const a = newUid("wh");
    const b = newUid("wh");
    expect(a).not.toBe(b);
    expect(a.startsWith("aw-")).toBe(true);
    expect(b.startsWith("aw-")).toBe(true);
  });

  it("returns ac-prefixed strings for customers", () => {
    expect(newUid("cs").startsWith("ac-")).toBe(true);
  });

  // T11 (Step A) — mines/stations join the same identity model, prefixes
  // matching the backend's mintAddedEntityUid convention exactly.
  it("returns am-prefixed strings for mines", () => {
    expect(newUid("mn").startsWith("am-")).toBe(true);
  });

  it("returns as-prefixed strings for stations", () => {
    expect(newUid("st").startsWith("as-")).toBe(true);
  });
});
