// NAR-1 — one case per model/objective, built from REAL local solve envelopes
// (fixtures/narrative/*.json, default inputs; `details.assignments` stripped,
// nothing the narrative reads) with city/state names read from the same
// solvers/<model>/dataset files the API serves.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import type { SolveResult } from "@workspace/api-client-react";
import { buildResultNarrative } from "@/lib/resultNarrative";

const fixture = (name: string): SolveResult =>
  JSON.parse(readFileSync(path.join(__dirname, "fixtures/narrative", `${name}.json`), "utf8")).result;
const bandsOf = (name: string): number[] =>
  JSON.parse(readFileSync(path.join(__dirname, "fixtures/narrative", `${name}.json`), "utf8")).inputs.distanceBands;

// id -> "City, ST" from every entity file of the model's dataset. Brazil's
// regions carry only `name` ("Acre Region"), shown as the bare region name.
function namesFor(solver: string): Record<string, string> {
  const dir = path.join(__dirname, "../../../../solvers", solver, "dataset");
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    if (/^(distances|costs|version|products|plant_product_capability)\.json$/.test(f)) continue;
    for (const row of Object.values(JSON.parse(readFileSync(path.join(dir, f), "utf8"))) as Array<Record<string, string>>) {
      if (!row.id) continue;
      out[row.id] = row.city ? (row.state ? `${row.city}, ${row.state}` : row.city) : row.name.replace(/ Region$/, "");
    }
  }
  return out;
}

const MI = { toDisplay: (v: number) => v, unit: "mi" };
const KM = { toDisplay: (v: number) => v * 1.609344, unit: "km" };
const run = (model: string, solver: string, name: string, extra: Record<string, unknown> = {}) =>
  buildResultNarrative(model, fixture(name), { bands: bandsOf(name), distance: MI, nameById: namesFor(solver), ...extra })?.text;

describe("buildResultNarrative — approved wording per model/objective (real envelopes)", () => {
  it("Ch 3 p-median-us", () => {
    expect(run("p-median-us", "p-median-us", "p-median-us")).toBe(
      "Open Baltimore, MD, Dallas, TX and Los Angeles, CA. A typical unit ships about 383 miles from the warehouse to the customer, and these three sites give the shortest overall shipping distance of any three. The largest share of your demand, 35%, is 400–800 miles away, and the farthest customer, Seattle, WA, is 1,139 miles away.",
    );
  });

  it("Ch 4 coverage keeps its objective sentence and has no band sentence", () => {
    expect(run("max-coverage-us", "max-coverage-us", "max-coverage-us-coverage")).toBe(
      "Open Dallas, TX, Los Angeles, CA and Pittsburgh, PA. These three sites put 70% of your demand within 450 miles, the most any three sites can cover. A typical unit ships about 395 miles, and the farthest customer, Miami, FL, is 1,197 miles away.",
    );
  });

  it("Ch 4 min-distance uses the Ch 3 template (largest band is the first: 'within')", () => {
    expect(run("max-coverage-us", "max-coverage-us", "max-coverage-us-min_distance")).toBe(
      "Open Baltimore, MD, Dallas, TX and Los Angeles, CA. A typical unit ships about 383 miles from the warehouse to the customer, and these three sites give the shortest overall shipping distance of any three. The largest share of your demand, 67%, is within 450 miles, and the farthest customer, Seattle, WA, is 1,139 miles away.",
    );
  });

  it("Ch 5 transport-coal", () => {
    expect(run("transport-coal", "transport-coal", "transport-coal")).toBe(
      "Coal ships from all four mines, Pikeville, KY, Rock Springs, WY, Clarion, PA and Council Bluffs, IA, each at full capacity, to 15 power stations. A typical ton travels about 562 miles, the fewest total ton-miles that meet every station's demand. The largest share of the coal, 54%, moves within 500 miles, and the longest lane, Council Bluffs, IA to Phoenix, AZ, is 1,304 miles.",
    );
  });

  it("Ch 5 Brazil (feasible variant: Single-source off)", () => {
    expect(run("p-median-brazil", "p-median-brazil", "p-median-brazil-VARIANT-singleSource-false")).toBe(
      "Open seven warehouses: Belém, PA, Betim, MG, Juiz de Fora, MG, Ponta Grossa, PR, Recife, PE, Salvador, BA and Santos, SP. A typical unit ships about 184 miles, the shortest overall shipping distance of any seven. The largest share of your demand, 94%, is within 500 miles, and the farthest region, Acre, is 1,699 miles away.",
    );
  });

  it("Ch 5 Brazil infeasible (default inputs) gives the plain reason, no status code", () => {
    expect(run("p-median-brazil", "p-median-brazil", "p-median-brazil")).toBe(
      "No plan meets these settings: Demand region São Paulo Region (29M) exceed the single-warehouse capacity (20M). Under single-sourcing each region must be served by exactly one warehouse, but no warehouse can absorb this much demand. Solution: toggle Single-source OFF to allow demand to split across warehouses.",
    );
  });

  it("Ch 5 delivery: band share at 2 dp", () => {
    expect(run("delivery-teaching-us", "delivery-teaching-us", "delivery-teaching-us")).toBe(
      "Open Los Angeles, CA, New York City, NY and Louisville, KY. A typical delivery travels about 423 miles, and these three sites give the shortest overall delivery distance of any three. The largest share of your demand, 59.38%, is within 400 miles, and the farthest customer, McAllen, TX, is 1,301 miles away.",
    );
  });

  it("Ch 5 delivery cost_adjusted names the cost objective", () => {
    const r = fixture("delivery-teaching-us");
    const adjusted = { ...r, details: { ...r.details, objective: "cost_adjusted" } } as SolveResult;
    const t = buildResultNarrative("delivery-teaching-us", adjusted, { bands: bandsOf("delivery-teaching-us"), distance: MI, nameById: namesFor("delivery-teaching-us") })!.text;
    expect(t).toContain("give the lowest overall delivery cost of any three.");
  });

  it("Ch 9 JADE: outbound leg only, $M costs, per-ton", () => {
    expect(run("two-echelon-jade-us", "two-echelon-jade-us", "two-echelon-jade-us")).toBe(
      "Open Baltimore, MD, Las Vegas, NV and Louisville, KY. The total transportation cost is $182.0M, about $118 per ton, the lowest possible with three warehouses. Roughly $101.5M of that is plant-to-warehouse and $80.5M is warehouse-to-customer. Outbound, customers are 431 miles from their warehouse on average, the largest share (48%) is 200–400 miles away, and the farthest, McAllen, TX, is 1,301 miles away.",
    );
  });

  it("Ch 10 gold-au", () => {
    expect(run("two-echelon-gold-au", "two-echelon-gold-au", "two-echelon-gold-au")).toBe(
      "Refine at Cunnamulla, QLD; Daggar Hills, WA stays closed. Ore travels about 1,465 miles from the Kalgoorlie, WA mine to the refinery, and gold about 688 miles on to customers, the fewest truckload-miles possible. The largest share of your demand, 100%, is 500–1,000 miles away, and the farthest customer, Cairns, QLD, is 909 miles away.",
    );
  });
});

describe("buildResultNarrative — rules", () => {
  const pm = () => fixture("p-median-us");
  const ctx = { bands: bandsOf("p-median-us"), distance: MI, nameById: namesFor("p-median-us") };

  it("km display unit says km and converts every distance and band edge", () => {
    const t = buildResultNarrative("p-median-us", pm(), { ...ctx, distance: KM })!.text;
    expect(t).toContain("about 616 km from the warehouse");
    expect(t).toContain("is 644–1,287 km away");
    expect(t).toContain("is 1,833 km away");
    expect(t).not.toMatch(/miles/);
  });

  it("an unresolved unit yields no narrative for a solved result", () => {
    expect(buildResultNarrative("p-median-us", pm(), { ...ctx, distance: null })).toBeNull();
  });

  it("a tie between bands goes to the lowest band", () => {
    const tied = { ...pm(), edges: [
      { fromId: "BAL", toId: "C1", flow: 100, distance: 300 },
      { fromId: "BAL", toId: "C2", flow: 100, distance: 600 },
    ] } as SolveResult;
    expect(buildResultNarrative("p-median-us", tied, ctx)!.text).toContain("The largest share of your demand, 50%, is 200–400 miles away");
  });

  it("an overflow band that holds the most is phrased 'more than X'", () => {
    const far = { ...pm(), edges: [
      { fromId: "BAL", toId: "C1", flow: 100, distance: 100 },
      { fromId: "BAL", toId: "C2", flow: 300, distance: 2000 },
    ] } as SolveResult;
    expect(buildResultNarrative("p-median-us", far, ctx)!.text).toContain("The largest share of your demand, 75%, is more than 1,600 miles away, and the farthest customer, Albuquerque, NM, is 2,000 miles away");
  });

  it("a no-incumbent time-limit run is plain, with no status code", () => {
    const t = { ...pm(), solutionStatus: "no_solution", status: "no_solution", terminationReason: "time_limit", edges: [], objective: 0 } as unknown as SolveResult;
    expect(buildResultNarrative("p-median-us", t, ctx)!.text).toBe("The solver stopped at its time limit before finding a plan.");
  });

  it("an ambiguous no-incumbent run says no plan was found", () => {
    const t = { ...pm(), solutionStatus: "no_solution", status: "no_solution", terminationReason: "unknown", edges: [], objective: 0 } as unknown as SolveResult;
    expect(buildResultNarrative("p-median-us", t, ctx)!.text).toBe("The solver could not find a plan for these settings.");
  });

  it("a feasible-but-unproven run never claims 'shortest of any'", () => {
    const f = { ...pm(), solutionStatus: "feasible", terminationReason: "time_limit" } as SolveResult;
    const t = buildResultNarrative("p-median-us", f, ctx)!.text;
    expect(t).toContain("this is the best plan found before the time limit.");
    expect(t).not.toContain("shortest overall");
  });

  it("missing open-site ids -> no narrative (never invented)", () => {
    const r = { ...pm(), details: {}, metrics: { ...pm().metrics, openFacilityIds: undefined } } as SolveResult;
    expect(buildResultNarrative("p-median-us", r, ctx)).toBeNull();
  });

  it("an unknown model with a solved result returns null", () => {
    expect(buildResultNarrative("mystery", pm(), ctx)).toBeNull();
  });
});

describe("buildResultNarrative — compare to previous run", () => {
  const ctx = { bands: bandsOf("p-median-us"), distance: MI, nameById: namesFor("p-median-us") };
  const withAvg = (avg: number) => ({ ...fixture("p-median-us"), metrics: { ...fixture("p-median-us").metrics, weightedAvgDistance: avg } }) as SolveResult;

  it("p-median: miles shorter", () => {
    const t = buildResultNarrative("p-median-us", fixture("p-median-us"), { ...ctx, previous: withAvg(424.4) })!.text;
    expect(t).toContain("about 383 miles (41 miles shorter than your previous run) from the warehouse");
  });

  it("p-median: longer, and nothing when equal", () => {
    expect(buildResultNarrative("p-median-us", fixture("p-median-us"), { ...ctx, previous: withAvg(300) })!.text).toContain("(83 miles longer than your previous run)");
    expect(buildResultNarrative("p-median-us", fixture("p-median-us"), { ...ctx, previous: withAvg(383) })!.text).not.toContain("previous run");
  });

  it("Ch 4 coverage: points; a different-objective previous run is ignored", () => {
    const cov = fixture("max-coverage-us-coverage");
    const prevCov = { ...cov, details: { ...cov.details, coveragePct: 67.09 } } as SolveResult;
    const c = { bands: bandsOf("max-coverage-us-coverage"), distance: MI, nameById: namesFor("max-coverage-us") };
    expect(buildResultNarrative("max-coverage-us", cov, { ...c, previous: prevCov })!.text).toContain("put 70% (3 points more than your previous run) of your demand within 450 miles");
    expect(buildResultNarrative("max-coverage-us", cov, { ...c, previous: fixture("max-coverage-us-min_distance") })!.text).not.toContain("previous run");
  });

  it("JADE: money delta", () => {
    const j = fixture("two-echelon-jade-us");
    const c = { bands: bandsOf("two-echelon-jade-us"), distance: MI, nameById: namesFor("two-echelon-jade-us") };
    const t = buildResultNarrative("two-echelon-jade-us", j, { ...c, previous: { ...j, objective: j.objective + 6.3e6 } as SolveResult })!.text;
    expect(t).toContain("is $182.0M ($6.3M less than your previous run), about $118 per ton");
  });
});
