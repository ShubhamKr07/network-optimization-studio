import { and, eq, sql } from "drizzle-orm";
import { scenariosTable } from "@workspace/db";
import { deriveMaxCoverageObjective } from "@workspace/units";
import { validateInputsForModel } from "../validation/inputs/index.js";
import { normalizeAddedEntityDistances } from "./autoDistance.js";

export type ScenarioRow = typeof scenariosTable.$inferSelect;

export const MAX_COVERAGE_MODEL_ID = "max-coverage-us";

// The create/clone half of the write contract. `applyScenarioInputWrite`
// below is the UPDATE half; both must derive the same server-owned fields, or
// a field exists on updated rows and not on created ones.
//
// CH4O-5 — `objective` is the ONE server-owned max-coverage-us input, derived
// from `coverageFloorDemand` through `@workspace/units`'
// `deriveMaxCoverageObjective` (the single TypeScript authority for the rule;
// solve.py necessarily carries its own copy, pinned against this one by
// solver/tests/test_max_coverage.py's TestModeDerivedFromFloor).
//
// Ordering at every call site is fixed: validate -> derive -> persist. Only
// validation guarantees the floor is an integer, and this reads it.
export function deriveServerOwnedInputs(
  modelId: string,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return inputs;
  const floor = inputs.coverageFloorDemand;
  if (typeof floor !== "number") return inputs; // validation already guaranteed this; defensive only
  return { ...inputs, objective: deriveMaxCoverageObjective(floor) };
}

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
 * `.set({ inputs, … })`; create and clone use `deriveServerOwnedInputs`.
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

  // CH4O-5 — derive the server-owned `objective` from the VALIDATED candidate,
  // after validation and before the write (validate -> derive -> persist).
  // Nothing the client sent is consulted: the write routes refuse an
  // `objective` key outright, and this recomputes it from the floor regardless.
  const inputsToStore: Record<string, unknown> = deriveServerOwnedInputs(persisted.modelId, normalized);

  // Unchanged semantics for every model: a save is non-geometric (does not
  // bump inputsUpdatedAt / solve_input_revision) ONLY when distanceBands is
  // the sole changed key.
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
  // `objective` is derived from coverageFloorDemand, so it can never change
  // alone -- but leaving it in would misclassify a bands-only save as geometric
  // on the first write after the migration, which is where it first appears.
  changed.delete("objective");
  const isBandsOnlyChange = [...changed].every((k) => k === "distanceBands");

  const [row] = await tx.update(scenariosTable)
    .set({
      inputs: inputsToStore,
      // HND-B — DB clock for both, so `isStale()`'s bare
      // `inputsUpdatedAt > solvedAt` compares two values from ONE clock. The
      // other side is written by jobRunner's publication update (also
      // `now()`), and `inputs_updated_at` additionally has the scenario
      // INSERT's `defaultNow()` as a writer, which is the DB's clock by
      // definition — so the app process's clock must not be a third party to
      // this comparison. See the note at jobRunner's `solvedAt`.
      updatedAt: sql`now()`,
      ...(isBandsOnlyChange
        ? {}
        : {
            inputsUpdatedAt: sql`now()`,
            solveInputRevision: sql`${scenariosTable.solveInputRevision} + 1`,
          }),
    })
    .where(and(eq(scenariosTable.id, params.scenarioId), eq(scenariosTable.userId, params.userId)))
    .returning();

  return { kind: "ok", row };
}

/**
 * The write-route narrowing guard, INVERTED from its two-step form.
 *
 * Under the old workflow `coverageFloorDemand` was server-produced and
 * un-typeable. It is now exactly what the student types, and `objective` is the
 * only server-owned field. Still reads the RAW body before Zod runs: these
 * validators are non-strict, so an unknown key is STRIPPED rather than refused,
 * and silently discarding a client-sent `objective` would report success while
 * ignoring it.
 */
export function assertNoServerOwnedFields(modelId: string, rawInputs: unknown): string | null {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return null;
  if (rawInputs === null || typeof rawInputs !== "object") return null;
  // `in`, not truthiness: refused when PRESENT, even as null or undefined.
  if ("objective" in (rawInputs as Record<string, unknown>)) {
    return "objective is derived from coverageFloorDemand and cannot be set directly";
  }
  return null;
}
