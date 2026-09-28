import { and, eq, sql } from "drizzle-orm";
import { scenariosTable } from "@workspace/db";
import { validateInputsForModel } from "../validation/inputs/index.js";
import { normalizeAddedEntityDistances } from "./autoDistance.js";
import { MAX_COVERAGE_MODEL_ID, nextStepEpoch } from "./maxCoverageSteps.js";

export type ScenarioRow = typeof scenariosTable.$inferSelect;

export type ApplyInputWriteOutcome =
  | { kind: "ok"; row: ScenarioRow }
  | { kind: "not_found" }
  | { kind: "invalid"; error: string };

export interface ApplyScenarioInputWriteParams {
  scenarioId: number;
  userId: string;
  nextInputs: Record<string, unknown>;
}

/**
 * CH4-26 — the SINGLE place `scenarios.inputs` is updated. Every update-side
 * writer (PATCH, import/apply) calls this instead of composing its own
 * `.set({ inputs, … })`; create and clone use `initialInputsForInsert`.
 * `routes/distanceBands.ts` is the one deliberate exception: it writes a
 * single `jsonb_set` on `{distanceBands}` alone, which preserves the epoch BY
 * CONSTRUCTION and must keep its atomic field-scoped write — that property is
 * asserted by test, not re-implemented here.
 *
 * It takes no `changedKeys` argument. It selects the persisted row FOR UPDATE,
 * normalizes the candidate the same way the write path does, and computes the
 * diff itself — so a caller that miscomputes or omits a key cannot move the
 * epoch incorrectly, because it never supplies the input to that decision.
 *
 * Ownership-scoped (hard rule #5): a row the caller does not own is simply
 * not found, so a non-owner can never distinguish "not yours" from "absent".
 * This is why the routine takes `userId`, unlike the spec's three-argument
 * sketch — that form cannot scope the locked SELECT.
 */
export async function applyScenarioInputWrite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle's tx type is not exported
  tx: any,
  params: ApplyScenarioInputWriteParams,
): Promise<ApplyInputWriteOutcome> {
  const [persisted] = await tx.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, params.scenarioId), eq(scenariosTable.userId, params.userId)))
    .for("update");
  if (!persisted) return { kind: "not_found" };

  const validation = validateInputsForModel(persisted.modelId, params.nextInputs);
  if (!validation.success) return { kind: "invalid", error: validation.error };

  const normalized = normalizeAddedEntityDistances(
    persisted.modelId,
    validation.data,
  ) as Record<string, unknown>;

  const persistedInputs = (persisted.inputs ?? {}) as Record<string, unknown>;

  // CH4-23 — discard whatever the client sent and recompute from the locked
  // row. Computed inside this transaction, never read-modify-write in
  // application code, so two concurrent edits cannot both derive the same
  // next epoch.
  const inputsToStore: Record<string, unknown> =
    persisted.modelId === MAX_COVERAGE_MODEL_ID
      ? { ...normalized, stepEpoch: nextStepEpoch(persistedInputs, normalized) }
      : normalized;

  // Unchanged semantics for every model: a save is non-geometric (does not
  // bump inputsUpdatedAt / solve_input_revision) ONLY when distanceBands is
  // the sole changed key. CH4-8 — solve_input_revision is left alone by the
  // step workflow; a Step 2 parameter write is a real inputs change and bumps
  // it exactly as any other non-bands change already did.
  //
  // A2 — this absorbs import/apply's old invariant. That call site used to
  // carry the comment "import/apply is always a geometric input write ... so
  // it always increments solve_input_revision, DB-side, unconditionally"
  // (routes/scenarios.ts, pre-CH4-2s-2). Routing it through here makes the
  // bump CONDITIONAL in form — but not in effect, because distanceBands is
  // never an imported entity, so the bands-only branch is unreachable from
  // that caller.
  const changed = new Set([
    ...Object.keys(persistedInputs),
    ...Object.keys(inputsToStore),
  ].filter((k) => JSON.stringify(persistedInputs[k]) !== JSON.stringify(inputsToStore[k])));
  changed.delete("stepEpoch");
  const isBandsOnlyChange = [...changed].every((k) => k === "distanceBands");

  const [row] = await tx.update(scenariosTable)
    .set({
      inputs: inputsToStore,
      updatedAt: new Date(),
      ...(isBandsOnlyChange
        ? {}
        : {
            inputsUpdatedAt: new Date(),
            solveInputRevision: sql`${scenariosTable.solveInputRevision} + 1`,
          }),
    })
    .where(and(eq(scenariosTable.id, params.scenarioId), eq(scenariosTable.userId, params.userId)))
    .returning();

  return { kind: "ok", row };
}

// Re-exported so route files import one module for the whole write contract.
export { initialInputsForInsert, isStep1Key } from "./maxCoverageSteps.js";

/**
 * CH4-24/CH4-25 — the write-route narrowing guard.
 *
 * The model registry's validator stays the EXECUTABLE one (it must accept
 * `min_distance`, because `validateInputsForModel` is called by BOTH
 * `buildValidatedInputSnapshot` at enqueue AND the recovery reconstructor
 * that rebuilds a queued job after a process restart — a coverage-only
 * registry entry would make every recovered Step 2 job permanently
 * unrunnable). The narrowing therefore has to sit here, at the write routes.
 *
 * It inspects the RAW request body, before Zod has a chance to strip
 * anything. This repo's validators are deliberately non-`.strict()`, so
 * unknown and omitted keys are STRIPPED, not refused — simply leaving
 * `coverageFloorDemand` out of a persisted schema would silently discard a
 * client-supplied floor and report success, the opposite of what CH4-24
 * promises. Only the server can produce a payload that reaches the
 * executable validator with `min_distance` set; that is what makes the floor
 * un-typeable rather than merely un-shown.
 */
export function assertNoServerOwnedStepFields(modelId: string, rawInputs: unknown): string | null {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return null;
  if (rawInputs === null || typeof rawInputs !== "object") return null;
  const raw = rawInputs as Record<string, unknown>;

  if (raw.objective === "min_distance") {
    return "objective min_distance is produced by the Step 2 solve and cannot be set directly";
  }
  // `in`, not a truthiness check: the key is refused when PRESENT, even if
  // null or undefined.
  if ("coverageFloorDemand" in raw) {
    return "coverageFloorDemand is produced by the Step 1 solve and cannot be set directly";
  }
  return null;
}
