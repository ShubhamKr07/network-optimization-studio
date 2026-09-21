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
import { formatChenObjective, objectiveModeOfDetails, formatObjective } from "@/lib/formatObjective";
import type { UnitApi } from "@/contexts/UnitContext";

// C4.14 (D14) — the single source of truth for Chen's two mode-dependent
// objective units, shared by ObjectiveBar, CostSummaryTab and Landing.
describe("formatChenObjective", () => {
  it("formats a coverage-mode objective as a percentage (NN.NN %)", () => {
    expect(formatChenObjective(66.6667, "coverage")).toBe("66.67 %");
  });

  it("formats a min_distance-mode objective as demand-km (scientific)", () => {
    expect(formatChenObjective(131645389, "min_distance")).toBe("1.32e+8 demand-km");
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

describe("formatObjective — six-model contract", () => {
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
      modelId: "chens-cosmetics-cn", mode: "coverage", canonicalUnit: "km", objective: 66.6667,
      expectedDim: "percent", suffix: () => "%",
    },
    {
      modelId: "chens-cosmetics-cn", mode: "min_distance", canonicalUnit: "km", objective: 1000,
      expectedDim: "demand-distance", suffix: (u) => `demand-${u}`,
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
    expect(monetary).toBe("$100.00");

    const percent = formatObjective("chens-cosmetics-cn", "coverage", 66.6667, "km", stubUnitApi("mi"));
    expect(percent).toBe("66.67 %");
  });

  it("converts a real distance objective at the exact factor (1000 mi canonical -> km display)", () => {
    const result = formatObjective("p-median-us", null, 1000, "mi", stubUnitApi("km"));
    // 1000 mi -> km via the REAL (spy-wrapped, not stubbed) convertObjective.
    expect(result).toContain("1,609.344");
    expect(result).toContain("demand-km");
  });
});
