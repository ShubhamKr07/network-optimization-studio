import { describe, it, expect, vi } from "vitest";

// Spy-wrap (not stub) the two functions the new all-model `formatObjective`
// wrapper must route through — the real implementations still run (so the
// six-model correctness assertions below are genuine), but the calls are
// inspectable, proving the wrapper "holds no mapping of its own" per Part D.
vi.mock("@workspace/units", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/units")>();
  return {
    ...actual,
    objectiveDimension: vi.fn(actual.objectiveDimension),
    convertObjective: vi.fn(actual.convertObjective),
  };
});

import { objectiveDimension, convertObjective, type CanonicalUnit } from "@workspace/units";
import { formatChenObjective, objectiveModeOfDetails, formatObjective, scenarioObjectiveMode, formatMoney } from "@/lib/formatObjective";
import type { UnitApi } from "@/contexts/UnitContext";

// C4.14 (D14) — the single source of truth for Chen's two mode-dependent
// objective units, shared by ObjectiveBar, CostSummaryTab and Landing.
describe("formatChenObjective", () => {
  it("formats a coverage-mode objective as a percentage (NN.NN %)", () => {
    expect(formatChenObjective(66.6667, "coverage")).toBe("66.67 %");
  });

  it("formats a min_distance-mode objective as demand-mi (scientific)", () => {
    // CH4O-8 (§2.1) — Chapter 4 is miles-canonical, so this fallback label is
    // `demand-mi`. It is the UNRESOLVED-unit path (formatChenObjective takes no
    // canonical unit), which is exactly why the literal has to be kept correct
    // by hand -- nothing resolves it from the manifest here.
    expect(formatChenObjective(131645389, "min_distance")).toBe("1.32e+8 demand-mi");
  });

  it("returns null for a null/absent mode so callers apply their own default", () => {
    expect(formatChenObjective(29873735731, null)).toBeNull();
    expect(formatChenObjective(29873735731, undefined)).toBeNull();
  });

  it("returns null for an unrecognized mode string", () => {
    expect(formatChenObjective(5, "something-else")).toBeNull();
  });
});

describe("objectiveModeOfDetails", () => {
  it("reads the mode discriminator off an envelope details record", () => {
    expect(objectiveModeOfDetails({ objective: "coverage" })).toBe("coverage");
    expect(objectiveModeOfDetails({ objective: "min_distance" })).toBe("min_distance");
  });

  it("returns null when details is absent, empty, or non-string objective", () => {
    expect(objectiveModeOfDetails(undefined)).toBeNull();
    expect(objectiveModeOfDetails({})).toBeNull();
    expect(objectiveModeOfDetails({ objective: 5 })).toBeNull();
    expect(objectiveModeOfDetails(null)).toBeNull();
  });
});

// CH4O-2 — `scenarioObjectiveMode` reads a solved scenario's objective mode
// straight off its own envelope (`result.details`). No `steps` concept: a
// Chapter 4 result is current, or the scenario is `stale` by the ordinary
// staleness guard like every other model's.
describe("scenarioObjectiveMode", () => {
  it("reads the mode off result.details", () => {
    expect(scenarioObjectiveMode({ result: { details: { objective: "min_distance" } } })).toBe("min_distance");
    expect(scenarioObjectiveMode({ result: { details: { objective: "coverage" } } })).toBe("coverage");
  });

  it("returns null when result/details is absent", () => {
    expect(scenarioObjectiveMode({ result: null })).toBeNull();
    expect(scenarioObjectiveMode(null)).toBeNull();
    expect(scenarioObjectiveMode(undefined)).toBeNull();
  });
});

// T10 — the new all-model wrapper (spec Part D, decision 6). Requires
// `modelId` (unlike `formatChenObjective`, which infers Chen-ness from the
// mode discriminator alone) and covers all six models under both display
// units, routing dimension + numeric conversion through `@workspace/units`.
function stubUnitApi(effective: CanonicalUnit): UnitApi {
  return {
    pref: effective,
    setPref: () => {},
    effectiveUnit: () => effective,
    toDisplay: (v: number) => v,
    fromDisplay: (v: number) => v,
    format: (v: number, canonical: CanonicalUnit) => `${v} ${canonical}`,
  };
}

describe("formatObjective — seven-model contract", () => {
  const cases: Array<{
    modelId: string;
    mode: string | null;
    canonicalUnit: CanonicalUnit;
    objective: number;
    expectedDim: string;
    suffix: (u: CanonicalUnit) => string;
  }> = [
    {
      modelId: "p-median-us", mode: null, canonicalUnit: "mi", objective: 1000,
      expectedDim: "demand-distance", suffix: (u) => `demand-${u}`,
    },
    {
      modelId: "p-median-brazil", mode: null, canonicalUnit: "mi", objective: 1000,
      expectedDim: "demand-distance", suffix: (u) => `demand-${u}`,
    },
    {
      modelId: "transport-coal", mode: null, canonicalUnit: "mi", objective: 1000,
      expectedDim: "flow-distance", suffix: (u) => `${u}·units`,
    },
    {
      modelId: "two-echelon-gold-au", mode: null, canonicalUnit: "mi", objective: 1000,
      expectedDim: "truckload-distance", suffix: (u) => `truckload-${u}`,
    },
    {
      modelId: "two-echelon-jade-us", mode: null, canonicalUnit: "mi", objective: 123456.78,
      expectedDim: "monetary", suffix: () => "$",
    },
    {
      modelId: "max-coverage-us", mode: "coverage", canonicalUnit: "mi", objective: 66.6667,
      expectedDim: "percent", suffix: () => "%",
    },
    {
      modelId: "max-coverage-us", mode: "min_distance", canonicalUnit: "mi", objective: 1000,
      expectedDim: "demand-distance", suffix: (u) => `demand-${u}`,
    },
    {
      modelId: "delivery-teaching-us", mode: "base", canonicalUnit: "mi", objective: 1000,
      expectedDim: "demand-distance", suffix: (u) => `demand-${u}`,
    },
    {
      modelId: "delivery-teaching-us", mode: "cost_adjusted", canonicalUnit: "mi", objective: 123456.78,
      expectedDim: "monetary", suffix: () => "$",
    },
  ];

  for (const c of cases) {
    for (const target of ["km", "mi"] as const) {
      it(`${c.modelId}${c.mode ? ` (${c.mode})` : ""} renders the ${c.expectedDim} suffix under ${target}`, () => {
        const result = formatObjective(c.modelId, c.mode, c.objective, c.canonicalUnit, stubUnitApi(target));
        expect(result).toContain(c.suffix(target));
      });
    }
  }

  it("holds no mapping of its own: calls objectiveDimension(modelId, mode) and convertObjective(...) rather than re-deriving them", () => {
    vi.mocked(objectiveDimension).mockClear();
    vi.mocked(convertObjective).mockClear();

    formatObjective("p-median-us", null, 500, "mi", stubUnitApi("km"));

    expect(objectiveDimension).toHaveBeenCalledWith("p-median-us", null);
    expect(convertObjective).toHaveBeenCalledWith(500, "demand-distance", "mi", "km");
  });

  it("a monetary/percent dimension is never converted (convertObjective's own no-op is respected, not overridden)", () => {
    const monetary = formatObjective("two-echelon-jade-us", null, 100, "mi", stubUnitApi("km"));
    // $100, unconverted — a naive distance conversion would have scaled it.
    expect(monetary).toBe("$100");

    const percent = formatObjective("max-coverage-us", "coverage", 66.6667, "mi", stubUnitApi("km"));
    expect(percent).toBe("66.67 %");
  });

  it("converts a real distance objective at the exact factor (1000 mi canonical -> km display)", () => {
    const result = formatObjective("p-median-us", null, 1000, "mi", stubUnitApi("km"));
    // 1000 mi -> km via the REAL (spy-wrapped, not stubbed) convertObjective.
    expect(result).toContain("1,609.344");
    expect(result).toContain("demand-km");
  });
});

describe("formatMoney (DU-2.1)", () => {
  it("full: grouped whole dollars", () => {
    expect(formatMoney(169061531.4)).toBe("$169,061,531");
    expect(formatMoney(-1234.6)).toBe("-$1,235");
  });
  it("compact: B / M at 2 dp, K at 0 dp, small at 2 dp", () => {
    expect(formatMoney(1_234_000_000, { compact: true })).toBe("$1.23B");
    expect(formatMoney(169_061_531, { compact: true })).toBe("$169.06M");
    expect(formatMoney(842_400, { compact: true })).toBe("$842K");
    expect(formatMoney(842.5, { compact: true })).toBe("$842.50");
    expect(formatMoney(-6_300_000, { compact: true })).toBe("-$6.30M");
    // Tier on the rounded value: never "$1,000K" / "$1000.00M".
    expect(formatMoney(999_600, { compact: true })).toBe("$1.00M");
    expect(formatMoney(999_996_000, { compact: true })).toBe("$1.00B");
  });
  it("non-finite renders —", () => {
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.NEGATIVE_INFINITY, { compact: true })).toBe("—");
  });
  it("pins en-US even when the default locale is German", () => {
    // Same technique as formatDistanceDisplay.test.ts: an undefined locale resolves to de-DE,
    // so an unpinned toLocaleString() would print 169.061.531.
    const orig = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = function (this: number, loc?: string | string[], o?: Intl.NumberFormatOptions) {
      return orig.call(this, loc === undefined ? "de-DE" : loc, o);
    };
    try {
      expect(formatMoney(169061531)).toBe("$169,061,531");
      expect(formatMoney(842_400, { compact: true })).toBe("$842K");
      // formatObjective branches: monetary, demand-distance (suffixed), opaque.
      expect(formatObjective("two-echelon-jade-us", null, 169061531, "mi", stubUnitApi("mi"))).toBe("$169,061,531");
      expect(formatObjective("p-median-us", null, 1234567, "mi", stubUnitApi("mi"))).toBe("1,234,567 demand-mi");
      expect(formatObjective("no-such-model", null, 1234567, "mi", stubUnitApi("mi"))).toBe("1,234,567");
    } finally {
      Number.prototype.toLocaleString = orig;
    }
  });
});
