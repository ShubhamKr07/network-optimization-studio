# Write-Failure Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every scenario write in the Studio exactly one way to report failure to a student — a readable sentence naming the offending field — and close the four follow-ups that share those write paths.

**Architecture:** One server-side formatter turns Zod issues into a sentence at the single place every input-validation 422 is produced (`modelRegistry.ts:138`), so the API contract is unchanged and no codegen runs. One client-side pure function reads that sentence off `ApiError.data` and every mutation's `onError` routes through it. Clone joins the validated write paths; migration-skipped rows explain themselves from the manifest's own `inputsSchema.required[]`; the draft-commit no-op guard moves into the shared hook; and import rounds its converted values to match export, with a guarded one-off backfill for the two production rows that predate it.

**Tech Stack:** TypeScript, Express 5, Zod, Drizzle (Postgres, jsonb inputs), React 18 + TanStack Query, Radix, vitest + RTL, Playwright, `tsx` for migration scripts.

**Spec:** `docs/superpowers/specs/2026-10-09-write-failure-feedback-design.md` — read §2 (the five decisions) before starting. They are settled; implement them, do not relitigate them.

## Global Constraints

- **D1: one mechanism, applied everywhere.** All **nine** `.mutate()` sites in `Workspace.tsx` plus `DirtyNavPrompt` surface failure through the same helper. Leaving any site silent fails the task.
- **D2: toast only.** No per-field inline UI, no `path`→form-field registry, no changes to input components.
- **D3:** migration-skipped rows explain themselves on the tab.
- **D4:** clone validates and rejects (422), like create and update.
- **D5:** round on import to match export; the canonical value becomes lossy at 4 dp. This is accepted.
- **Never edit generated code** — nothing under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`. No task here needs an `openapi.yaml` change; if you think you need one, stop and report.
- **Ownership is security-critical.** Every scenario query filters by the authenticated `user_id`; a non-owned resource returns **404, never 403**. A validation 422 must only be reachable *after* ownership passes, so it never becomes an existence oracle.
- **`e2e_accuracy.py` is sacred** and must pass unmodified. No task here touches the solver.
- **No production database access** except Task 8's explicitly-approved backfill, which is run by a human against a connection string they supply. Local work uses `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` inline.
- **`roundForFile` is the 4 dp authority**: `lib/units/src/convert.ts:24`, `Math.round(value * 1e4) / 1e4`. Never hardcode `1e4` or `1.609344` anywhere in this work.
- Invoke `andrej-karpathy-skills:karpathy-guidelines` before writing code (hard rule #12). `ponytail:ponytail` currently fails to resolve via the Skill tool in this repo — report that and proceed; it is not a blocker.
- **Branch:** `write-feedback`. Before every commit: `[ "$(git rev-parse --abbrev-ref HEAD)" = "write-feedback" ] || { echo "WRONG BRANCH"; exit 1; }`. Assert the branch **by name** — `!= "main"` is not sufficient and has already let a commit land on another session's branch in this shared checkout.

### Correction to the spec, found while writing this plan

§1 describes Run Optimizer's toast as the one correct surface. **It is not.** There are exactly three error-message extractions in the app and all three use `err.message`, which is `custom-fetch.ts`'s `buildErrorMessage` output — `HTTP 422 Unprocessable Content:` followed by the raw Zod array:

- `DirtyNavPrompt.tsx:54`
- `Workspace.tsx:2868` (`enqueueSolve`)
- `Workspace.tsx:2975` (`handleSolve`)

So the real starting state is: **six sites silent, three sites showing a JSON dump, zero correct.** Task 3 fixes all three; Task 9 corrects the spec.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `artifacts/api-server/src/validation/formatInputIssues.ts` | Pure: `ZodIssue[]` → one human sentence. Owns the field-label table. |
| `artifacts/api-server/src/validation/__tests__/formatInputIssues.test.ts` | Unit tests incl. the label-coverage guard. |
| `artifacts/studio/src/lib/describeWriteError.ts` | Pure: `unknown` → a displayable sentence. Handles both 422 body shapes. |
| `artifacts/studio/src/__tests__/describeWriteError.test.ts` | Unit tests for both shapes and all fallbacks. |
| `artifacts/studio/src/__tests__/mutationErrorSurface.test.ts` | Source-reading guard: every `.mutate(` in `Workspace.tsx` has an `onError`. |
| `artifacts/api-server/src/migrations/roundOverridePrecision.ts` | The FU-2 backfill, with the band-crossing guard and a real dry run. |
| `artifacts/api-server/src/migrations/__tests__/roundOverridePrecision.test.ts` | Idempotency, band-crossing refusal, dry-run-writes-nothing. |

**Modified:**

| File | Change |
|---|---|
| `artifacts/api-server/src/registry/modelRegistry.ts:138` | Return the formatted sentence instead of `result.error.message`. |
| `artifacts/api-server/src/routes/scenarios.ts` (clone handler) | Validate the source row; 422 on failure. |
| `artifacts/studio/src/pages/Workspace.tsx` | 9 `onError` handlers; `missingRequiredInputs` derivation. |
| `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx` | New prop + the skipped-row notice. |
| `artifacts/studio/src/components/workspace/DirtyNavPrompt.tsx:54` | Route through `describeWriteError`. |
| `artifacts/studio/src/hooks/useDistanceDraft.ts:194` | No-op guard inside `commit()`. |
| `artifacts/api-server/src/services/import.ts:1095,1190,1283` | Wrap `fromDisplay` in `roundForFile`. |

---

## Task 1: Server-side issue formatter, wired into the chokepoint

**Files:**
- Create: `artifacts/api-server/src/validation/formatInputIssues.ts`
- Create: `artifacts/api-server/src/validation/__tests__/formatInputIssues.test.ts`
- Modify: `artifacts/api-server/src/registry/modelRegistry.ts:131-141`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function formatInputIssues(issues: z.ZodIssue[]): string` and `export const INPUT_FIELD_LABELS: Record<string, string>`. Task 4 calls `formatInputIssues`. Task 2's client helper consumes its *output* over the wire, not the function.

This is one task, not two: the formatter alone changes nothing, and wiring it is the observable contract change. Splitting them would leave a commit with dead code.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/validation/__tests__/formatInputIssues.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { formatInputIssues, INPUT_FIELD_LABELS } from "../formatInputIssues.js";
import { maxCoverageInputsSchema } from "../inputs/maxCoverage.js";

/** Build real Zod issues by parsing a real bad payload — never hand-authored
 *  issue objects, which can drift from what Zod actually emits. */
function issuesFor(patch: Record<string, unknown>, drop: string[] = []): z.ZodIssue[] {
  const base: Record<string, unknown> = {
    p: 3, highServiceDistMi: 450, maxDistMi: 3400, avgServiceDistCapMi: 650,
    coverageFloorDemand: 0, gap: 0, timeLimitSec: 120, capacityMode: "none",
    distanceBands: [450, 900, 1800, 3400], warehouseOverrides: [],
    customerOverrides: [], addedWarehouses: [], addedCustomers: [],
    distanceOverrides: [],
  };
  const input = { ...base, ...patch };
  for (const k of drop) delete input[k];
  const r = maxCoverageInputsSchema.safeParse(input);
  if (r.success) throw new Error("fixture is valid — it must fail to produce issues");
  return r.error.issues;
}

describe("formatInputIssues", () => {
  it("names the field and states the rule for a range violation", () => {
    expect(formatInputIssues(issuesFor({ avgServiceDistCapMi: 0 })))
      .toBe("Average service distance cap must be greater than 0.");
  });

  it("turns Zod's bare 'Required' into a sentence naming the field", () => {
    expect(formatInputIssues(issuesFor({}, ["coverageFloorDemand"])))
      .toBe("Coverage floor is required.");
  });

  it("joins multiple issues, preserving schema order", () => {
    const out = formatInputIssues(issuesFor({ avgServiceDistCapMi: 0 }, ["coverageFloorDemand"]));
    expect(out).toContain("Average service distance cap must be greater than 0.");
    expect(out).toContain("Coverage floor is required.");
    expect(out.indexOf("Average service")).toBeLessThan(out.indexOf("Coverage floor"));
  });

  it("carries a cross-field custom message through verbatim", () => {
    expect(formatInputIssues(issuesFor({ highServiceDistMi: 9999 })))
      .toBe("High-service distance must be less than max distance.");
  });

  it("degrades to the raw path for an unmapped field instead of dropping it", () => {
    const fake: z.ZodIssue[] = [
      { code: "custom", message: "must be even", path: ["someFutureField"] } as z.ZodIssue,
    ];
    expect(formatInputIssues(fake)).toBe("someFutureField must be even.");
  });

  it("keeps the index for a nested collection path so the bad row is locatable", () => {
    const fake: z.ZodIssue[] = [
      { code: "custom", message: "must be positive", path: ["distanceOverrides", 2, "distance"] } as z.ZodIssue,
    ];
    expect(formatInputIssues(fake)).toContain("Distance overrides");
    expect(formatInputIssues(fake)).toContain("row 3");
  });

  it("never returns an empty string", () => {
    expect(formatInputIssues([])).toBe("The values could not be saved.");
  });

  // Non-vacuity: a new required field must fail here rather than render a raw
  // path to a student. This is the §9 risk mitigation.
  it("has a label for every required field of every model", async () => {
    const { MODEL_IDS, readManifest } = await import("@workspace/dataset-schema");
    const missing: string[] = [];
    for (const id of MODEL_IDS) {
      const req = (readManifest(id).inputsSchema as { required?: unknown }).required;
      if (!Array.isArray(req)) continue;
      for (const key of req) {
        if (typeof key === "string" && !(key in INPUT_FIELD_LABELS)) missing.push(`${id}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test formatInputIssues
```
Expected: FAIL — `Failed to resolve import "../formatInputIssues.js"`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/validation/formatInputIssues.ts`:

```ts
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
  // two-echelon
  legDistanceOverrides: "Leg distance overrides",
  plantCapabilityOverrides: "Plant capability overrides",
};

/**
 * Zod prefixes its own generic subject onto range messages — "Number must be
 * greater than 0", not "must be greater than 0". Prepending a field label
 * without stripping it yields "Average service distance cap NUMBER must be
 * greater than 0." Verified against the real schema output, not assumed.
 */
const GENERIC_SUBJECT = /^(Number|String|Array|Date|Boolean|Value)\s+/;

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test formatInputIssues
```
Expected: PASS, 8 tests.

**All six single-issue expectations in Step 1 were verified by running the real
schema, not reasoned about** — `maxCoverageInputsSchema.safeParse` was executed
against each bad payload and the formatter above reproduces exactly:

| Input | Zod's raw message | Formatter output |
|---|---|---|
| `avgServiceDistCapMi: 0` | `Number must be greater than 0` | `Average service distance cap must be greater than 0.` |
| `coverageFloorDemand` absent | `Required` | `Coverage floor is required.` |
| `highServiceDistMi: 9999` | `highServiceDistMi must be less than maxDistMi` | `High-service distance must be less than max distance.` |
| `maxDistMi: 0` | `Number must be greater than 0` | `Max distance must be greater than 0.` *(label capitalised as a subject)* |
| bad `distanceOverrides[1]` | `Number must be greater than 0` | `Distance overrides row 2 must be greater than 0.` |
| unmapped `someFutureField` | `must be even` | `someFutureField must be even.` |

So a failure here means the implementation diverged from the code above, **not**
that the expectation is wrong. Fix the implementation; do not weaken the
assertion to `toContain`, and do not edit the expected strings.

- [ ] **Step 5: Wire it into the chokepoint**

In `artifacts/api-server/src/registry/modelRegistry.ts`, add the import and change **only** the `:138` branch:

```ts
import { formatInputIssues } from "../validation/formatInputIssues.js";
```

```ts
export function validateInputs(modelId: string, inputs: unknown): ValidateInputsResult {
  const schema = KNOWN_SCHEMAS[modelId];
  if (!schema) {
    // Already a human sentence, and not a Zod issue list — deliberately NOT
    // routed through formatInputIssues (spec §3.1).
    return { success: false, error: `Unknown model_id: ${modelId}` };
  }
  const result = schema.safeParse(inputs);
  if (!result.success) {
    // Was `result.error.message`, which IS the JSON-stringified issue array —
    // the reason every input-validation 422 in this system carried a raw Zod
    // dump. This is the sole producer of that text, so formatting here fixes
    // create, update, the import/apply path and the bands PATCH at once, with
    // no OpenAPI change and no regenerated client.
    return { success: false, error: formatInputIssues(result.error.issues) };
  }
  return { success: true, data: result.data as Record<string, unknown> };
}
```

- [ ] **Step 6: Prove the 422 body changed, end to end**

Add to `artifacts/api-server/src/__tests__/routes.test.ts` (inside an existing authenticated describe block that already has a `loginAs` helper — follow the neighbouring tests' setup exactly):

```ts
it("a rejected scenario input returns a readable sentence, not a Zod dump", async () => {
  const agent = await loginAs();
  const res = await agent.post("/api/scenarios").send({
    name: "bad", modelId: "max-coverage-us",
    inputs: { p: 3, highServiceDistMi: 450, maxDistMi: 3400, avgServiceDistCapMi: 0,
              coverageFloorDemand: 0, gap: 0, timeLimitSec: 120, capacityMode: "none",
              distanceBands: [450], warehouseOverrides: [], customerOverrides: [],
              addedWarehouses: [], addedCustomers: [], distanceOverrides: [] },
  });
  expect(res.status).toBe(422);
  expect(res.body.error).toBe("Average service distance cap must be greater than 0.");
  // The defect this fixes: the body used to be a JSON array.
  expect(res.body.error).not.toContain("{");
  expect(res.body.error).not.toContain("too_small");
});
```

- [ ] **Step 7: Run the affected suites**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test formatInputIssues routes precheck
```
Expected: PASS. **Some existing tests may assert the old dump** — if any fail, read each one: if it asserted the Zod JSON shape, update it to the new sentence (that is the point of this task); if it asserted something unrelated, you have broken something and must fix the code, not the test. Report every test you changed and why.

- [ ] **Step 8: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "write-feedback" ] || { echo "WRONG BRANCH"; exit 1; }
git add artifacts/api-server/src/validation/formatInputIssues.ts \
        artifacts/api-server/src/validation/__tests__/formatInputIssues.test.ts \
        artifacts/api-server/src/registry/modelRegistry.ts \
        artifacts/api-server/src/__tests__/routes.test.ts
git commit -m "[WF-1] format input-validation 422s as sentences, not Zod dumps"
```

---

## Task 2: Client-side `describeWriteError`

**Files:**
- Create: `artifacts/studio/src/lib/describeWriteError.ts`
- Create: `artifacts/studio/src/__tests__/describeWriteError.test.ts`

**Interfaces:**
- Consumes: Task 1's server output shape (`{ error: string }`), plus the pre-existing `{ error: string, errors: unknown[] }` precheck shape.
- Produces: `export function describeWriteError(err: unknown, fallback?: string): string`. Task 3 and Task 5 call it.

- [ ] **Step 1: Write the failing test**

Create `artifacts/studio/src/__tests__/describeWriteError.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { describeWriteError } from "@/lib/describeWriteError";

/** Shaped like custom-fetch.ts's ApiError: an Error whose `message` carries
 *  the HTTP prefix and whose `data` holds the parsed body. */
function apiError(status: number, data: unknown, message: string): Error {
  const e = new Error(message) as Error & { status: number; data: unknown };
  e.status = status;
  e.data = data;
  return e;
}

describe("describeWriteError", () => {
  it("prefers the server's sentence over the prefixed message", () => {
    const err = apiError(422, { error: "Coverage floor is required." },
      "HTTP 422 Unprocessable Content: Coverage floor is required.");
    expect(describeWriteError(err)).toBe("Coverage floor is required.");
  });

  it("never leaks the HTTP prefix", () => {
    const err = apiError(422, { error: "Coverage floor is required." },
      "HTTP 422 Unprocessable Content: Coverage floor is required.");
    expect(describeWriteError(err)).not.toContain("HTTP 422");
  });

  // The second body shape, found in review. `data.error` alone is a LABEL here
  // and every actual reason lives in `errors`.
  it("renders the network-edit precheck's detail, not just its label", () => {
    const err = apiError(422, {
      error: "Network-edit precheck failed",
      errors: [{ message: "Warehouse ALN is referenced by an override" },
               { message: "Customer C9 does not exist" }],
    }, "HTTP 422 Unprocessable Content: Network-edit precheck failed");
    const out = describeWriteError(err);
    expect(out).toContain("Warehouse ALN is referenced by an override");
    expect(out).toContain("Customer C9 does not exist");
  });

  it("handles precheck errors given as plain strings", () => {
    const err = apiError(422, { error: "Network-edit precheck failed", errors: ["bad lane"] },
      "HTTP 422 …");
    expect(describeWriteError(err)).toContain("bad lane");
  });

  it("ignores an empty errors array and uses the label", () => {
    const err = apiError(422, { error: "Network-edit precheck failed", errors: [] }, "HTTP 422 …");
    expect(describeWriteError(err)).toBe("Network-edit precheck failed");
  });

  it("falls back to a plain Error's message", () => {
    expect(describeWriteError(new Error("Save failed."))).toBe("Save failed.");
  });

  it("uses the caller's fallback for a non-Error", () => {
    expect(describeWriteError({ nope: true }, "Couldn't do that.")).toBe("Couldn't do that.");
  });

  it("has a generic last resort when no fallback is given", () => {
    expect(describeWriteError(null)).toBe("Something went wrong. Please try again.");
  });

  it("does not surface a raw JSON dump even if the server somehow sends one", () => {
    const err = apiError(422, { error: '[{"code":"too_small","path":["x"]}]' }, "HTTP 422 …");
    expect(describeWriteError(err)).toBe("Something went wrong. Please try again.");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter studio test describeWriteError
```
Expected: FAIL — cannot resolve `@/lib/describeWriteError`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/studio/src/lib/describeWriteError.ts`:

```ts
const GENERIC = "Something went wrong. Please try again.";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** A server message we can show a student. Rejects anything that looks like a
 *  serialised structure — belt and braces, since the formatter is supposed to
 *  make this unreachable. */
function usableSentence(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "") return null;
  if (t.startsWith("{") || t.startsWith("[")) return null;
  return t;
}

function detailFrom(errors: unknown): string | null {
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const parts = errors
    .map(e => usableSentence(e) ?? usableSentence(asRecord(e)?.message))
    .filter((s): s is string => s !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Turns a mutation rejection into one sentence fit for a toast.
 *
 * Reads `ApiError.data` rather than `.message`, because custom-fetch.ts's
 * buildErrorMessage prefixes the message with "HTTP <status> <statusText>: ".
 * Reading `.data` avoids that prefix entirely instead of stripping it, so
 * there is no regex to drift.
 *
 * Two server body shapes are handled: `{ error }` (every input-validation
 * 422, formatted server-side) and `{ error, errors[] }` (the network-edit
 * precheck, where `error` is only a label and the reasons are in `errors`).
 */
export function describeWriteError(err: unknown, fallback: string = GENERIC): string {
  const data = asRecord(asRecord(err)?.data);
  if (data) {
    const detail = detailFrom(data.errors);
    const label = usableSentence(data.error);
    if (detail && label) return `${label}: ${detail}`;
    if (detail) return detail;
    if (label) return label;
  }
  if (err instanceof Error) {
    const m = usableSentence(err.message);
    // A bare Error (not an ApiError) carries no HTTP prefix, so it is usable;
    // an ApiError's message would have been handled by the `data` branch above.
    if (m && !m.startsWith("HTTP ")) return m;
  }
  return fallback;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter studio test describeWriteError
```
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "write-feedback" ] || { echo "WRONG BRANCH"; exit 1; }
git add artifacts/studio/src/lib/describeWriteError.ts artifacts/studio/src/__tests__/describeWriteError.test.ts
git commit -m "[WF-2] add describeWriteError, handling both 422 body shapes"
```

---

## Task 3: Every mutation site surfaces its failure

**Files:**
- Modify: `artifacts/studio/src/pages/Workspace.tsx` — nine `.mutate(` sites
- Modify: `artifacts/studio/src/components/workspace/DirtyNavPrompt.tsx:54`
- Create: `artifacts/studio/src/__tests__/mutationErrorSurface.test.ts`
- Modify: `artifacts/studio/src/__tests__/Workspace.test.tsx`

**Interfaces:**
- Consumes: `describeWriteError` from Task 2.
- Produces: nothing new for later tasks.

This is one task because D1 is "everywhere" — a partial adoption leaves the exact divergence the project exists to end.

The nine sites and the title each gets:

| Line | Handler | Toast title |
|---|---|---|
| 2077 | `saveWholeInputsAsync` | *(keeps rejecting — its callers surface it)* |
| 2138 | `handleSaveBandsOnly` | `Couldn't save the distance bands` |
| 2699 | `handleCreateConfirm` | `Couldn't create the scenario` |
| 2715 | `handleCloneScenario` | `Couldn't duplicate the scenario` |
| 2730 | `handleDeleteScenario` | `Couldn't delete the scenario` |
| 2767 | `handleRenameScenario` | `Couldn't rename the scenario` |
| 2863 | `enqueueSolve` | `Solve failed to start` *(existing title, kept)* |
| 2946 | `handleSolve` | `Couldn't save your changes` *(existing title, kept)* |
| 3122 | `handleSaveAsScenario` | `Couldn't save as a new scenario` |

- [ ] **Step 1: Write the failing guard test**

Create `artifacts/studio/src/__tests__/mutationErrorSurface.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A source-reading guard, in the style of the api-server's
 * maxCoverageWriteGuard.test.ts. The defect this project fixes arose because
 * six of nine mutation call sites had no onError; the tenth site added later
 * is how it would recur, and no behavioural test can see a handler that was
 * never written.
 */
const SRC = resolve(__dirname, "../pages/Workspace.tsx");

describe("Workspace mutation error surface", () => {
  it("every .mutate( call site has an onError before the next one begins", () => {
    const src = readFileSync(SRC, "utf8");
    const lines = src.split("\n");
    // Ignore commented-out code so a `// foo.mutate(` note is not an offender.
    const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);
    const sites = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /\.mutate(Async)?\(/.test(line) && isCode(line));

    const offenders: string[] = [];
    sites.forEach(({ line, i }, n) => {
      // Scope each site's window to where the NEXT site starts, so a
      // neighbour's handler can never be mistaken for this one's. A fixed
      // line count cannot do this: the real gaps between these sites range
      // from 4 to over 700 lines.
      const end = n + 1 < sites.length ? sites[n + 1].i : lines.length;
      const own = lines.slice(i, end).join("\n");
      if (!/onError\s*:/.test(own)) offenders.push(`${SRC}:${i + 1} — ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });

  it("is not vacuous — it really finds the mutate sites", () => {
    const src = readFileSync(SRC, "utf8");
    const count = (src.match(/\.mutate(Async)?\(/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(9);
  });

  it("no handler shows a raw error message instead of describeWriteError", () => {
    const src = readFileSync(SRC, "utf8");
    // The three pre-existing extractions all used `err.message`, which carries
    // buildErrorMessage's "HTTP 422 …" prefix plus the raw body.
    expect(src).not.toMatch(/err instanceof Error \? err\.message/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter studio test mutationErrorSurface
```
Expected: FAIL — the first test lists six offenders (2138, 2699, 2715, 2730, 2767, 3122) and the third matches two `err.message` extractions.

- [ ] **Step 3: Add the import and fix the three leaking extractions**

In `artifacts/studio/src/pages/Workspace.tsx`, next to the existing `import { toast } from "@/hooks/use-toast";` (line 96):

```ts
import { describeWriteError } from "@/lib/describeWriteError";
```

Replace `:2868` (in `enqueueSolve`):

```ts
const message = describeWriteError(err, "Could not enqueue the solve. Try again.");
```

Replace `:2975` (in `handleSolve`):

```ts
const message = describeWriteError(err, "The scenario was not solved — fix the invalid input and try again.");
```

In `artifacts/studio/src/components/workspace/DirtyNavPrompt.tsx`, add the import and replace `:54`:

```ts
import { describeWriteError } from "@/lib/describeWriteError";
```

```ts
    } catch (e) {
      // Was `e.message`, which is ApiError's buildErrorMessage output — so
      // this dialog rendered "HTTP 422 Unprocessable Content: [{"code":…}]"
      // inline to the student. describeWriteError reads the parsed body
      // instead.
      setError(describeWriteError(e, "Save failed. Try again."));
    } finally {
```

- [ ] **Step 4: Add `onError` to the six silent sites**

For each, add an `onError` to the existing options object. `handleSaveBandsOnly` (`:2138`):

```ts
        onError: err => {
          toast({
            title: "Couldn't save the distance bands",
            description: describeWriteError(err),
            variant: "destructive",
          });
        },
```

Apply the same shape at `:2699`, `:2715`, `:2730`, `:2767` and `:3122`, using that site's title from the table above. Where a site already has an `onSuccess` that navigates or closes a dialog, leave it untouched — only add `onError`.

- [ ] **Step 5: Run the guard to verify it passes**

```bash
pnpm --filter studio test mutationErrorSurface
```
Expected: PASS, 3 tests.

- [ ] **Step 6: Add a behavioural test that drives `onError`**

The guard proves a handler exists; this proves it reaches the student. Add to `artifacts/studio/src/__tests__/Workspace.test.tsx`, following the file's existing mock setup:

```ts
describe("Workspace — write failures reach the student", () => {
  it("a 422 on the toolbar Save shows the server's sentence in a toast", async () => {
    const apiErr = Object.assign(new Error("HTTP 422 Unprocessable Content: Coverage floor is required."), {
      status: 422, data: { error: "Coverage floor is required." },
    });
    // Drive the real onError the component registered — the three pre-existing
    // strip tests only ever asserted the request BODY and never invoked a
    // callback, which is exactly how this defect survived 2293 tests.
    mockUpdateScenario.mutate.mockImplementation((_vars, opts) => opts?.onError?.(apiErr));

    renderWorkspace();                       // existing helper in this file
    await userEvent.click(await screen.findByTestId("button-save"));

    expect(await screen.findByText("Coverage floor is required.")).toBeInTheDocument();
    expect(screen.queryByText(/HTTP 422/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the studio suite**

```bash
ps aux | grep "[v]itest" | grep -v "zsh -c"      # read the rows; require none
pnpm --filter studio test
```
Do **not** chain the process check with `&&` — `grep -c` exits 1 when the count is 0, so the success case short-circuits.

Expected: all files pass. This suite is load-flaky: if files you never touched fail with `Test timed out in 5000ms`, drain lingering `node (vitest N)` workers and re-run before concluding anything. Report real counts.

- [ ] **Step 8: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "write-feedback" ] || { echo "WRONG BRANCH"; exit 1; }
git add artifacts/studio/src/pages/Workspace.tsx \
        artifacts/studio/src/components/workspace/DirtyNavPrompt.tsx \
        artifacts/studio/src/__tests__/mutationErrorSurface.test.ts \
        artifacts/studio/src/__tests__/Workspace.test.tsx
git commit -m "[WF-3] surface every write failure through describeWriteError"
```

---

## Task 4: Clone validates and rejects

**Files:**
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (the clone handler, around `:1979-1992`)
- Modify: `artifacts/api-server/src/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `validateInputsForModel` (existing), and Task 1's formatted error via `validation.error`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing tests**

Add to `artifacts/api-server/src/__tests__/routes.test.ts`:

```ts
describe("POST /api/scenarios/:id/clone — validation", () => {
  it("422s when the source row's inputs are invalid, instead of copying them", async () => {
    const agent = await loginAs();
    // Write a kilometre-era shaped row directly, the way a pre-migration row
    // looks — the production writer can no longer produce this, which is the
    // point: clone is how such a row propagates.
    const id = await insertScenarioRow(agent, {
      modelId: "max-coverage-us",
      inputs: { p: 3, highServiceDistKm: 700, maxDistKm: 5500, gap: 0, timeLimitSec: 120,
                capacityMode: "none", distanceBands: [700], warehouseOverrides: [],
                customerOverrides: [], addedWarehouses: [], addedCustomers: [],
                distanceOverrides: [] },
    });
    const res = await agent.post(`/api/scenarios/${id}/clone`).send({ name: "copy" });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("required");
    expect(res.body.error).not.toContain("{");
  });

  it("still clones a valid source row", async () => {
    const agent = await loginAs();
    const id = await createValidMaxCoverageScenario(agent);   // existing helper
    const res = await agent.post(`/api/scenarios/${id}/clone`).send({ name: "copy" });
    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(id);
  });

  // Ownership must still win, or a 422 becomes an existence oracle.
  it("404s for a non-owned source even when its inputs are invalid", async () => {
    const owner = await loginAs();
    const id = await insertScenarioRow(owner, {
      modelId: "max-coverage-us",
      inputs: { p: 3, highServiceDistKm: 700, maxDistKm: 5500, gap: 0, timeLimitSec: 120,
                capacityMode: "none", distanceBands: [700], warehouseOverrides: [],
                customerOverrides: [], addedWarehouses: [], addedCustomers: [],
                distanceOverrides: [] },
    });
    const stranger = await loginAs();      // a different user
    const res = await stranger.post(`/api/scenarios/${id}/clone`).send({ name: "copy" });
    expect(res.status).toBe(404);
  });
});
```

If `insertScenarioRow` and `createValidMaxCoverageScenario` do not exist in that file under those names, find the equivalent helpers it already uses and use those — do not add new helpers if one exists.

- [ ] **Step 2: Run to verify it fails**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test routes
```
Expected: FAIL — the first test gets 201 (the invalid row is copied); the third already passes.

- [ ] **Step 3: Add the validation, AFTER the ownership lookup**

In the clone handler, after the source row is fetched and ownership has resolved (the existing 404 path), and **before** the insert:

```ts
  // Clone is the fourth write path and was the only unvalidated one, so a
  // kilometre-era row could be duplicated into a fresh row that can never be
  // saved or solved. Placed AFTER the ownership lookup on purpose: a 422 here
  // must only be reachable once the caller is known to own the row, or it
  // would leak existence (hard rule #5 — 404, never 403).
  const validation = validateInputsForModel(source.modelId, source.inputs);
  if (!validation.success) {
    res.status(422).json({ error: validation.error });
    return;
  }
```

Do **not** change `deriveServerOwnedInputs`' pass-through behaviour — the validator rejects first, so it is never reached with a broken row.

- [ ] **Step 4: Run to verify it passes**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test routes
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "write-feedback" ] || { echo "WRONG BRANCH"; exit 1; }
git add artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/__tests__/routes.test.ts
git commit -m "[WF-4] validate the source row on clone, after the ownership check"
```

---

## Task 5: The migration-skipped-row notice

**Files:**
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx`
- Modify: `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a new optional prop `missingRequiredInputs?: string[]` on `OptimizationParametersTabProps`.

**Read this before starting.** Do **not** gate the notice on `highServiceDistMi != null` (`:293`). That guard is a **model discriminator** — its own comment says the section is "present only for Chen", and the component gates on *value presence, never on `modelId`*, three times over. Reusing it would render the notice on every p-median, transport and JADE scenario. The notice is derived from the manifest's `inputsSchema.required[]`, computed by the caller.

- [ ] **Step 1: Write the failing tests**

Add to `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`:

```ts
describe("OptimizationParametersTab — missing required inputs", () => {
  it("explains the problem when required inputs are absent", () => {
    renderTab({ missingRequiredInputs: ["highServiceDistMi", "coverageFloorDemand"] });
    const notice = screen.getByTestId("missing-required-inputs");
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent(/cannot be saved or solved/i);
    expect(notice).toHaveTextContent("High-service distance");
    expect(notice).toHaveTextContent("Coverage floor");
  });

  it("renders nothing when the array is empty", () => {
    renderTab({ missingRequiredInputs: [] });
    expect(screen.queryByTestId("missing-required-inputs")).not.toBeInTheDocument();
  });

  it("renders nothing when the prop is omitted — every other model's case", () => {
    renderTab({});
    expect(screen.queryByTestId("missing-required-inputs")).not.toBeInTheDocument();
  });

  it("still renders the fields that ARE intact", () => {
    renderTab({ missingRequiredInputs: ["highServiceDistMi"], gap: 0, timeLimitSec: 120 });
    expect(screen.getByTestId("missing-required-inputs")).toBeVisible();
    expect(screen.getByTestId("input-gap")).toBeInTheDocument();
  });
});
```

`renderTab` is this file's existing render helper — extend its props type rather than writing a new helper. If its testids differ from `input-gap`, use the real ones.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter studio test OptimizationParametersTab
```
Expected: FAIL — no `missing-required-inputs` testid.

- [ ] **Step 3: Add the prop and the notice**

In `OptimizationParametersTabProps`:

```ts
  /** Required inputs this scenario's row is missing, as manifest key names.
   * Computed by the caller from the model's own `inputsSchema.required[]`
   * (Workspace.tsx) — NOT derived here from a field's presence, because
   * presence cannot distinguish "this model has no such field" from "this
   * model needs it and the row lacks it". Empty or omitted for every healthy
   * scenario of every model. */
  missingRequiredInputs?: string[];
```

Add a label map and the notice. Place the notice at the top of the returned `<div>`, before the P section, so it is the first thing read:

```tsx
const MISSING_INPUT_LABELS: Record<string, string> = {
  p: "Number of warehouses",
  highServiceDistMi: "High-service distance",
  maxDistMi: "Max distance",
  avgServiceDistCapMi: "Average service distance cap",
  coverageFloorDemand: "Coverage floor",
  gap: "MIP gap",
  timeLimitSec: "Time limit",
  capacityMode: "Capacity mode",
  distanceBands: "Distance bands",
};
```

```tsx
      {missingRequiredInputs !== undefined && missingRequiredInputs.length > 0 && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
          data-testid={tid("missing-required-inputs")}
        >
          <p className="font-medium text-destructive">This scenario is missing required values</p>
          <p className="mt-1 text-muted-foreground">
            {missingRequiredInputs.map(k => MISSING_INPUT_LABELS[k] ?? k).join(", ")}
            {" "}— it cannot be saved or solved until they are restored. Contact your instructor.
          </p>
        </div>
      )}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter studio test OptimizationParametersTab
```
Expected: PASS.

- [ ] **Step 5: Compute the prop in `Workspace.tsx`**

Where the active model's `ModelInfo` is already available, add:

```ts
  // The manifest's own `inputsSchema.required[]` is the authority, and it is
  // already served on /api/models — verified against production: all nine
  // Chapter 4 keys arrive intact. But the generated type is
  // `ModelInfoInputsSchema = { [key: string]: unknown }` (the OpenAPI schema
  // calls inputsSchema "opaque to this contract"), so this is a GUARDED read
  // that fails closed: an unreadable manifest renders no notice rather than a
  // scary one.
  const missingRequiredInputs = useMemo<string[]>(() => {
    if (!localInputs) return [];
    const req = (activeModelManifest?.inputsSchema as { required?: unknown } | undefined)?.required;
    if (!Array.isArray(req)) return [];
    const values = localInputs as Record<string, unknown>;
    return req.filter((k): k is string => {
      if (typeof k !== "string") return false;
      // By VALUE, not key presence: `in` treats a present-but-null key as
      // fine, and a required input whose value is null is just as unusable.
      // NOTE the parentheses matter — `&&` binds tighter than `||`, so
      // `typeof k === "string" && v === undefined || v === null` returns true
      // for a NON-string key whose value is null, making the `k is string`
      // predicate a lie. Written as statements so the precedence cannot be
      // got wrong again.
      return values[k] === undefined || values[k] === null;
    });
  }, [activeModelManifest, localInputs]);
```

Pass `missingRequiredInputs={missingRequiredInputs}` at the `OptimizationParametersTab` render site. `activeModelManifest` already exists at `Workspace.tsx:1454` (`models?.find(m => m.id === modelId)`, from `useListModels()`) — do not add a second lookup.

- [ ] **Step 6: Prove it does not misfire for another model**

Add to `artifacts/studio/src/__tests__/Workspace.test.tsx`:

```ts
it("shows no missing-inputs notice for a p-median scenario with no Chapter 4 fields", async () => {
  renderWorkspace({ modelId: "p-median-us" });   // existing helper's option
  await screen.findByTestId("workspace-page");
  expect(screen.queryByTestId("missing-required-inputs")).not.toBeInTheDocument();
});
```

This is the regression that the rejected design would have failed.

- [ ] **Step 7: Run both suites**

```bash
pnpm --filter studio test OptimizationParametersTab Workspace
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "write-feedback" ] || { echo "WRONG BRANCH"; exit 1; }
git add artifacts/studio/src/pages/Workspace.tsx \
        artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx \
        artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx \
        artifacts/studio/src/__tests__/Workspace.test.tsx
git commit -m "[WF-5] explain a row missing required inputs, derived from the manifest"
```

---

## Task 6: Draft no-op guard inside `commit()`

**Files:**
- Modify: `artifacts/studio/src/hooks/useDistanceDraft.ts:194-208`
- Modify: `artifacts/studio/src/__tests__/useDistanceDraft.test.ts` — **it already exists**; add to it, and read its existing cases first so the new ones match its setup.

**Interfaces:**
- Consumes: `roundForFile` — **already imported** at `useDistanceDraft.ts:2` (`import { roundForFile, type CanonicalUnit } from "@workspace/units";`). No new import needed.
- Produces: no signature change — `commit()` keeps its shape; only whether it calls `onCommit` changes.

- [ ] **Step 1: Write the failing tests**

```tsx
describe("useDistanceDraft — no-op commits", () => {
  it("does not call onCommit when the typed value is unchanged at display precision", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDistanceDraft({
      value: 650, canonicalUnit: "mi", onCommit,
    }));
    act(() => result.current.onChange("650"));
    act(() => result.current.commit());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("still calls onCommit for a real change", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDistanceDraft({
      value: 650, canonicalUnit: "mi", onCommit,
    }));
    act(() => result.current.onChange("700"));
    act(() => result.current.commit());
    expect(onCommit).toHaveBeenCalledWith(700);
  });

  it("clears the draft even when the commit is a no-op, so the field re-formats", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDistanceDraft({
      value: 650, canonicalUnit: "mi", onCommit,
    }));
    act(() => result.current.onChange("650"));
    act(() => result.current.commit());
    expect(result.current.isDirty).toBe(false);
  });
});
```

The hook's real option names may differ — read its signature and match it exactly rather than guessing.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter studio test useDistanceDraft
```
Expected: FAIL on the first test — `onCommit` was called with 650.

- [ ] **Step 3: Add the guard**

In `commit()`, change only the `onCommit` call:

```ts
    if (isComplete(draft.text) && !Number.isNaN(draft.anchor)) {
      // FU-6 — compare in DISPLAY space at roundForFile's 4 dp, the rule
      // artifacts/studio/CLAUDE.md prescribes. commit() fires for every
      // grammar-complete draft, so focusing a field, retyping the identical
      // displayed text and blurring used to commit e.g.
      // 650 -> 650.0000000000001: the scenario flipped dirty and a band
      // retargeted to a float. Guarded HERE rather than in each caller
      // because 15 call sites share this hook and an eleventh bespoke guard
      // would make the consolidation harder.
      if (roundForFile(draft.anchor) !== roundForFile(value)) onCommit(draft.anchor);
    }
    setDraft(null);
```

`setFocused(false)` before the early return and `setDraft(null)` after stay exactly as they are — the hook's own comments record both as load-bearing.

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter studio test useDistanceDraft
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Run every suite that touches a draft field**

```bash
pnpm --filter studio test DistancesTab JadeDistancesTab OptimizationParametersTab useDistanceDraft
```
Expected: PASS. A test that asserted a no-op commit *did* fire is now wrong and should be updated; report any you change.

- [ ] **Step 6: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "write-feedback" ] || { echo "WRONG BRANCH"; exit 1; }
git add artifacts/studio/src/hooks/useDistanceDraft.ts artifacts/studio/src/__tests__/useDistanceDraft.test.ts
git commit -m "[WF-6] skip a draft commit that is a no-op at display precision"
```

---

## Task 7: Round converted values on import

**Files:**
- Modify: `artifacts/api-server/src/services/import.ts:1095,1190,1283`
- Modify: `artifacts/api-server/src/__tests__/import.test.ts`

**Interfaces:**
- Consumes: `roundForFile` from `@workspace/units` (already imported in this file? check — add the import if not).
- Produces: nothing for later tasks.

All three sites are distances. The lane-cost one looks like the rate-vs-distance mistake this repo documents and is **not**: `templates.ts:1172-1178` states transport-coal's lane "cost" *is* literally geographic miles, which is why its export already does `roundForFile(toDisplay(...))`.

- [ ] **Step 1: Write the failing test**

```ts
it("a km-sourced distance import stores the value rounded to 4 dp", async () => {
  const agent = await loginAs();
  const id = await createValidPMedianScenario(agent);
  // 10 km in miles is 6.2137119223733395 — full precision used to be stored,
  // while export emits roundForFile's 6.2137, so re-importing an untouched
  // export flagged a change nobody made.
  const csv = "template_version,unit,from_id,to_id,distance\n2,km,ALN,C1,10\n";
  await agent.post(`/api/scenarios/${id}/import?entity=distances`).attach("file", Buffer.from(csv), "d.csv");
  const row = await agent.get(`/api/scenarios/${id}`);
  const stored = row.body.inputs.distanceOverrides.find((o: { toId: string }) => o.toId === "C1");
  expect(stored.distance).toBe(6.2137);
});

it("re-importing an unmodified export detects no change", async () => {
  const agent = await loginAs();
  const id = await createValidPMedianScenario(agent);
  const csv = "template_version,unit,from_id,to_id,distance\n2,km,ALN,C1,10\n";
  await agent.post(`/api/scenarios/${id}/import?entity=distances`).attach("file", Buffer.from(csv), "d.csv");
  const exported = await agent.get(`/api/scenarios/${id}/export?entity=distances&format=csv&unit=km`);
  const second = await agent.post(`/api/scenarios/${id}/import?entity=distances&dryRun=true`)
    .attach("file", Buffer.from(exported.text), "d.csv");
  expect(second.body.changes).toEqual([]);
});
```

Use this file's real helper names and the real import/export route shapes — read the neighbouring tests first.

- [ ] **Step 2: Run to verify it fails**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test import
```
Expected: FAIL — stored value is `6.2137119223733395`.

- [ ] **Step 3: Wrap the three sites**

`:1095`:

```ts
    const parsedDistance = hasUnitColumn ? roundForFile(fromDisplay(parsedDistanceRaw, fileUnit, canonicalUnit)) : parsedDistanceRaw;
```

`:1190`:

```ts
    const parsedCost = hasUnitColumn ? roundForFile(fromDisplay(parsedCostRaw, fileUnit, canonicalUnit)) : parsedCostRaw;
```

`:1283`:

```ts
    const parsedDistance = hasUnitColumn ? roundForFile(fromDisplay(parsedDistanceRaw, fileUnit, canonicalUnit)) : parsedDistanceRaw;
```

Leave the `!==` comparisons at `:1102`, `:1193`, `:1286` exactly as they are — once both sides are 4 dp, exact comparison is correct.

Add a comment above the first one:

```ts
    // FU-2 (D5) — export emits roundForFile's 4 dp, so storing full precision
    // made a re-import of an untouched export report a changed row. Rounding
    // here makes stored == exported. Accepted cost: the canonical value is
    // lossy at 4 dp (10 km stores as 6.2137, not 6.2137119223733395).
```

- [ ] **Step 4: Run to verify it passes**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test import importMultiModelRoundTrip
```
Expected: PASS. `importMultiModelRoundTrip` may assert full-precision stored values — if so, update those expectations to 4 dp and say which, since that is this task's intended change.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "write-feedback" ] || { echo "WRONG BRANCH"; exit 1; }
git add artifacts/api-server/src/services/import.ts artifacts/api-server/src/__tests__/import.test.ts
git commit -m "[WF-7] round unit-converted values on import to match export"
```

---

## Task 8: The precision backfill, with a band-crossing guard

**Files:**
- Create: `artifacts/api-server/src/migrations/roundOverridePrecision.ts`
- Create: `artifacts/api-server/src/migrations/__tests__/roundOverridePrecision.test.ts`
- Modify: `artifacts/api-server/package.json` (add the script)
- Modify: `docs/ops/ch4-miles-migration-runbook.md` (a new section)

**Interfaces:**
- Consumes: `roundForFile`; the `scenarios` Drizzle table; `migrateAll`'s scenario-id-filter pattern from `ch4ToMiles.ts`.
- Produces: `export interface RoundReport { rounded: number[]; refused: Array<{ id: number; reason: string }>; alreadyRounded: number[]; dryRun: boolean }` and `export async function roundAll(db, dryRun: boolean, scenarioIds?: number[]): Promise<RoundReport>`.

Read `artifacts/api-server/src/migrations/ch4ToMiles.ts` first and follow its structure: an optional id filter, a real dry run that writes nothing, and a report that names what it touched. Two deliberate differences from it: this one does **not** clear `result` and does **not** bump the solve epoch, and it **refuses** rows rather than converting them when a value would cross a band boundary.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { roundAll } from "../roundOverridePrecision.js";

describe("roundOverridePrecision", () => {
  it("rounds an over-precise override to 4 dp", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200, 400, 800, 1600],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 6.2137119223733395 }] });
    const report = await roundAll(db, false, [id]);
    expect(report.rounded).toEqual([id]);
    expect(await storedDistance(id, "C1")).toBe(6.2137);
  });

  it("is idempotent — a second run reports alreadyRounded and writes nothing", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 6.2137119223733395 }] });
    await roundAll(db, false, [id]);
    const second = await roundAll(db, false, [id]);
    expect(second.rounded).toEqual([]);
    expect(second.alreadyRounded).toEqual([id]);
  });

  // 450.00004 rounds DOWN to exactly 450.0, moving the value from the overflow
  // bucket INTO the 450 band — a real membership change. Do NOT use 449.99996
  // here: it rounds UP to 450.0 but is <= 450 both before and after, so
  // membership does not change and the guard correctly ignores it. That value
  // was this plan's original fixture and would have made this test fail.
  it("REFUSES a row whose value would change which band it is reported in", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [450],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 450.00004 }] });
    const report = await roundAll(db, false, [id]);
    expect(report.rounded).toEqual([]);
    expect(report.refused).toHaveLength(1);
    expect(report.refused[0]).toMatchObject({ id });
    expect(report.refused[0].reason).toContain("450");
    // Refused means UNCHANGED, not partially written.
    expect(await storedDistance(id, "C1")).toBe(450.00004);
  });

  it("does NOT refuse a value that rounds onto a boundary from inside the band", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [450],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 449.99996 }] });
    const report = await roundAll(db, false, [id]);
    // 449.99996 and 450.0 are both within the 450 band, so nothing is reported
    // differently and the row is safe to round. This pins the guard against the
    // interval-based implementation, which would have refused it.
    expect(report.refused).toEqual([]);
    expect(report.rounded).toEqual([id]);
    expect(await storedDistance(id, "C1")).toBe(450);
  });

  it("does NOT clear result or bump the solve epoch on a row it rounds", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 6.2137119223733395 }],
      result: { status: "optimal" }, solveInputRevision: 7 });
    await roundAll(db, false, [id]);
    const row = await readRow(id);
    expect(row.result).not.toBeNull();
    expect(row.solveInputRevision).toBe(7);
    expect(row.solvedAt).not.toBeNull();
  });

  it("a dry run reports what it WOULD do and writes nothing", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 6.2137119223733395 }] });
    const report = await roundAll(db, true, [id]);
    expect(report.dryRun).toBe(true);
    expect(report.rounded).toEqual([id]);
    expect(await storedDistance(id, "C1")).toBe(6.2137119223733395);
  });

  it("an empty id filter touches nothing", async () => {
    const report = await roundAll(db, false, []);
    expect(report.rounded).toEqual([]);
    expect(report.refused).toEqual([]);
  });
});
```

Follow `migrateAllIntegration.test.ts`'s real-Postgres setup and its seeding/teardown helpers; reuse them rather than inventing `seedScenario`/`storedDistance`/`readRow` if equivalents exist.

- [ ] **Step 2: Run to verify it fails**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test roundOverridePrecision
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { eq, inArray } from "drizzle-orm";
import { roundForFile } from "@workspace/units";
import { scenarios } from "@workspace/db";

export interface RoundReport {
  rounded: number[];
  refused: Array<{ id: number; reason: string }>;
  alreadyRounded: number[];
  dryRun: boolean;
}

interface Override { fromId: string; toId: string; distance?: number; cost?: number; [k: string]: unknown }

const OVERRIDE_FIELDS = [
  { key: "distanceOverrides", value: "distance" },
  { key: "laneCostOverrides", value: "cost" },
  { key: "legDistanceOverrides", value: "distance" },
] as const;

/**
 * The first band at or above `v`, i.e. the band `v` is reported in. Bands are
 * UPPER BOUNDS ("within 450 mi"), so `<=`. `null` is the overflow bucket.
 */
function bandOf(v: number, bands: number[]): number | null {
  return [...bands].sort((a, b) => a - b).find(b => v <= b) ?? null;
}

/**
 * Does rounding `v` change which band it is REPORTED IN?
 *
 * Membership, not an interval. An interval test (`min < band <= max`) is wrong
 * in both directions and was corrected here after being checked:
 *   - 449.99996 -> 450.0 : interval says "crosses 450"; membership says NO,
 *     because both are <= 450 and therefore both inside that band. False
 *     positive, and it was this plan's original test fixture.
 *   - 450.00004 -> 450.0 : interval says nothing; membership says YES — the
 *     value moves from the overflow bucket INTO the 450 band. This is the real
 *     case and the interval test missed it.
 */
function crossesBand(v: number, bands: number[]): { from: number | null; to: number | null } | null {
  const r = roundForFile(v);
  if (r === v) return null;
  const before = bandOf(v, bands);
  const after = bandOf(r, bands);
  return before === after ? null : { from: before, to: after };
}

/**
 * Rounds over-precise override values to roundForFile's 4 dp so stored ==
 * exported (FU-2, D5). Deliberately does NOT clear `result` or bump the solve
 * epoch: distance bands are a reporting lens, not model constraints, so a
 * rounded value changes no solve — PROVIDED it does not cross a band
 * boundary, which would change `result.metrics.bandCoverage` in the cached
 * envelope and make it disagree with a client-side recompute. Such a row is
 * REFUSED and reported rather than decided for the operator, because the
 * choice between a changed band attribution and forcing a re-solve of a
 * student's saved work is theirs.
 */
export async function roundAll(
  db: typeof import("@workspace/db")["db"],
  dryRun: boolean,
  scenarioIds?: number[],
): Promise<RoundReport> {
  const report: RoundReport = { rounded: [], refused: [], alreadyRounded: [], dryRun };
  if (scenarioIds && scenarioIds.length === 0) return report;

  const rows = scenarioIds
    ? await db.select().from(scenarios).where(inArray(scenarios.id, scenarioIds))
    : await db.select().from(scenarios);

  for (const row of rows) {
    const inputs = row.inputs as Record<string, unknown> | null;
    if (!inputs) continue;
    const bands = Array.isArray(inputs.distanceBands)
      ? (inputs.distanceBands as unknown[]).filter((b): b is number => typeof b === "number")
      : [];

    let changed = false;
    let refusal: string | null = null;
    const next: Record<string, unknown> = { ...inputs };

    for (const { key, value } of OVERRIDE_FIELDS) {
      const list = inputs[key];
      if (!Array.isArray(list)) continue;
      const updated = (list as Override[]).map(o => {
        const v = o[value];
        if (typeof v !== "number") return o;
        const r = roundForFile(v);
        if (r === v) return o;
        const moved = crossesBand(v, bands);
        if (moved !== null) {
          refusal = `${key}[${o.fromId}->${o.toId}] ${v} rounds to ${r}, moving it from band ${moved.from ?? "overflow"} to band ${moved.to ?? "overflow"}`;
          return o;
        }
        changed = true;
        return { ...o, [value]: r };
      });
      next[key] = updated;
    }

    if (refusal) { report.refused.push({ id: row.id, reason: refusal }); continue; }
    if (!changed) { report.alreadyRounded.push(row.id); continue; }
    report.rounded.push(row.id);
    if (dryRun) continue;
    // NOTE: `inputs` only. No result/solvedAt/solveInputRevision/
    // inputsUpdatedAt change — see the header comment.
    await db.update(scenarios).set({ inputs: next }).where(eq(scenarios.id, row.id));
  }

  return report;
}

async function main(): Promise<void> {
  const { db } = await import("@workspace/db");
  const dryRun = process.argv.includes("--dry-run");
  const report = await roundAll(db, dryRun);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
```

Check `ch4ToMiles.ts` for how it imports `db` and runs as a script, and match it — including whether it uses a `main()` guard of this shape.

- [ ] **Step 4: Run to verify it passes**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test roundOverridePrecision
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the script**

In `artifacts/api-server/package.json`, beside `migrate-ch4-to-miles`:

```json
    "round-override-precision": "tsx ./src/migrations/roundOverridePrecision.ts",
```

- [ ] **Step 6: Dry-run it locally**

```bash
NODE_ENV= DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server run round-override-precision -- --dry-run
```
Expected: valid JSON. Local `nos_dev` has no over-precise rows, so `rounded` should be `[]` and every scenario should appear under `alreadyRounded`. If a row appears under `rounded`, inspect it before going further.

- [ ] **Step 7: Document it in the runbook**

Append a section to `docs/ops/ch4-miles-migration-runbook.md` stating: that it is a **separate** operation needing its own approval; the same `NODE_ENV=production` + `?sslmode=require` + allowlisted-host preconditions as the other commands; that production has **one** affected scenario (id 40, `p-median-us`, two values `6.2137119223733395` and `9.32056788356001`, bands `[200,400,800,1600]`, neither crossing a boundary); that it does **not** clear results or bump the epoch; and that any id under `refused` must be taken to the operator rather than forced.

- [ ] **Step 8: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "write-feedback" ] || { echo "WRONG BRANCH"; exit 1; }
git add artifacts/api-server/src/migrations/roundOverridePrecision.ts \
        artifacts/api-server/src/migrations/__tests__/roundOverridePrecision.test.ts \
        artifacts/api-server/package.json docs/ops/ch4-miles-migration-runbook.md
git commit -m "[WF-8] add the override-precision backfill with a band-crossing guard"
```

---

## Task 9: Close out

**Files:**
- Modify: `docs/CHANGELOG-implementation.md`
- Modify: `CLAUDE.md`, `artifacts/studio/CLAUDE.md`, `artifacts/api-server/CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-10-09-write-failure-feedback-design.md`

- [ ] **Step 1: Run the full gate**

```bash
cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); echo "$cnt"
[ "$cnt" = "0" ] || { echo "NOT QUIET"; exit 1; }
pnpm run typecheck
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
pnpm --filter studio test
(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
```
Expected: all pass; `e2e_accuracy.py` **99/99** and unmodified. Record real numbers; re-run any documented flake twice in isolation before reporting it.

- [ ] **Step 2: Correct the spec**

In §1, replace the claim that Run Optimizer's toast is the correct surface. The true starting state was six silent sites and **three** sites rendering a raw dump (`DirtyNavPrompt.tsx:54`, `Workspace.tsx:2868`, `:2975`) — zero correct. Keep the original wording visible as a correction rather than deleting it.

- [ ] **Step 3: Append the changelog entry**

Record: the task ids and commit SHAs; the gate numbers you measured; that the server fix was one line at the sole producer of validation text; that §4.2's original four-site scope contradicted D1 and the real surface is nine sites of which six were silent; that §6's no-epoch-bump reasoning was withdrawn and replaced with a band-crossing guard after a counterexample (`449.99996 → 450.0`); and that the lane-cost rounding was challenged as a rate-vs-distance error and cleared.

- [ ] **Step 4: Lift the durable rules**

One distilled rule each, placed where the work happens:

- `artifacts/studio/CLAUDE.md` — a mutation's `onError` is not optional; a source-reading guard over the `.mutate(` sites is what keeps it true, because no behavioural test can see a handler that was never written.
- `artifacts/api-server/CLAUDE.md` — a validation error's *text* has one producer; format it there, not at each consumer, and never ship `ZodError.message` to a client (it is the stringified issue array).
- Root `CLAUDE.md` Gotchas — a backfill that changes stored numbers must prove it cannot move a value across a threshold something else derives from, and refuse the row rather than decide for the operator.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "write-feedback" ] || { echo "WRONG BRANCH"; exit 1; }
git add docs/CHANGELOG-implementation.md CLAUDE.md artifacts/studio/CLAUDE.md \
        artifacts/api-server/CLAUDE.md \
        docs/superpowers/specs/2026-10-09-write-failure-feedback-design.md
git commit -m "[WF-9] record the write-failure-feedback work and its durable rules"
```

- [ ] **Step 6: Stop**

Invoke `superpowers:finishing-a-development-branch`, then **stop and ask for merge approval**. Do not merge, push or deploy — each is a separate approval. The production backfill (Task 8) is a further separate approval and must not be bundled with a deploy request.

---

## Self-Review

**Spec coverage:**

| Spec § | Task |
|---|---|
| §3.1 one-line chokepoint + `:134` left alone | 1 |
| §3.2 `formatInputIssues` + label table + no cap | 1 |
| §3.3 clone validates, after ownership | 4 |
| §4.1 `describeWriteError`, both body shapes | 2 |
| §4.2 all nine sites + DirtyNavPrompt | 3 |
| §4.3 notice from `inputsSchema.required[]`, guarded read, by-value absence | 5 |
| §5 draft guard in `commit()` | 6 |
| §6 three import sites | 7 |
| §6.1 backfill + band-crossing guard + no epoch bump | 8 |
| §7 testing (incl. the four review-added tests) | 1, 2, 3, 5, 8 |
| §9 label-coverage risk mitigation | 1 (Step 1's last test) |

**Placeholder scan:** no `TBD`/`TODO`; every code step carries real code; no "similar to Task N". Where a helper name may differ from this plan's guess, the step says to read the file and match it rather than inventing one — that is an instruction, not a placeholder.

**Type consistency:** `formatInputIssues(issues: z.ZodIssue[]): string` and `INPUT_FIELD_LABELS` (Task 1) are used in Tasks 1 and 4. `describeWriteError(err: unknown, fallback?: string): string` (Task 2) is used in Tasks 3 and 5. `missingRequiredInputs?: string[]` (Task 5) is one name throughout. `RoundReport` / `roundAll(db, dryRun, scenarioIds?)` (Task 8) match the test's calls. `roundForFile` is the only rounding authority in Tasks 6, 7 and 8.

**Known risk this plan accepts:** Task 1 Step 7 and Task 7 Step 4 may require updating existing tests that asserted the old behaviour. Both steps say to distinguish "this test asserted the defect" from "I broke something", and to report every test changed. That judgement cannot be pre-resolved here without reading each assertion.
