import type { z } from "zod";

/**
 * Display labels for input fields, keyed by the FIRST path segment of a Zod
 * issue. This table restates labels the studio form also holds — a deliberate,
 * documented duplication (spec §3.2). It is a label table, not logic: the
 * validation rules stay single-sourced in the Zod schemas. A missing entry is
 * caught by formatInputIssues.test.ts's label-coverage test, not discovered by
 * a student reading a raw field name.
 */
export const INPUT_FIELD_LABELS: Record<string, string> = {
  // shared
  p: "Number of warehouses",
  gap: "MIP gap",
  timeLimitSec: "Time limit",
  capacityMode: "Capacity mode",
  uniformCapacity: "Warehouse capacity",
  distanceBands: "Distance bands",
  warehouseOverrides: "Warehouse overrides",
  customerOverrides: "Customer overrides",
  addedWarehouses: "Added warehouses",
  addedCustomers: "Added customers",
  distanceOverrides: "Distance overrides",
  // max-coverage-us (Chapter 4). Entries are CAPITALISED because they are used
  // as sentence subjects; `substituteKeys` lowercases them for mid-sentence
  // use, so one table serves both positions.
  highServiceDistMi: "High-service distance",
  maxDistMi: "Max distance",
  avgServiceDistCapMi: "Average service distance cap",
  coverageFloorDemand: "Coverage floor",
  objective: "Objective",
  // transport-coal / delivery
  capacityFactor: "Capacity factor",
  singleSource: "Single sourcing",
  capacityInactive: "Capacity constraint",
  laneCostOverrides: "Lane cost overrides",
  // delivery-teaching-us (Chapter 5)
  costAdjustEnabled: "Cost adjustment",
  distanceThreshold: "Distance threshold",
  costPerMile: "Cost per mile",
  costPerMileOver: "Cost per mile over threshold",
  // two-echelon
  bomRatio: "BOM ratio",
  refineryOverrides: "Refinery overrides",
  addedRefineries: "Added refineries",
  // two-echelon-jade-us (Chapter 9) — plant x product "can-make" toggle.
  // `distanceOverrides` above already covers this model's leg overrides.
  plantProductCapability: "Plant-product capability",
  transportCosts: "Transportation costs",
  addedPlants: "Added plants",
  // transport-coal (Chapter 3) — mine/station capacity-demand overrides and
  // scenario-local added entities. Not in any model's `required[]`, so only
  // the all-`properties` guard (not the `required[]` one) catches a missing
  // label here.
  mineCapacities: "Mine capacities",
  stationDemands: "Station demands",
  addedMines: "Added mines",
  addedStations: "Added stations",
};

/**
 * Zod prefixes its own generic subject onto range messages — "Number must be
 * greater than 0", not "must be greater than 0". Prepending a field label
 * without stripping it yields "Average service distance cap NUMBER must be
 * greater than 0." Verified against the real schema output, not assumed.
 */
const GENERIC_SUBJECT = /^(Number|String|Array|Date|Boolean|Value)\s+/;

// Leaves an acronym label alone (e.g. "BOM ratio") rather than lowercasing
// just its first character ("bOM ratio") — an acronym is detected by its
// first two characters both being uppercase, which no ordinary label
// (e.g. "Max distance") matches.
const lower = (s: string): string =>
  /^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);

function labelFor(path: z.ZodIssue["path"]): string {
  const head = path[0];
  if (typeof head !== "string") return "The values";
  // Unmapped fields degrade to the raw key rather than vanishing.
  return INPUT_FIELD_LABELS[head] ?? head;
}

/** "distanceOverrides[1].distance" -> " row 2" (1-based, for humans). */
function rowSuffix(path: z.ZodIssue["path"]): string {
  const idx = path.find(seg => typeof seg === "number");
  return typeof idx === "number" ? ` row ${idx + 1}` : "";
}

/**
 * Replaces every known raw field key inside a message with its label,
 * lowercased because these land mid-sentence ("… must be less than max
 * distance"). `skipHead` is the path's own head, which the caller has already
 * rendered as a capitalised label and must not re-substitute.
 */
function substituteKeys(message: string, skipHead?: string): string {
  let out = message;
  for (const [key, label] of Object.entries(INPUT_FIELD_LABELS)) {
    if (key === skipHead) continue;
    out = out.replace(new RegExp(`\\b${key}\\b`, "g"), lower(label));
  }
  return out;
}

function sentenceFor(issue: z.ZodIssue): string {
  const label = labelFor(issue.path);
  const row = rowSuffix(issue.path);
  // Zod's bare "Required" is useless without its field name. This is the
  // message a migration-skipped row produces for every absent field, so it is
  // load-bearing for the skipped-row diagnosis path (spec §3.2).
  if (issue.message === "Required") return `${label}${row} is required.`;
  // A `custom` cross-field message is already a full human statement
  // ("highServiceDistMi must be less than maxDistMi") but names raw fields —
  // and it names them on BOTH sides, so substituting only the leading one
  // leaves "must be less than maxDistMi" in front of a student.
  const head = issue.path[0];
  if (typeof head === "string" && issue.message.startsWith(head)) {
    const rest = substituteKeys(issue.message.slice(head.length), head);
    return `${label}${row}${rest}.`;
  }
  const body = substituteKeys(issue.message.replace(GENERIC_SUBJECT, ""));
  return `${label}${row} ${lower(body)}.`;
}

/**
 * Turns Zod issues into one readable sentence per issue, joined with a space.
 * NO issue cap: Chapter 4 has seven cross-validated fields that can all fail
 * at once and a student needs all seven — a cap would silently hide the field
 * they are looking at (spec §3.2).
 */
export function formatInputIssues(issues: z.ZodIssue[]): string {
  if (issues.length === 0) return "The values could not be saved.";
  return issues.map(sentenceFor).join(" ");
}
