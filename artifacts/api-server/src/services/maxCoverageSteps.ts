// CH4-7 / CH4-23 / CH4-26 — pure step logic for max-coverage-us's two-step
// workflow. No DB access lives here: every function is a pure transform, so
// the epoch rule can be tested exhaustively without Postgres.

export const MAX_COVERAGE_MODEL_ID = "max-coverage-us";

// A "Step 1 field" is any key in `inputs` other than these three. `step2` is
// Step 2's own parameters; `stepEpoch` is the marker itself; `distanceBands`
// is a reporting lens, not a model constraint, so it stays editable while
// Step 1 is frozen.
export const NON_STEP1_KEYS: ReadonlySet<string> = new Set(["step2", "stepEpoch", "distanceBands"]);

export function isStep1Key(key: string): boolean {
  return !NON_STEP1_KEYS.has(key);
}

// Per-key comparison via JSON.stringify, matching routes/scenarios.ts's own
// diffInputKeys: a key present on only one side always counts as changed,
// and one key's internal ordering cannot mask a change in a DIFFERENT key.
function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key])) changed.push(key);
  }
  return changed;
}

export function readStepEpoch(inputs: Record<string, unknown> | null | undefined): number {
  const raw = inputs?.stepEpoch;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

// CH4-23 — the epoch is computed from the PERSISTED row and the candidate,
// never from a client value. Deliberately takes no `changedKeys` argument:
// an earlier draft did, which would have made the epoch boundary exactly as
// trustworthy as each caller's own diffing — and the whole point is that
// callers cannot be trusted (import/apply demonstrably isn't). A guard that
// accepts the guarded value as an argument is not a guard.
export function nextStepEpoch(
  persisted: Record<string, unknown>,
  next: Record<string, unknown>,
): number {
  const current = readStepEpoch(persisted);
  const touchedStep1 = changedKeys(persisted, next).some(isStep1Key);
  return touchedStep1 ? current + 1 : current;
}

// CH4-26 — create and clone both force epoch 1. For clone this is the whole
// point: carrying the source's epoch forward would make a fresh copy's epoch
// depend on how many times its SOURCE had been edited. Epoch is per-scenario
// workflow state, not user data, so it does not travel with a copy.
export function initialInputsForInsert(
  modelId: string,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return inputs;
  return { ...inputs, stepEpoch: 1 };
}

// CH4-10 — Step 2's SolveInput.inputs is built at enqueue and NEVER stored on
// the scenario. It is the synthesized object that gets validated and persisted
// as the job's `input_snapshot`, so:
//   - the snapshot's `objective` is what identifies which step a job belongs to;
//   - the floor the student was shown and the floor the solver was given come
//     from one source and cannot disagree.
// `coverageFloorDemand` is declared as an integer (maxCoverage.ts) and Step 1's
// `coveredDemand` is emitted as `int(covered)` (solve.py), so the injection
// needs no rounding and cannot fail shape validation.
export function synthesizeStep2Inputs(
  step1Inputs: Record<string, unknown>,
  coveredDemand: number,
): Record<string, unknown> {
  const { avgServiceDistCapKm: _dropped, step2, ...inherited } = step1Inputs;
  const overrides = (step2 ?? {}) as { gap?: number; timeLimitSec?: number };
  return {
    ...inherited,
    objective: "min_distance",
    coverageFloorDemand: coveredDemand,
    gap: overrides.gap ?? (inherited.gap as number),
    timeLimitSec: overrides.timeLimitSec ?? (inherited.timeLimitSec as number),
  };
}

export type MaxCoverageStep = 1 | 2;

// CH4-9 — the step a solve targets, derived from state alone. Step 1 unsolved
// → target Step 1; Step 1 solved → target Step 2. Because a Step 1 edit clears
// BOTH results (CH4-2), "Step 1 is solved" is the only question that needs
// asking.
export function deriveTargetStep(step1Solved: boolean): MaxCoverageStep {
  return step1Solved ? 2 : 1;
}

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getManifest } from "../registry/modelRegistry.js";

export interface ScenarioStepSummary {
  objective: "coverage" | "min_distance";
  status: string;
  solutionStatus: string | null;
  quality: string | null;
  coveragePct: number | null;
  coveredDemand: number | null;
  weightedAvgDistance: number | null;
  distanceUnit: string;
  runTimeSec: number | null;
}

export interface ScenarioStepState {
  solved: boolean;
  stale: boolean;
  jobId: number | null;
  summary: ScenarioStepSummary | null;
}

export interface ScenarioSteps {
  step1: ScenarioStepState;
  step2: ScenarioStepState;
}

const EMPTY_STEP: ScenarioStepState = { solved: false, stale: false, jobId: null, summary: null };

// Shared by both loadScenarioSteps and loadScenarioStepsBatch — the SQL
// projection is identical (see loadScenarioSteps's own comment for why each
// jsonb path is read where it is); only the WHERE/DISTINCT ON scoping
// differs between "one scenario" and "many scenarios in one query".
function summaryFromRawRow(raw: Record<string, unknown>, distanceUnit: string): ScenarioStepSummary {
  return {
    objective: raw.objective as "coverage" | "min_distance",
    status: String(raw.status ?? ""),
    solutionStatus: raw.solution_status == null ? null : String(raw.solution_status),
    quality: raw.quality == null ? null : String(raw.quality),
    coveragePct: raw.coverage_pct == null ? null : Number(raw.coverage_pct),
    coveredDemand: raw.covered_demand == null ? null : Number(raw.covered_demand),
    weightedAvgDistance: raw.weighted_avg_distance == null ? null : Number(raw.weighted_avg_distance),
    distanceUnit,
    runTimeSec: raw.run_time_sec == null ? null : Number(raw.run_time_sec),
  };
}

// R2 (see loadScenarioSteps's own header comment for the full rationale) —
// the CURRENT effective Step 2 settings: `step2` overrides when present,
// else Step 1's own values are inherited.
function effectiveStep2Settings(inputs: Record<string, unknown>): { gap: number | null; timeLimitSec: number | null } {
  const step2Bag = (inputs.step2 ?? null) as { gap?: number; timeLimitSec?: number } | null;
  return {
    gap: step2Bag?.gap ?? (inputs.gap as number | undefined) ?? null,
    timeLimitSec: step2Bag?.timeLimitSec ?? (inputs.timeLimitSec as number | undefined) ?? null,
  };
}

// A3 — the two snapshot shapes are NOT symmetric, and that asymmetry is what
// produced the R2 defect. A Step 1 snapshot is `validation.data`, so it
// RETAINS both `step2` and `stepEpoch`. A Step 2 snapshot comes from
// synthesizeStep2Inputs, which destructures `step2` away and writes the
// effective gap/timeLimitSec at the TOP LEVEL. Anything reading a snapshot
// must therefore know which step it is reading: `-> 'step2'` is populated for
// Step 1 and always null for Step 2. (Retaining `step2` on the Step 1
// snapshot is harmless — pmedian.ts picks wire fields explicitly, so it never
// reaches solve.py.)

// CH4-13 — the summary is projected in SQL. `solve_jobs.resultSummary`
// (jobRunner.ts's markSucceeded) carries only status/objective/objectiveMode/
// weightedAvgDistance/distanceUnit/runTimeSec — no covered demand, no coverage
// percent, no solution status. Rather than change the write path, which would
// leave every existing row short anyway, the missing fields are extracted from
// the stored envelope with jsonb path expressions, so Postgres returns the
// small object and never ships two full envelopes to Node. Same posture
// routes/solveHistory.ts already takes by pushing its dedupe into SQL.
//
// DISTINCT ON (objective) + ORDER BY id DESC yields at most two rows: the
// newest succeeded job per step, restricted to the CURRENT epoch. A job whose
// snapshot carries a superseded epoch is simply not selected — that is what
// "clearing a step" means (CH4-7): nothing is deleted, validity is marked.
export async function loadScenarioSteps(
  scenarioId: number,
  userId: string,
  modelId: string,
  inputs: Record<string, unknown>,
): Promise<ScenarioSteps | null> {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return null;

  const epoch = readStepEpoch(inputs);
  const distanceUnit = getManifest(modelId)?.distanceUnit ?? "mi";

  const result = await db.execute(sql`
    SELECT DISTINCT ON (j.input_snapshot -> 'inputs' ->> 'objective')
      j.id                                                                  AS job_id,
      j.input_snapshot -> 'inputs' ->> 'objective'                          AS objective,
      -- R2 -- read the snapshot's TOP-LEVEL effective settings, not a nested
      -- step2 bag. synthesizeStep2Inputs destructures step2 away and
      -- writes the effective gap/timeLimitSec at the top level, so a real
      -- Step 2 snapshot has NO step2 key at all. Reading one would make
      -- every freshly-solved Step 2 compare against null and report stale
      -- immediately.
      (j.input_snapshot -> 'inputs' ->> 'gap')::double precision            AS snapshot_gap,
      (j.input_snapshot -> 'inputs' ->> 'timeLimitSec')::int                AS snapshot_time_limit,
      j.result ->> 'status'                                                 AS status,
      j.result ->> 'solutionStatus'                                         AS solution_status,
      j.result ->> 'quality'                                                AS quality,
      (j.result ->> 'runTimeSec')::double precision                         AS run_time_sec,
      (j.result -> 'details' ->> 'coveragePct')::double precision           AS coverage_pct,
      (j.result -> 'details' ->> 'coveredDemand')::bigint                   AS covered_demand,
      (j.result -> 'metrics' ->> 'weightedAvgDistance')::double precision   AS weighted_avg_distance
    FROM solve_jobs j
    WHERE j.scenario_id = ${scenarioId}
      AND j.user_id = ${userId}
      AND j.status = 'succeeded'
      AND COALESCE((j.input_snapshot -> 'inputs' ->> 'stepEpoch')::int, 1) = ${epoch}
    ORDER BY j.input_snapshot -> 'inputs' ->> 'objective', j.id DESC
  `);

  const steps: ScenarioSteps = { step1: { ...EMPTY_STEP }, step2: { ...EMPTY_STEP } };

  // R2 — the CURRENT effective Step 2 settings, derived exactly as
  // synthesizeStep2Inputs derives them: `step2` overrides when present, else
  // Step 1's own values are inherited. Comparing effective-to-effective is
  // what makes "I never touched Step 2's settings" read as fresh.
  const effectiveStep2 = effectiveStep2Settings(inputs);

  for (const raw of result.rows as Record<string, unknown>[]) {
    const objective = raw.objective as "coverage" | "min_distance";
    const summary = summaryFromRawRow(raw, distanceUnit);

    if (objective === "coverage") {
      // CH4-3 — Step 1 can never be stale: the only thing that can change it
      // (a Step 1 edit) bumps the epoch, which drops it entirely.
      steps.step1 = { solved: true, stale: false, jobId: Number(raw.job_id), summary };
    } else {
      // Step 2 staleness compares the EFFECTIVE settings the solve actually
      // ran with against the effective settings now configured — field by
      // field, so key order cannot manufacture a difference. solve_jobs.
      // inputsHash is NOT used: it mixes in SOLVER_CODE_HASH, so every
      // solve.py deploy would flip every scenario to stale. It is a cache key,
      // not a staleness signal.
      const snapshotGap = raw.snapshot_gap == null ? null : Number(raw.snapshot_gap);
      const snapshotTimeLimit = raw.snapshot_time_limit == null ? null : Number(raw.snapshot_time_limit);
      const stale =
        effectiveStep2.gap !== snapshotGap ||
        effectiveStep2.timeLimitSec !== snapshotTimeLimit;
      steps.step2 = { solved: true, stale, jobId: Number(raw.job_id), summary };
    }
  }

  return steps;
}

export interface ScenarioStepsBatchRow {
  id: number;
  inputs: Record<string, unknown>;
}

// CMP-1 — the compare-list step-awareness gap. `GET /scenarios` cannot call
// loadScenarioSteps per row without an N+1 (one query per scenario). This is
// the same projection widened across many scenarios in ONE query — the
// caller filters to max-coverage-us rows and passes them here.
//
// The epoch problem: each scenario carries its OWN stepEpoch, so the
// single-scenario query's `WHERE ... stepEpoch = ${epoch}` cannot be reused
// as one shared filter value across many scenarios. The fix is to NOT filter
// epoch in SQL at all: select the snapshot's epoch as a COLUMN
// (`snapshot_epoch`), use `DISTINCT ON (scenario_id, objective) ... ORDER BY
// scenario_id, objective, id DESC` to get the newest succeeded job per
// scenario-and-objective across the whole batch, and compare that row's
// epoch against the scenario's CURRENT epoch in Node.
//
// This is safe for the same reason loadScenarioSteps's own epoch filter is
// safe: jobs are created at the then-current epoch (CH4-23), and the epoch
// only ever increases — it never resets or decreases. So the newest job for
// a given (scenario, objective) necessarily carries the HIGHEST epoch that
// exists for that pair. Two cases:
//   - if that highest epoch equals the scenario's current epoch, it is the
//     same row loadScenarioSteps's own `WHERE stepEpoch = ${epoch}` filter
//     would have selected (filtering first, then taking DISTINCT ON id DESC,
//     yields the same row as taking DISTINCT ON id DESC first and finding it
//     already matches);
//   - if it is LOWER than the current epoch, then every job for that pair is
//     superseded (none can exceed the newest), so loadScenarioSteps's SQL
//     filter would have matched zero rows for that objective too — which is
//     exactly what "reject on epoch mismatch in Node" reproduces here.
// The two orderings are therefore observationally identical; DISTINCT ON
// never needs to consider any row older than the newest for a given
// (scenario, objective), so nothing is lost by resolving the epoch check in
// Node instead of in the WHERE clause.
export async function loadScenarioStepsBatch(
  userId: string,
  scenarios: ScenarioStepsBatchRow[],
): Promise<Map<number, ScenarioSteps>> {
  const steps = new Map<number, ScenarioSteps>();
  if (scenarios.length === 0) return steps;

  const distanceUnit = getManifest(MAX_COVERAGE_MODEL_ID)?.distanceUnit ?? "mi";
  const epochByScenario = new Map<number, number>();
  const inputsByScenario = new Map<number, Record<string, unknown>>();
  for (const scenario of scenarios) {
    steps.set(scenario.id, { step1: { ...EMPTY_STEP }, step2: { ...EMPTY_STEP } });
    epochByScenario.set(scenario.id, readStepEpoch(scenario.inputs));
    inputsByScenario.set(scenario.id, scenario.inputs);
  }

  const ids = scenarios.map(s => s.id);
  const result = await db.execute(sql`
    SELECT DISTINCT ON (j.scenario_id, j.input_snapshot -> 'inputs' ->> 'objective')
      j.scenario_id                                                         AS scenario_id,
      j.id                                                                  AS job_id,
      j.input_snapshot -> 'inputs' ->> 'objective'                          AS objective,
      -- The epoch the JOB was solved at, read as a plain column rather than
      -- filtered in the WHERE clause — see this function's own header
      -- comment for why that is safe to compare in Node instead.
      COALESCE((j.input_snapshot -> 'inputs' ->> 'stepEpoch')::int, 1)      AS snapshot_epoch,
      (j.input_snapshot -> 'inputs' ->> 'gap')::double precision            AS snapshot_gap,
      (j.input_snapshot -> 'inputs' ->> 'timeLimitSec')::int                AS snapshot_time_limit,
      j.result ->> 'status'                                                 AS status,
      j.result ->> 'solutionStatus'                                        AS solution_status,
      j.result ->> 'quality'                                                AS quality,
      (j.result ->> 'runTimeSec')::double precision                        AS run_time_sec,
      (j.result -> 'details' ->> 'coveragePct')::double precision           AS coverage_pct,
      (j.result -> 'details' ->> 'coveredDemand')::bigint                   AS covered_demand,
      (j.result -> 'metrics' ->> 'weightedAvgDistance')::double precision   AS weighted_avg_distance
    FROM solve_jobs j
    -- Ownership scoping: this query must not let one user's jobs leak into
    -- another's rows, so j.user_id is filtered here rather than trusted from
    -- the caller's own already-scoped scenario list.
    WHERE j.user_id = ${userId}
      AND j.scenario_id IN ${ids}
      AND j.status = 'succeeded'
    ORDER BY j.scenario_id, j.input_snapshot -> 'inputs' ->> 'objective', j.id DESC
  `);

  for (const raw of result.rows as Record<string, unknown>[]) {
    const scenarioId = Number(raw.scenario_id);
    const currentEpoch = epochByScenario.get(scenarioId);
    // Defensive only — every scenario_id in the result set came from the IN
    // list built above, so this is never expected to miss.
    if (currentEpoch === undefined) continue;

    const snapshotEpoch = raw.snapshot_epoch == null ? 1 : Number(raw.snapshot_epoch);
    // The epoch check loadScenarioSteps's WHERE clause performs in SQL,
    // performed here in Node instead — see the header comment for why the
    // two are equivalent.
    if (snapshotEpoch !== currentEpoch) continue;

    const objective = raw.objective as "coverage" | "min_distance";
    const summary = summaryFromRawRow(raw, distanceUnit);
    const scenarioSteps = steps.get(scenarioId)!;

    if (objective === "coverage") {
      scenarioSteps.step1 = { solved: true, stale: false, jobId: Number(raw.job_id), summary };
    } else {
      const effectiveStep2 = effectiveStep2Settings(inputsByScenario.get(scenarioId)!);
      const snapshotGap = raw.snapshot_gap == null ? null : Number(raw.snapshot_gap);
      const snapshotTimeLimit = raw.snapshot_time_limit == null ? null : Number(raw.snapshot_time_limit);
      const stale =
        effectiveStep2.gap !== snapshotGap ||
        effectiveStep2.timeLimitSec !== snapshotTimeLimit;
      scenarioSteps.step2 = { solved: true, stale, jobId: Number(raw.job_id), summary };
    }
  }

  return steps;
}
