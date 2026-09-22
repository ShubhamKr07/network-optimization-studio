import type { Response } from "express";
import { getManifest, KNOWN_MODEL_IDS } from "../registry/modelRegistry.js";

// ch4-lock — server-side enforcement of a withheld chapter.
//
// The frontend greys the card and guards the route, but a route guard is
// worth about thirty seconds to anyone with devtools. This is the half that
// actually holds: a locked model's scenarios cannot be created, read,
// mutated, solved, imported, exported or cloned, no matter what client is
// talking to the API.
//
// The locked set is read from the model registry's manifests
// (`capabilities.locked`), never from a hardcoded id list in these routes —
// a per-model gate written as `modelId === "..."` is this repo's
// most-documented recurring bug class (see model-integration-precheck.md
// Gate 1), and a lock that a new sibling model silently escapes is worse
// than no lock.

// TEST-ONLY seam. Locking a chapter in the manifests would otherwise delete
// that model's entire server-side test coverage overnight: every existing
// Chen/JADE route test would start asserting 403 instead of the behavior it
// was written to protect. Those suites unlock everything for their own
// duration so they keep testing what they were built to test, and the
// lock's OWN tests set the set explicitly.
//
// Deliberately not an env var or config flag: nothing in the running server
// can reach this, so it cannot become an accidental production backdoor. It
// is only ever called from test files.
let lockedOverrideForTests: Set<string> | null = null;

/** TEST-ONLY. Pass `null` to restore the real manifest-derived lock set. */
export function setLockedModelsForTests(ids: readonly string[] | null): void {
  lockedOverrideForTests = ids === null ? null : new Set(ids);
}

/** True when this model is withheld from users entirely. */
export function isModelLocked(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  if (lockedOverrideForTests !== null) return lockedOverrideForTests.has(modelId);
  return getManifest(modelId)?.capabilities?.locked === true;
}

/** Every currently-locked model id. Read fresh — manifests load at boot. */
export function lockedModelIds(): string[] {
  return KNOWN_MODEL_IDS.filter(id => isModelLocked(id));
}

const LOCKED_MESSAGE = "This chapter is locked.";

/** Send the canonical 403 for a locked model. */
export function respondLocked(res: Response): void {
  res.status(403).json({ error: LOCKED_MESSAGE });
}
