# Gate proposal: codegen_drift

**Symptom:** `lib/api-spec/openapi.yaml` and the Orval output under
`lib/api-zod/src/generated/` + `lib/api-client-react/src/generated/` drift from
what the server actually emits. The API then violates its own published
contract, and the generated client types reject values the route returns. Hard
rule #1 is breached without anything turning red.

**Occurrences:**

- 2026-09-?? `bundle6.1` — existing row, `gate_proposed` empty.
- 2026-10-09 `CH4O-11` — `COST_SUMMARY_TEMPLATE_VERSION` went to 4 and three
  export columns were added; `openapi.yaml` still declared
  `templateVersion: { enum: [3] }` and an 8-property `required` row with none of
  the new columns. So `api-zod` shipped `zod.literal(3)` and
  `api-client-react` shipped `NUMBER_3: 3`, making the value the route emits
  unassignable to the envelope type it ships. Found by the whole-branch review,
  not by any suite.

**Why the existing coverage missed it (this is the part that matters):** the
schema's *only* consumer in the repo was a contract test that validated a
**hand-built** `{ templateVersion: 3, entity: "costSummary", unit: "km", rows: [] }`.
Two independent reasons it could not fail:

1. The literal `3` **froze the version the test was supposed to be tracking** —
   bumping the emitter could never disagree with a constant the test restated by
   hand.
2. `rows: []` made the three added row properties **unobservable**, because an
   empty collection satisfies every row schema that has ever existed.

And a third, discovered while fixing it: Orval emits plain `zod.object(...)`,
which **strips** unknown keys rather than rejecting them, so even a populated
fixture asserted only with `expect(parsed.success).toBe(true)` would still have
passed against the stale 8-property spec. The assertion has to be that the new
fields **survive** the parse.

**Proposed automated gate — two parts, both needed:**

1. **CI regeneration diff.** A job step that re-runs codegen and fails if the
   working tree changes:

   ```bash
   pnpm --filter @workspace/api-spec run codegen
   git diff --exit-code -- lib/api-zod/src/generated lib/api-client-react/src/generated
   ```

   This catches "spec edited, codegen not re-run" and "generated output
   hand-edited", which are the two mechanical halves of this cause. It does
   **not** catch a spec that was never updated at all — hence part 2.

2. **Contract tests must be version-pinned and row-populated.** A test that
   validates an export envelope must (a) build `templateVersion` from the
   exported constant rather than a literal, (b) include at least one row
   produced by the real builder (`buildCostSummaryRows` →
   `toCostSummaryJsonRow`), and (c) assert the new fields are **present after**
   parsing, not merely that parsing succeeded.

**How to enable:** add part 1 as a step in `.github/workflows/ci.yml` after the
install step. Part 2 is a review standard; it could be partially mechanised by a
test asserting that no file under `src/__tests__/` matches
`templateVersion:\s*\d` (i.e. a literal version in a fixture).

**Status:** proposed — awaiting human approval (not enabled)
