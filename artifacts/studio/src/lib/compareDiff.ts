// F2.1 — pure diff engine for Compare v2. No React, no API calls: takes plain
// scenario data (already fetched by the caller) and returns diff results.
//
// Design intent (see IMPLEMENTATION_PLAN.md F2.1 / PRD WS-F): both the input
// diff and the output-metrics diff work generically, by iterating whatever
// keys are actually present, rather than hardcoding per-model field names
// (`p`, `capacityMode`, `bandCoverage`, ...). The ONE special case the plan
// calls for — arrays of `{id: ...}` objects (like `warehouseOverrides` /
// `customerOverrides`) diff element-by-element matched on `id`, not by array
// index — is implemented once, generically, inside `deepEqual` itself, so it
// applies at any nesting depth and to any future model's similarly-shaped
// field without new code.

export interface DiffScenarioInputs {
  id: number;
  name: string;
  inputs: Record<string, unknown>;
}

export interface DiffEdge {
  fromId: string;
  toId: string;
  flow: number;
  distance: number;
  band?: number;
}

export interface DiffScenarioResult {
  id: number;
  name: string;
  objective: number;
  edges: DiffEdge[];
  metrics: Record<string, unknown>;
}

export interface InputArrayItemDiff {
  itemId: string;
  changed: boolean;
  values: (Record<string, unknown> | undefined)[];
}

export interface InputDiffRow {
  key: string;
  values: unknown[];
  changed: boolean;
  /** Present iff every scenario's value for this key is an array of `{id}` objects. */
  itemDiffs?: InputArrayItemDiff[];
}

export interface NumericDiff {
  values: (number | null)[];
  deltaAbs: (number | null)[];
  deltaPct: (number | null)[];
}

export interface SiteDiffEntry {
  scenarioId: number;
  openSites: string[];
  added: string[];
  removed: string[];
}

export interface MetricItemDiff {
  itemKey: string;
  changed: boolean;
  values: unknown[];
}

export interface MetricDiffRow {
  key: string;
  kind: "numeric" | "keyed-array" | "other";
  changed: boolean;
  values: unknown[];
  deltaAbs?: (number | null)[];
  deltaPct?: (number | null)[];
  keyField?: string;
  itemDiffs?: MetricItemDiff[];
}

export interface OutputDiff {
  baselineId: number;
  objective: NumericDiff;
  openSites: SiteDiffEntry[];
  /** vs baseline; `null` for the baseline's own entry (not applicable). */
  reassignedCount: (number | null)[];
  metrics: MetricDiffRow[];
}

// ---------------------------------------------------------------------------
// Generic structural equality, with the one special-cased rule for id-keyed
// arrays — applied recursively so it works at any depth, on any key name.
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isIdKeyedArray(v: unknown): v is Array<Record<string, unknown> & { id: string | number }> {
  return (
    Array.isArray(v) &&
    v.every((el) => isPlainObject(el) && "id" in el && (typeof el.id === "string" || typeof el.id === "number"))
  );
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (isIdKeyedArray(a) && isIdKeyedArray(b)) {
      const mapA = new Map(a.map((el) => [String(el.id), el] as const));
      const mapB = new Map(b.map((el) => [String(el.id), el] as const));
      if (mapA.size !== mapB.size) return false;
      for (const [id, elA] of mapA) {
        const elB = mapB.get(id);
        if (elB === undefined || !deepEqual(elA, elB)) return false;
      }
      return true;
    }
    if (a.length !== b.length) return false;
    return a.every((el, i) => deepEqual(el, b[i]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Input diff — shallow diff-by-key across N scenarios' `inputs`.
// ---------------------------------------------------------------------------

function buildIdKeyedItemDiffs(
  arrays: Array<Array<Record<string, unknown> & { id: string | number }>>,
): InputArrayItemDiff[] {
  const allIds = new Set<string>();
  arrays.forEach((arr) => arr.forEach((el) => allIds.add(String(el.id))));
  return [...allIds].sort().map((itemId) => {
    const values = arrays.map((arr) => arr.find((el) => String(el.id) === itemId));
    const changed = values.some((v, i) => i > 0 && !deepEqual(v, values[0]));
    return { itemId, changed, values };
  });
}

export function diffInputs(scenarios: DiffScenarioInputs[]): InputDiffRow[] {
  const allKeys = new Set<string>();
  scenarios.forEach((s) => Object.keys(s.inputs).forEach((k) => allKeys.add(k)));

  return [...allKeys].sort().map((key) => {
    const values = scenarios.map((s) => s.inputs[key]);
    const changed = values.some((v, i) => i > 0 && !deepEqual(v, values[0]));
    const row: InputDiffRow = { key, values, changed };
    if (values.every(isIdKeyedArray)) {
      row.itemDiffs = buildIdKeyedItemDiffs(
        values as Array<Array<Record<string, unknown> & { id: string | number }>>,
      );
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// Output diff — objective delta, site open/closed, reassignment count,
// generic per-key metrics deltas, all relative to a chosen baseline scenario.
// ---------------------------------------------------------------------------

function computeNumericDelta(values: (number | null)[], baselineIdx: number): NumericDiff {
  const baseline = values[baselineIdx];
  const deltaAbs = values.map((v) => (v == null || baseline == null ? null : v - baseline));
  const deltaPct = values.map((v, i) => {
    const d = deltaAbs[i];
    if (d == null || baseline == null || baseline === 0) return null;
    return (d / baseline) * 100;
  });
  return { values, deltaAbs, deltaPct };
}

function openSitesOf(edges: DiffEdge[]): string[] {
  return [...new Set(edges.map((e) => e.fromId))].sort();
}

function reassignedCountVsBaseline(baselineEdges: DiffEdge[], edges: DiffEdge[]): number {
  const baseMap = new Map(baselineEdges.map((e) => [e.toId, e.fromId]));
  const map = new Map(edges.map((e) => [e.toId, e.fromId]));
  const allTargets = new Set([...baseMap.keys(), ...map.keys()]);
  let count = 0;
  allTargets.forEach((t) => {
    if (baseMap.get(t) !== map.get(t)) count++;
  });
  return count;
}

function isRecordArray(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.every((el) => isPlainObject(el));
}

// Find a field to key an array-of-objects by: prefer "id" (the plan's
// explicit rule), otherwise fall back to any field whose values are unique
// across every scenario's array (e.g. bandCoverage's "band", or
// utilizationByNode's "warehouseId") — generic, no field names hardcoded.
function detectKeyField(arrays: Record<string, unknown>[][]): string | null {
  const sample = arrays.find((a) => a.length > 0);
  if (!sample) return null;
  const candidates = Object.keys(sample[0]);
  const ordered = candidates.includes("id") ? ["id", ...candidates.filter((k) => k !== "id")] : candidates;

  for (const k of ordered) {
    const worksEverywhere = arrays.every((arr) => {
      if (arr.length === 0) return true;
      const vals = arr.map((el) => el[k]).filter((v) => typeof v === "string" || typeof v === "number");
      if (vals.length !== arr.length) return false;
      return new Set(vals).size === vals.length;
    });
    if (worksEverywhere) return k;
  }
  return null;
}

function buildKeyedMetricItemDiffs(
  arrays: Record<string, unknown>[][],
  keyField: string,
  baselineIdx: number,
): MetricItemDiff[] {
  const allKeys = new Set<string>();
  arrays.forEach((arr) => arr.forEach((el) => allKeys.add(String(el[keyField]))));
  return [...allKeys].sort().map((itemKey) => {
    const values = arrays.map((arr) => arr.find((el) => String(el[keyField]) === itemKey));
    const changed = values.some((v, i) => i !== baselineIdx && !deepEqual(v, values[baselineIdx]));
    return { itemKey, changed, values };
  });
}

// All "changed" flags here are anchored to `baselineIdx` (whichever scenario
// the user has picked as baseline), matching `computeNumericDelta` — not
// array position 0 — since the baseline can be re-pointed at any selected
// scenario and every diff must stay relative to *that* choice.
function diffMetrics(scenarios: DiffScenarioResult[], baselineIdx: number): MetricDiffRow[] {
  const allKeys = new Set<string>();
  scenarios.forEach((s) => Object.keys(s.metrics ?? {}).forEach((k) => allKeys.add(k)));

  return [...allKeys].sort().map((key) => {
    const values = scenarios.map((s) => s.metrics?.[key]);

    if (values.every((v) => typeof v === "number" || v == null)) {
      const nums = values.map((v) => (typeof v === "number" ? v : null));
      const changed = nums.some((v, i) => i !== baselineIdx && v !== nums[baselineIdx]);
      const { deltaAbs, deltaPct } = computeNumericDelta(nums, baselineIdx);
      return { key, kind: "numeric", changed, values, deltaAbs, deltaPct };
    }

    if (values.every(isRecordArray)) {
      const arrays = values as Record<string, unknown>[][];
      const keyField = detectKeyField(arrays);
      if (keyField) {
        const itemDiffs = buildKeyedMetricItemDiffs(arrays, keyField, baselineIdx);
        const changed = itemDiffs.some((d) => d.changed);
        return { key, kind: "keyed-array", changed, values, keyField, itemDiffs };
      }
    }

    const changed = values.some((v, i) => i !== baselineIdx && !deepEqual(v, values[baselineIdx]));
    return { key, kind: "other", changed, values };
  });
}

export function diffOutputs(scenarios: DiffScenarioResult[], baselineId: number): OutputDiff {
  const foundIdx = scenarios.findIndex((s) => s.id === baselineId);
  const baselineIdx = foundIdx === -1 ? 0 : foundIdx;
  const baselineEdges = scenarios[baselineIdx].edges;
  const baselineOpen = new Set(openSitesOf(baselineEdges));

  const objective = computeNumericDelta(
    scenarios.map((s) => s.objective),
    baselineIdx,
  );

  const openSites: SiteDiffEntry[] = scenarios.map((s) => {
    const open = openSitesOf(s.edges);
    const openSet = new Set(open);
    return {
      scenarioId: s.id,
      openSites: open,
      added: open.filter((id) => !baselineOpen.has(id)),
      removed: [...baselineOpen].filter((id) => !openSet.has(id)),
    };
  });

  const reassignedCount = scenarios.map((s, i) =>
    i === baselineIdx ? null : reassignedCountVsBaseline(baselineEdges, s.edges),
  );

  const metrics = diffMetrics(scenarios, baselineIdx);

  return {
    baselineId: scenarios[baselineIdx].id,
    objective,
    openSites,
    reassignedCount,
    metrics,
  };
}
