import type { Edge, SolveResult } from "@workspace/api-client-react";
import { bandDecimals, computeExclusiveBandCoverage, exclusiveBandLabels, serviceEdgesFor } from "@/lib/bands";
import { classifyResultOutcome, hasIncumbent, resultQualityText } from "@/lib/resultOutcome";

// SCU-1.9 (spec B1.1) — the Output Map's plain-language reading of the
// DISPLAYED result. One adapter per model family reads that family's real
// envelope fields (solve.py refs in the plan's grounding table); a missing
// field drops its sentence, it is never invented. Band coverage is the
// EXCLUSIVE lens (SCU-1.1) over the same bands the map colours with.

type Family = "pmedian" | "transport" | "maxCoverage" | "delivery" | "twoEchelon";

const FAMILY_BY_MODEL: Record<string, Family> = {
  "p-median-us": "pmedian",
  "p-median-brazil": "pmedian",
  "transport-coal": "transport",
  "max-coverage-us": "maxCoverage",
  "delivery-teaching-us": "delivery",
  "two-echelon-gold-au": "twoEchelon",
  "two-echelon-jade-us": "twoEchelon",
};

const WAREHOUSE_MAP_GUIDE =
  "Triangles are warehouses and circles are customers. Each line joins a customer to the warehouse that serves it and is coloured by its distance band; the legend shows which colour is which band. Untick “Color lanes: Distance band” to draw every lane in one colour, or use the Warehouses, Customers and Lanes checkboxes to hide a layer.";

// Fixed per-model "How to read this map" text (spec B1.1, second paragraph).
const HOW_TO_READ: Record<string, string> = {
  "p-median-us": WAREHOUSE_MAP_GUIDE,
  "p-median-brazil": WAREHOUSE_MAP_GUIDE,
  "max-coverage-us": WAREHOUSE_MAP_GUIDE,
  "delivery-teaching-us": WAREHOUSE_MAP_GUIDE,
  "transport-coal":
    "Triangles are mines and circles are power stations. Each line is a coal shipment from a mine to a station, coloured by its distance band; the legend shows which colour is which band. Use the checkboxes above the map to hide a layer or to draw every lane in one colour.",
  "two-echelon-gold-au":
    "The star is the mine, triangles are refineries and circles are customers. Lanes run mine → refinery and refinery → customer; use the leg checkboxes above the map to show one leg at a time. Lanes are coloured by distance band (see the legend); untick “Color lanes: Distance band” to colour them by leg instead.",
  "two-echelon-jade-us":
    "Squares are plants, triangles are warehouses and circles are customers. Lanes run plant → warehouse and warehouse → customer; use the leg checkboxes above the map to show one leg at a time. Lanes are coloured by distance band (see the legend); untick “Color lanes: Distance band” to colour them by leg instead.",
};

export interface NarrativeDistance {
  /** canonical -> display-unit number */
  toDisplay: (canonical: number) => number;
  /** display unit label, e.g. "mi" */
  unit: string;
}

export interface NarrativeContext {
  /** The band lens the map colours with (OutputMapTab's effectiveBands). */
  bands: number[];
  /** null while the model's canonical unit is unresolved -> no distance sentences. */
  distance: NarrativeDistance | null;
  /** The overlay's timing.totalSec, when the caller has it. */
  solveTimeSec?: number;
  displayIdById?: Record<string, string>;
}

export interface ResultNarrative {
  summary: string[];
  howToRead: string;
}

// jade-T15.6 — derives a human-readable lane label from a leg string value
// itself (e.g. "plant_to_warehouse" -> "Plant → Warehouse"), never from a
// modelId/leg-string allowlist. Moved here from OutputMapTab.tsx (SCU-1.9)
// so the narrative and the leg toggles share one copy.
export function legLabel(leg: string): string {
  const parts = leg.split("_to_");
  const cap = (s: string) => (s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  if (parts.length === 2) return `${cap(parts[0])} → ${cap(parts[1])}`;
  return cap(leg);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function stringIds(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(v => typeof v === "string") ? (value as string[]) : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Same format as the metric overlay's showDistance (OutputMapTab.tsx:203-206). */
function formatDistance(canonical: number, d: NarrativeDistance): string {
  return `${d.toDisplay(canonical).toFixed(1)} ${d.unit}`;
}

function distinctLegs(edges: Edge[]): string[] {
  return [...new Set(edges.flatMap(e => (e.leg != null ? [e.leg] : [])))];
}

function bandSentence(prefix: string, edges: Edge[], bands: number[], decimals: number, d: NarrativeDistance): string | null {
  if (edges.length === 0) return null;
  const rows = computeExclusiveBandCoverage(edges, bands, decimals);
  if (rows.length === 0) return null;
  // rows = sorted boundaries, then the overflow row (always last).
  const labels = exclusiveBandLabels(rows.slice(0, -1).map(r => r.band), d.toDisplay, d.unit);
  return `${prefix}${rows.map((r, i) => `${labels[i]} ${r.percent}%`).join(", ")}.`;
}

export function buildResultNarrative(modelId: string, result: SolveResult, ctx: NarrativeContext): ResultNarrative | null {
  const family = FAMILY_BY_MODEL[modelId];
  if (!family) return null;
  const howToRead = HOW_TO_READ[modelId];

  // A no-incumbent result carries sentinel zeros (resultOutcome.ts) — say so
  // truthfully and derive nothing from them.
  if (!hasIncumbent(classifyResultOutcome(result))) {
    return { summary: [`There is no solution to describe (${resultQualityText(result)}).`], howToRead };
  }

  const details = (result.details ?? {}) as Record<string, unknown>;
  const label = (id: string) => ctx.displayIdById?.[id] ?? id;
  const d = ctx.distance;
  const summary: string[] = [
    `Objective: ${result.objective.toLocaleString()}${ctx.solveTimeSec != null ? `, solved in ${ctx.solveTimeSec.toFixed(1)}s` : ""}.`,
  ];

  if (family === "transport") {
    // details.openWarehouseIds holds MINES here (solve.py:687) — narrate the
    // shipments instead of calling anything a warehouse.
    if (result.edges.length > 0) {
      const mines = new Set(result.edges.map(e => e.fromId)).size;
      const stations = new Set(result.edges.map(e => e.toId)).size;
      const lanes = result.edges.length;
      summary.push(
        `Coal ships from ${mines} ${plural(mines, "mine", "mines")} to ${stations} ${plural(stations, "power station", "power stations")} over ${lanes} ${plural(lanes, "lane", "lanes")}.`,
      );
    }
  } else {
    // Two-echelon (deviation 2): JADE reports metrics.openFacilityIds
    // (warehouses only); gold-au reports only details.openWarehouseIds
    // (refineries). Plants/mines are never facility decisions.
    const ids = family === "twoEchelon"
      ? (result.metrics.openFacilityIds ?? stringIds(details.openWarehouseIds))
      : stringIds(details.openWarehouseIds);
    if (ids) {
      const [one, many] = modelId === "two-echelon-gold-au" ? ["refinery", "refineries"] : ["warehouse", "warehouses"];
      summary.push(`${ids.length} ${plural(ids.length, one, many)} open${ids.length > 0 ? `: ${ids.map(label).join(", ")}` : ""}.`);
    }
  }

  if (d) {
    if (family === "maxCoverage") {
      const pct = finite(details.coveragePct);
      const covered = finite(details.coveredDemand);
      const highService = finite(details.highServiceDistMi);
      if (pct != null && covered != null && highService != null) {
        summary.push(`${pct.toFixed(2)}% of demand (${covered.toLocaleString()} units) is within the ${formatDistance(highService, d)} high-service distance.`);
      }
    } else if (family === "twoEchelon") {
      for (const leg of distinctLegs(result.edges)) {
        const s = bandSentence(`${legLabel(leg)} flow by distance band: `, result.edges.filter(e => e.leg === leg), ctx.bands, bandDecimals(modelId), d);
        if (s) summary.push(s);
      }
    } else {
      const prefix = family === "transport" ? "Tonnage by distance band: " : "Demand by distance band: ";
      const s = bandSentence(prefix, serviceEdgesFor(result.edges), ctx.bands, bandDecimals(modelId), d);
      if (s) summary.push(s);
    }

    const byLeg = result.metrics.avgDistanceByLeg ?? [];
    if (family === "twoEchelon" && byLeg.length > 0) {
      for (const l of byLeg) summary.push(`Average ${legLabel(l.leg)} distance: ${formatDistance(l.avgDistance, d)}.`);
    } else if (result.metrics.weightedAvgDistance != null) {
      summary.push(`Weighted average distance: ${formatDistance(result.metrics.weightedAvgDistance, d)}.`);
    }
  }

  return { summary, howToRead };
}
