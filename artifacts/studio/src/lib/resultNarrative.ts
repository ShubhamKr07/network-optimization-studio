import type { Edge, SolveResult } from "@workspace/api-client-react";
import { bandDecimals, computeExclusiveBandCoverage, serviceEdgesFor } from "@/lib/bands";
import { classifyResultOutcome, hasIncumbent } from "@/lib/resultOutcome";

// NAR-1 (spec 2026-10-17-output-narrative-rewrite-design.md) — the Output
// Map's plain-language reading of the DISPLAYED result: 2-4 sentences, every
// number read from the same envelope field Service Stats / Solution Summary
// use. A missing required field yields NO narrative (never an invented one).

export interface NarrativeDistance {
  /** canonical -> display-unit number */
  toDisplay: (canonical: number) => number;
  /** display unit label, e.g. "mi" */
  unit: string;
}

export interface NarrativeContext {
  /** The band lens the map colours with (OutputMapTab's effectiveBands). */
  bands: number[];
  /** null while the model's canonical unit is unresolved -> no narrative. */
  distance: NarrativeDistance | null;
  /** canonical entity id -> "City, ST". An id with no entry is shown raw. */
  nameById?: Record<string, string>;
  /** An earlier result of the same scenario (result history), for the "vs your previous run" parenthetical. */
  previous?: SolveResult | null;
}

export interface ResultNarrative {
  text: string;
}

// jade-T15.6 — derives a human-readable lane label from a leg string value
// itself (e.g. "plant_to_warehouse" -> "Plant → Warehouse"), never from a
// modelId/leg-string allowlist. Shared with OutputMapTab's leg toggles.
export function legLabel(leg: string): string {
  const parts = leg.split("_to_");
  const cap = (s: string) => (s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  if (parts.length === 2) return `${cap(parts[0])} → ${cap(parts[1])}`;
  return cap(leg);
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);
const grouped = (n: number) => n.toLocaleString("en-US");

function stringIds(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(v => typeof v === "string") ? (value as string[]) : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** "A", "A and B", "A, B and C" (names already contain commas: "Dallas, TX"). */
function list(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** $182.0M; under $1M -> $812K. */
function money(v: number): string {
  return Math.abs(v) >= 999_500 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`;
}

function farthestEdge(edges: Edge[]): Edge | null {
  let far: Edge | null = null;
  for (const e of edges) if (far == null || e.distance > far.distance) far = e;
  return far;
}

function failureText(result: SolveResult): string {
  const outcome = classifyResultOutcome(result);
  if (outcome === "infeasible") {
    const reason = result.infeasibilityReason?.trim().replace(/\.$/, "");
    // Known solve.py single-source capacity message (solve.py:744-752) -> own sentence; anything else is quoted verbatim.
    const cap = reason?.match(/^Demand regions? (.+?) exceed the single-warehouse capacity \(([\d.]+M)\)/);
    const parts = cap ? [...cap[1].matchAll(/(?:^|, )(.+?) \(([\d.]+M)\)/g)] : [];
    if (cap && parts.length > 0) {
      const needs = list(parts.map(m => `${m[1].replace(/ Region$/, "")} needs ${m[2]} units`));
      return `No plan meets these settings: ${needs}, more than any single warehouse can supply (${cap[2]}). Turn Single-source off so ${parts.length === 1 ? "its" : "their"} demand can be split between warehouses.`;
    }
    return reason ? `No plan meets these settings: ${reason}.` : "No plan meets these settings.";
  }
  if (result.terminationReason === "time_limit") return "The solver stopped at its time limit before finding a plan.";
  return "The solver could not find a plan for these settings.";
}

const MODELS = new Set([
  "p-median-us", "p-median-brazil", "transport-coal", "max-coverage-us",
  "delivery-teaching-us", "two-echelon-gold-au", "two-echelon-jade-us",
]);

export function buildResultNarrative(modelId: string, result: SolveResult, ctx: NarrativeContext): ResultNarrative | null {
  if (!MODELS.has(modelId)) return null;
  if (!hasIncumbent(classifyResultOutcome(result))) return { text: failureText(result) };
  const d = ctx.distance;
  if (!d) return null;

  const details = (result.details ?? {}) as Record<string, unknown>;
  const metrics = result.metrics;
  const proven = classifyResultOutcome(result) === "optimal";
  // Only claim a time limit when the solver actually reported one.
  const bestPlan = result.terminationReason === "time_limit" ? "the best plan found before the time limit" : "the best plan the solver found";
  const bestCoverage = result.terminationReason === "time_limit" ? "the best coverage found before the time limit" : "the best coverage the solver found";
  const name = (id: string) => ctx.nameById?.[id] || id;
  const unitWord = d.unit === "mi" ? "miles" : d.unit;
  const num = (canonical: number) => grouped(Math.round(d.toDisplay(canonical)));
  const dist = (canonical: number) => `${num(canonical)} ${unitWord}`;

  // "(41 miles shorter than your previous run)" — only against an earlier
  // incumbent of the same objective; nothing when the displayed values match.
  const prev = ctx.previous && hasIncumbent(classifyResultOutcome(ctx.previous)) &&
    (ctx.previous.details as Record<string, unknown> | undefined)?.objective === details.objective
    ? ctx.previous : null;
  const distVsPrev = (cur: number, before: number | null | undefined): string => {
    if (before == null) return "";
    const diff = Math.round(d.toDisplay(cur)) - Math.round(d.toDisplay(before));
    if (diff === 0) return "";
    const unit = Math.abs(diff) === 1 && unitWord === "miles" ? "mile" : unitWord;
    return ` (${grouped(Math.abs(diff))} ${unit} ${diff < 0 ? "shorter" : "longer"} than your previous run)`;
  };

  // The distance band holding the largest share of flow, from the SAME
  // exclusive rows Service Stats shows; ties go to the lowest band.
  const largestBand = (edges: Edge[]): { pct: string; range: string } | null => {
    if (edges.length === 0) return null;
    const rows = computeExclusiveBandCoverage(edges, ctx.bands, bandDecimals(modelId));
    if (rows.length === 0) return null;
    let best = 0;
    rows.forEach((r, i) => { if (r.percent > rows[best].percent) best = i; });
    if (rows[best].percent === 0) return null;
    const sorted = [...ctx.bands].sort((a, b) => a - b);
    const range =
      best === rows.length - 1 ? `more than ${dist(sorted[sorted.length - 1])}`
        : best === 0 ? `within ${dist(sorted[0])}`
          : `${num(sorted[best - 1])}–${dist(sorted[best])}`;
    return { pct: `${rows[best].percent.toFixed(bandDecimals(modelId))}%`, range };
  };
  const away = (range: string) => (range.startsWith("within") ? range : `${range} away`);

  const openIds = stringIds(details.openWarehouseIds) ?? stringIds(metrics.openFacilityIds);
  if (!openIds) return null;
  const open = openIds.map(name);
  const n = openIds.length;
  const sites = n === 1 ? "this site gives" : `these ${word(n)} sites give`;
  const anyN = n === 1 ? "any single site" : `any ${word(n)}`;
  const service = serviceEdgesFor(result.edges);
  const far = farthestEdge(service);
  const avg = finite(metrics.weightedAvgDistance);
  const text = (...s: (string | null)[]) => ({ text: s.filter(Boolean).join(" ") });

  if (modelId === "transport-coal") {
    // details.openWarehouseIds holds MINES here (solve.py:687).
    const used = openIds.filter(id => result.edges.some(e => e.fromId === id));
    const total = metrics.utilizationByNode?.length ?? used.length;
    const full = used.every(id => (metrics.utilizationByNode ?? []).find(u => u.warehouseId === id)?.utilization === 100);
    const stations = new Set(result.edges.map(e => e.toId)).size;
    const longest = farthestEdge(result.edges);
    const band = largestBand(result.edges);
    if (avg == null || !longest || !band || used.length === 0) return null;
    const mines = used.length === total ? `all ${word(total)} mines` : `${used.length} of ${total} mines`;
    return text(
      `Coal ships from ${mines}, ${list(used.map(name))}${full ? ", each at full capacity," : ","} to ${stations} power ${stations === 1 ? "station" : "stations"}.`,
      `A typical ton travels about ${dist(avg)}${distVsPrev(avg, finite(prev?.metrics.weightedAvgDistance))}${proven ? `, the fewest total ton-${unitWord} that meet every station's demand` : `, ${bestPlan}`}.`,
      `The largest share of the coal, ${band.pct}, moves ${band.range}, and the longest lane, ${name(longest.fromId)} to ${name(longest.toId)}, is ${dist(longest.distance)}.`,
    );
  }

  if (modelId === "two-echelon-gold-au") {
    const legs = metrics.avgDistanceByLeg ?? [];
    const inLeg = legs.find(l => l.leg.endsWith("_to_refinery"));
    const outLeg = legs.find(l => l.leg.endsWith("_to_customer"));
    const mines = [...new Set(result.edges.filter(e => e.leg === inLeg?.leg).map(e => e.fromId))];
    const closed = (metrics.utilizationByNode ?? []).filter(u => !openIds.includes(u.warehouseId));
    const band = largestBand(service);
    if (!inLeg || !outLeg || mines.length === 0 || !band || !far) return null;
    const closedText = closed.length > 0 ? `; ${list(closed.map(u => name(u.warehouseId) !== u.warehouseId ? name(u.warehouseId) : u.city))} ${closed.length === 1 ? "stays" : "stay"} closed` : "";
    return text(
      `Refine at ${list(open)}${closedText}.`,
      `Ore travels about ${dist(inLeg.avgDistance)} from the ${list(mines.map(name))} ${mines.length === 1 ? "mine" : "mines"} to the ${n === 1 ? "refinery" : "refineries"}, and gold about ${dist(outLeg.avgDistance)} on to customers${proven ? `, the fewest truckload-${unitWord} possible` : `, ${bestPlan}`}.`,
      `The largest share of your demand, ${band.pct}, is ${away(band.range)}, and the farthest customer, ${name(far.toId)}, is ${dist(far.distance)} away.`,
    );
  }

  if (modelId === "two-echelon-jade-us") {
    const outLeg = (metrics.avgDistanceByLeg ?? []).find(l => l.leg.endsWith("_to_customer"));
    const inbound = finite(metrics.inboundCost);
    const outbound = finite(metrics.outboundCost);
    const demand = finite(metrics.totalDemand);
    const band = largestBand(service);
    if (!outLeg || inbound == null || outbound == null || !demand || !band || !far) return null;
    const before = finite(prev?.objective);
    const delta = before == null ? "" : money(Math.abs(result.objective - before));
    const vs = before == null || result.objective === before || delta === "$0K" ? ""
      : ` (${delta} ${result.objective < before ? "less" : "more"} than your previous run)`;
    return text(
      `Open ${list(open)}.`,
      `The total transportation cost is ${money(result.objective)}${vs}, about $${grouped(Math.round(result.objective / demand))} per ton${proven ? `, the lowest possible with ${word(n)} warehouses` : `, ${bestPlan}`}.`,
      `Roughly ${money(inbound)} of that is plant-to-warehouse and ${money(outbound)} is warehouse-to-customer.`,
      `Outbound, customers are ${dist(outLeg.avgDistance)} from their warehouse on average, the largest share (${band.pct}) is ${away(band.range)}, and the farthest, ${name(far.toId)}, is ${dist(far.distance)} away.`,
    );
  }

  // p-median-us / p-median-brazil / max-coverage-us / delivery-teaching-us.
  if (avg == null || !far) return null;
  // Brazil's live identity renders a region as "Acre Region, AC"; students see just "Acre".
  const farName = modelId === "p-median-brazil" ? name(far.toId).replace(/, [A-Z]{2}$/, "").replace(/ Region$/, "") : name(far.toId);
  const farthest = `the farthest ${modelId === "p-median-brazil" ? "region" : "customer"}, ${farName}, is ${dist(far.distance)} away.`;
  const typical = (what: string) => `${what} about ${dist(avg)}`;

  if (modelId === "max-coverage-us" && details.objective === "coverage") {
    const pct = finite(details.coveragePct);
    const highService = finite(details.highServiceDistMi);
    if (pct == null || highService == null) return null;
    const before = finite(prev?.details && (prev.details as Record<string, unknown>).coveragePct);
    const sameDist = finite((prev?.details as Record<string, unknown> | undefined)?.highServiceDistMi) === highService;
    const diff = before == null || !sameDist ? 0 : Math.round(pct) - Math.round(before);
    const vs = diff === 0 ? "" : ` (${Math.abs(diff)} ${Math.abs(diff) === 1 ? "point" : "points"} ${diff > 0 ? "more" : "less"} than your previous run)`;
    return text(
      `Open ${list(open)}.`,
      `${n === 1 ? "This site puts" : `These ${word(n)} sites put`} ${Math.round(pct)}%${vs} of your demand within ${dist(highService)}${proven ? `, the most ${anyN}${n === 1 ? "" : " sites"} can cover` : `, ${bestCoverage}`}.`,
      `${typical("A typical unit ships")}, and ${farthest}`,
    );
  }

  const band = largestBand(service);
  if (!band) return null;
  const bandText = `The largest share of your demand, ${band.pct}, is ${away(band.range)}, and ${farthest}`;
  const vs = distVsPrev(avg, finite(prev?.metrics.weightedAvgDistance));

  if (modelId === "p-median-brazil") {
    return text(
      `Open ${word(n)} ${n === 1 ? "warehouse" : "warehouses"}: ${list(open)}.`,
      `${typical("A typical unit ships")}${vs}${proven ? `, the shortest overall shipping distance of ${anyN}` : `, ${bestPlan}`}.`,
      bandText,
    );
  }
  if (modelId === "delivery-teaching-us") {
    const claim = details.objective === "cost_adjusted" ? "the lowest overall delivery cost" : "the shortest overall delivery distance";
    return text(
      `Open ${list(open)}.`,
      `${typical("A typical delivery travels")}${vs}, and ${proven ? `${sites} ${claim} of ${anyN}` : `this is ${bestPlan}`}.`,
      bandText,
    );
  }
  // p-median-us and Ch 4 min-distance.
  return text(
    `Open ${list(open)}.`,
    `${typical("A typical unit ships")}${vs} from the warehouse to the customer, and ${proven ? `${sites} the shortest overall shipping distance of ${anyN}` : `this is ${bestPlan}`}.`,
    bandText,
  );
}
