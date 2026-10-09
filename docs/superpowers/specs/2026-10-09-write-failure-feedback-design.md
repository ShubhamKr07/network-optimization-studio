# Write-failure feedback — design

**Date:** 2026-10-09
**Branch:** `write-feedback` (off `main` @ `21c4dad`)
**Origin:** CH4O follow-ups FU-5, FU-7, FU-12, FU-6, FU-2. The remaining
follow-ups are elsewhere: FU-3/4/8/10/11/13 landed on `ch4o-mechanical`, and
FU-1 plus the four gate proposals belong to a separate gate-infrastructure
project.

---

## 1. The problem

The app has **three** different answers to "how does a failed write reach the
user", and the most common one is silence. The surfaces below are the
*distinct behaviours*; §4.2 enumerates the nine actual mutation call sites and
shows that **six of them handle failure not at all**, which is how one of these
three behaviours came to be the default rather than the exception.

| Path | On failure today |
|---|---|
| Run Optimizer | ~~`toast(destructive)` + a persistent failure card + `setSolveError`~~ — **see the correction below: the toast text was a raw dump too** |
| `DirtyNavPrompt`'s Save action | surfaced inline — **as a raw Zod dump**, see below |
| The toolbar Save control | **nothing** — `saveWholeInputsAsync().catch(() => {})`, `Workspace.tsx:2124` |
| Clone | no validation at all, so it cannot fail where it should |

> **Correction (WF-9, measured during execution — this section was wrong about
> the starting state).** The row above, and the "a correct toast (Run Optimizer)"
> claim further down, both credited Run Optimizer with the one *correct* surface.
> It was not correct. There were **three** error-message extractions in the
> pre-branch code and **all three used `err.message`** — i.e.
> `buildErrorMessage`'s `HTTP 422 …` prefix followed by the raw Zod body:
> `DirtyNavPrompt.tsx:54`, `Workspace.tsx:2868` (`enqueueSolve`'s `onError`) and
> `Workspace.tsx:2975` (the save-before-solve `onError`). Verified by reading all
> three at the branch base `669d12a`, not inferred. Together with the six
> `.mutate()` sites that had no `onError` at all (§4.2), the real starting state
> was **six silent, three dumping JSON, zero correct** — so there was no working
> surface to align the others to, and D1's "one mechanism" had to *build* the
> correct one rather than propagate an existing one. The original claim is struck
> rather than deleted, because "we thought one path already did this right" is the
> reason the first draft of §4.2 scoped only four sites.

**The inline path is worse than "inconsistent" — it is already broken, and this
was found while self-reviewing this spec rather than in the original review.**
`DirtyNavPrompt.tsx:54` does `setError(e instanceof Error ? e.message : …)`, and
`saveWholeInputsAsync`'s `onError` rejects with the original `ApiError`
(`reject(err instanceof Error ? err : new Error("Save failed."))`). `ApiError`'s
message is `custom-fetch.ts`'s `buildErrorMessage` output. So a student who hits
Cancel-then-Save on the dirty-navigation prompt is shown, inline, in the dialog:

```
HTTP 422 Unprocessable Content: [{"code":"too_small","minimum":0,
 "inclusive":false,"message":"Number must be greater than 0",
 "path":["avgServiceDistCapMi"]}]
```

That makes three distinct failures of the same mechanism — silence (Save), a raw
dump (DirtyNavPrompt), and ~~a correct toast (Run Optimizer)~~ **a third and
fourth raw dump (`Workspace.tsx:2868`, `:2975`) — see the correction above** —
which is the strongest possible argument for D1. It also means §4.2's change to
the inline path is a **bug fix**, not merely wording alignment.

The silence is deliberate and documented at `Workspace.tsx:2118-2121`: *"this
path had no visible error handling before this bundle either"*. That is history,
not a reason, and it is the only justification on offer.

**Why the inconsistency is the defect, not the silence.** A student who types
`0` into the avg-service-distance cap and clicks **Run Optimizer** is told. The
same value via **Save** is not. Having been told once, they reasonably conclude
Save worked. Chapter 4 now puts seven cross-validated fields on one screen
(`highServiceDistMi < maxDistMi`, cap `> 0`, floor integer ≥ 0), so this is
where it will actually be hit.

Three defects compound into a dead end with no diagnosis path:

1. **FU-5** — Save swallows the 422.
2. **FU-7** — a migration-skipped row renders a *plausible* parameters tab: gap,
   time limit and bands all present and editable, four fields silently absent,
   no message. Then Save fails per (1).
3. **FU-12** — clone performs no `validateInputsForModel`, so duplicating such a
   row produces another one. Clone is the **fourth** write path, which is exactly
   the "a derived or validated field needs every write path" rule this overhaul
   itself contributed to `artifacts/api-server/CLAUDE.md`.

Two further items share these write paths and are folded in rather than left to
drift:

4. **FU-6** — `useDistanceDraft.commit()` fires `onCommit` for any
   grammar-complete draft, so focusing a field in km, retyping the identical
   displayed text and blurring commits `650 → 650.0000000000001`: the scenario
   flips dirty and a band retargets to a float.
5. **FU-2** — import stores full-precision converted values while export emits
   `roundForFile`'s 4 dp, and change detection is an exact `!==`, so
   re-importing an unmodified export flags rows nobody edited.

## 2. Decisions taken

All five were decided explicitly before this document was written.

| # | Decision |
|---|---|
| D1 | **One mechanism, applied everywhere** — not three site patches. FU-5's root cause *is* the divergence; patching call sites leaves a fifth to diverge later. |
| D2 | **Toast only, with the field named in the text.** No per-field inline UI, no `path`→field registry, no change to the input components. |
| D3 | **Explain skipped rows on the tab**, rather than relying on the Save toast alone. The current state is worse than an error because it looks *correct*, which is why it would never be reported. |
| D4 | **Clone validates and rejects**, like every other write path. A student cannot duplicate an invalid scenario — correct, since the duplicate could never be saved or solved. |
| D5 | **Round on import to match export**, accepting that the stored canonical value becomes lossy at 4 dp. |

D5 was taken with its cost stated: a km-sourced `100 km` will store `62.1371`
rather than the true `62.13711922373339`. See §6 for the consequence that makes
D5 incomplete on its own.

## 3. Server

### 3.1 One line is the whole formatting fix

`registry/modelRegistry.ts:138`:

```ts
if (!result.success) {
  return { success: false, error: result.error.message };
}
```

`ZodError.message` **is** the JSON-stringified issue array. That single
expression is why every input-validation 422 in the system carries a dump like:

```json
[{"code":"too_small","minimum":0,"inclusive":false,
  "message":"Number must be greater than 0","path":["avgServiceDistCapMi"]}]
```

`validateInputs` is the sole producer of `ValidateInputsResult.error`, and every
**Zod shape-validation** 422 reaches the client through it —
`routes/scenarios.ts:217` (create), `services/scenarioInputWrite.ts:74` (update
and the import/apply path, via `{ kind: "invalid" }` surfaced as
`outcome.error`), `routes/distanceBands.ts:54`. So replacing that one expression
with a formatted sentence improves **every** consumer at once, with no OpenAPI
change, no regenerated client, and no new field.

Scoped precisely after review: that claim covers Zod validation text, **not
every 422 in the system**. The others are already plain human strings
(`modelId is fixed at creation…`, `assertNoServerOwnedFields`' guard text, the
export-parameter messages, `referenceCosts`/`referenceDistances`' capability
refusals) and need nothing — plus one differently-shaped body, the network-edit
precheck, handled in §4.1.

**The function's other error branch must be left alone.**
`modelRegistry.ts:134` returns `` `Unknown model_id: ${modelId}` `` — already a
human sentence, and not a Zod issue list. Passing it through `formatInputIssues`
would be a type error at best and a mangled message at worst. Only the
`:138` branch changes. Stating this because "format the validator's errors"
reads as if there were one error path, and there are two.

The alternative designs were rejected: having the client `JSON.parse` a
string nested inside a JSON field hard-codes Zod's issue shape across a network
boundary and breaks silently on a Zod upgrade; adding a structured `issues[]`
field to the contract buys per-field capability that D2 deliberately does not
use, and is the overkill answer.

### 3.2 `formatInputIssues(issues)` — a new pure function

Takes `ZodIssue[]`, returns one human sentence per issue, joined with a space:

> `Average service distance cap must be greater than 0. Coverage floor is required.`

Rules:

- **Label lookup** maps `path[0]` to a display label (`avgServiceDistCapMi` →
  "Average service distance cap"). This table is the **one duplication this
  design accepts** — it restates labels the studio form also holds. It is a
  label table, not logic; the validation rules stay single-sourced in Zod.
- **Unmapped paths degrade, never vanish**: fall back to the raw path segment, so
  a field added later reads awkwardly rather than disappearing.
- **`"Required"` becomes `"<Label> is required."`**, because Zod's bare
  `"Required"` is useless without its field. This is the message a
  migration-skipped row produces for each absent field, so it is load-bearing for
  FU-7's diagnosis path.
- **Nested paths** (`distanceOverrides[2].distance`) use `path[0]` for the label
  and keep the index in the sentence, so a bad row in a collection is locatable.
- **Issue order is preserved** — Zod reports in schema order, which matches the
  form's field order closely enough to be useful and is deterministic, which
  matters for tests.
- **No issue cap.** Seven cross-validated fields can all fail at once and a
  student needs all seven. A cap would silently hide the field they are looking
  at.

### 3.3 Clone joins the validated write paths

`routes/scenarios.ts`'s clone handler (around `:1979-1992`) runs
`validateInputsForModel(source.modelId, source.inputs)` before insert and, on
failure, returns 422 with `formatInputIssues`' output — the same shape create and
update already return.

Note what this does *not* change: `deriveServerOwnedInputs` still returns the
blob untouched when `coverageFloorDemand` is absent (`scenarioInputWrite.ts:36`).
That is correct — deriving an objective from an invalid row would be inventing
data. The validator rejects first, so the derivation is never reached with a
broken row.

**Ownership is unchanged and must stay so**: the clone handler's existing
`user_id` filter and its 404-never-403 behaviour for a non-owned source are
untouched. A validation 422 is only reachable *after* ownership passes, so this
does not become an existence oracle.

## 4. Client

### 4.1 `describeWriteError(err): string` — a new pure function

Reads `ApiError.data.error` first (the server's formatted sentence), falls back
to `err.message`, and finally to a generic string. It must never surface
`custom-fetch.ts`'s `buildErrorMessage` prefix — `HTTP 422 Unprocessable
Content: …` is not a sentence for a student. Reading `.data.error` rather than
`.message` avoids the prefix entirely rather than stripping it, so there is no
regex to drift.

**There is a SECOND 422 body shape, found in review, that a `data.error`-only
read silently truncates.** The network-edit precheck returns
`{ error: "Network-edit precheck failed", errors: outcome.errors }`
(`routes/scenarios.ts`) — the headline is a label and the *actual* per-entity
detail is in `errors`. Reading `data.error` alone would show a student
"Network-edit precheck failed" and discard every reason. So
`describeWriteError` must handle both shapes: when `data.errors` is a non-empty
array, render its entries; otherwise use `data.error`. Both are guarded reads
against `unknown`, not casts.

For completeness, the other 422 bodies in the system are already plain human
strings — `"modelId is fixed at creation and cannot be changed"`,
`assertNoServerOwnedFields`' guard text, the export-parameter messages — so they
pass through this helper unchanged and need nothing.

Not a React hook; a pure function, so it is unit-testable without rendering.

### 4.2 Every mutation call site, one wording

**Corrected after review — the original draft of this section named four call
sites and that contradicted D1.** `Workspace.tsx` has **nine** `.mutate()` call
sites across six hooks, and **six of them have no `onError` at all**. Silence is
not one path's quirk; it is the majority behaviour:

| Line | Handler | Today |
|---|---|---|
| 2077 | `saveWholeInputsAsync` | `onError` → rejects (caller decides) |
| **2138** | `handleSaveBandsOnly` | **nothing** |
| **2699** | `handleCreateConfirm` | **nothing** |
| **2715** | `handleCloneScenario` | **nothing** |
| **2730** | `handleDeleteScenario` | **nothing** |
| **2767** | `handleRenameScenario` | **nothing** |
| 2863 | `enqueueSolve` | `onError` + toast + failure card |
| 2946 | `handleSolve` (save-before-solve) | `onError` + toast |
| **3122** | `handleSaveAsScenario` | **nothing** |

"One mechanism applied everywhere" (D1) therefore means **all nine**, not the
four the draft listed. Naming four would have left five silent paths and
reproduced the exact divergence this project exists to end — and `handleCloneScenario`
is one of them, so D4's server-side 422 would have landed on a call site that
discards it.

> **Correction (WF-9). The nine-site enumeration above was itself incomplete,
> three separate times.** Correcting four → nine fixed the count and left the
> *method* intact, and the method is what was wrong: the criterion is syntactic
> (`.mutate(` call sites in `Workspace.tsx`) and the set it needed to name is
> semantic (every path that can surface a write failure). What it missed, in the
> order it was found:
>
> 1. **`handleSaveInputs` — FU-5 itself**, the single defect this project exists
>    to fix. It is a `.catch()` *consumer* of `saveWholeInputsAsync`, not a
>    `.mutate()` site, so the table skipped it and `mutationErrorSurface.test.ts`
>    (which scans `.mutate(`) was **structurally incapable of seeing it**. WF-3's
>    first commit shipped eight sites green, 2308 tests passing, with the headline
>    bug and its "Intentionally silent" comment untouched.
> 2. **`ImportDialog.tsx:134,238`** — a live path reachable from eight input tabs,
>    rendering `HTTP 422 …` + the raw body on top of the clean sentence §3.2 had
>    just built. Outside `Workspace.tsx`, so outside the grep.
> 3. **`lib/exportEntity.ts:87`** — found only by the follow-up audit the user
>    asked for after (2). Its pre-existing 422 test used a plain object literal
>    where an `Error` was required, so it exercised the already-safe fallback and
>    could never have caught it.
>
> The guard now also flags a `.catch(` whose body does nothing with the error, and
> reads `DirtyNavPrompt.tsx`, `ImportDialog.tsx` and `lib/exportEntity.ts` as well
> as `Workspace.tsx`, with a named allow-list (`OutputMapTab` ×2, `Studio.tsx` ×4)
> rather than a loosened regex. The durable form of this lesson is in
> `artifacts/studio/CLAUDE.md`.

Every site gets `onError` routing through `describeWriteError`, with a title
naming the action ("Couldn't save your changes", "Couldn't rename the scenario",
"Couldn't delete the scenario", …) and the server's sentence as the description.
Two keep their existing extra surfaces unchanged: `enqueueSolve`'s failure card
and `setSolveError` stay, and `saveWholeInputsAsync` keeps rejecting so its
callers can still react — it gains nothing, because its *callers* are what
surface the error.

Specifics that differ from the uniform treatment:

- `handleSaveInputs` (`Workspace.tsx:2122-2127`) stops swallowing and toasts
  `{ title: "Couldn't save your changes", description: describeWriteError(err), variant: "destructive" }`.
  **The deliberate-silence comment at `:2118-2121` is deleted, not amended.**
- `DirtyNavPrompt.tsx:54` routes its message through the same helper instead of
  `e.message`. **This is the bug fix described in §1**, not a wording tweak —
  today that line renders `buildErrorMessage`'s `HTTP 422 …` prefix followed by
  the raw Zod array, inline in the dialog. Its non-`Error` fallback
  (`"Save failed. Try again."`) stays.
- Run Optimizer's existing toast (`:2873`) adopts the helper so all three agree.
  Its failure card and `setSolveError` are **unchanged** — that is a separate,
  working surface, and D2 does not touch it.
- The clone trigger toasts on the new 422.

### 4.3 The skipped-row notice — generic, not Chapter-4-specific

**A correction to the design as first sketched.** The intended approach was
"reuse the condition the guard already computes" — `highServiceDistMi != null` at
`OptimizationParametersTab.tsx:293`. That is **wrong**: the guard is a *model
discriminator*, not a validity check. Its own comment says the section is
"present only for Chen", and the component states three times that it gates on
*value presence, never on `modelId`*. Rendering a notice when that gate is false
would show it on every p-median, transport and JADE scenario.

The correct source of truth already exists and is already served. Every
manifest declares `inputsSchema.required[]` — for `max-coverage-us`:
`['p','highServiceDistMi','maxDistMi','avgServiceDistCapMi','coverageFloorDemand','gap','timeLimitSec','capacityMode','distanceBands']`
— and `inputsSchema` is surfaced on `/api/models`
(`registry/modelRegistry.ts:114`).

**Verified against the live production API, not just the manifest on disk:**
`GET /api/models` for `max-coverage-us` serves `inputsSchema` with keys
`['properties','required','type']` and all nine `required` entries intact. The
mechanism is real end to end.

Two refinements from review:

- **`required` is runtime-present but untyped.** The generated type is
  `ModelInfoInputsSchema = { [key: string]: unknown }`
  (`api.schemas.ts:222`), because the OpenAPI schema declares `inputsSchema` as
  a bare `type: object` described as "Opaque to this contract". So the caller
  needs a *guarded* read — `Array.isArray(x.required) && x.required.every(k => typeof k === "string")`
  — not a property access or a cast. If the guard fails, render no notice: a
  missing-manifest-detail must never produce a scary message.
- **Absence must be tested by value, not by key presence.** "Required keys
  absent from `localInputs`" misses a key that is present but `null` or
  `undefined`, which an `in`-style check treats as fine. For a
  migration-skipped Chapter 4 row this happens not to arise — such rows are
  left wholly unconverted, so the `…Mi` keys are genuinely absent — but a
  value-based check is strictly safer, costs nothing, and does not depend on
  that incidental fact holding for every model.

So **the caller computes, the component renders**:

- `Workspace.tsx` derives `missingRequiredInputs: string[]` as the manifest's
  `required` keys whose value in `localInputs` is `null`/`undefined`/absent, and
  passes it down.
- `OptimizationParametersTab` renders the notice when that array is non-empty,
  listing the labels.

This honours the component's stated convention exactly (gate on a value's
presence, never on `modelId`), keeps `modelId` unread as it is today, and
generalises for free: any model whose row is missing a required input gets the
same notice, rather than Chapter 4 getting a special case.

Copy: a short destructive-styled block stating the scenario's values are
missing, that it cannot be saved or solved until they are restored, and to
contact the instructor. The gap/time-limit/bands fields that *are* intact keep
rendering — the student can still see them, which is why the heavier
"refuse to open the scenario" option was rejected.

## 5. FU-6 — the draft no-op guard

The guard moves **into** `useDistanceDraft.commit()`
(`hooks/useDistanceDraft.ts:194`), so all 15 call sites inherit it:

```ts
if (isComplete(draft.text) && !Number.isNaN(draft.anchor)) {
  if (roundForFile(draft.anchor) !== roundForFile(value)) onCommit(draft.anchor);
}
```

`roundForFile` is `Math.round(v * 1e4) / 1e4` (`lib/units/src/convert.ts:24`), so
both sides compare in display space at 4 dp — the rule
`artifacts/studio/CLAUDE.md` already prescribes, applied in the one place that
serves every caller.

**No per-caller guard is added**, including at the new unconditional avg-cap call
site. An eleventh bespoke guard would make this consolidation harder, and the
semantics ("the committed value is semantically unchanged") belong to the hook's
contract.

Two behaviours that must survive, because the hook's existing comments say they
are load-bearing: `setFocused(false)` still runs before the early return so
blurring an untouched field re-formats it, and `setDraft(null)` still runs
unconditionally after — the field must revert to the committed value whether or
not `onCommit` fired. Only the `onCommit` call becomes conditional.

## 6. FU-2 — import rounding, and why D5 alone is incomplete

`roundForFile` wraps the three unrounded `fromDisplay` sites:
`services/import.ts:1095` (distances), `:1190` (lane costs), `:1283` (leg
distances). Their change-detection comparisons at `:1102`, `:1193` and `:1286`
stay exact `!==` — once both sides are 4 dp, exact comparison is correct.

**The lane-cost site was challenged in review and is safe — recorded because the
opposite conclusion is the intuitive one.** This repo has a standing rule that a
`$/unit-distance` RATE converts as the *reciprocal* of a distance and must never
go through the distance helpers, so wrapping a field named `cost` in a distance
rounding looks like exactly that mistake. It is not: `templates.ts:1172-1178`
states that transport-coal's lane "cost" **is literally geographic miles** — the
objective is distance × flow and `cost` is only chapter vocabulary — which is
why its export already does `roundForFile(toDisplay(...))` at
`applyLaneCostOverrides`. The genuine rate case (`$/ton-mi`, with
`rateConversion` and `IDENTITY_CONVERSION`) lives in the studio's
`lib/transportCosts.ts` and this import path never touches it.

**D5 prevents new mismatches but does not fix existing ones.** A value already
stored at full precision still differs from its own 4 dp export, so the spurious
changed-row survives for that data. This is measured, not hypothetical:

| Scope | Rows with >4 dp stored | Detail |
|---|---|---|
| local `nos_dev` | 0 | nothing to fix |
| **production** | **1 scenario, 2 values** | scenario 40 (`p-median-us`): `6.2137119223733395` and `9.32056788356001`. Computed, not eyeballed: `10 / 1.609344` and `15 / 1.609344` reproduce both stored doubles exactly, confirming a km-sourced import rather than hand-entry |
| production `laneCostOverrides` | 0 | — |
| ~~production `legDistanceOverrides`~~ | ~~0~~ | **this key does not exist — see the correction below** |

> **Correction (WF-9). `legDistanceOverrides` appears nowhere in the code, and
> the measurement that "cleared" it was a null result misread as a benign zero.**
> `services/import.ts`'s two `legDistances` branches read and write
> **`distanceOverrides`** — `parseLegDistanceRows` takes
> `currentOverrides.distanceOverrides ?? []` (`import.ts:515`), which settles it.
> So there are **three import sites but only two stored override fields**
> (`distanceOverrides[].distance` and `laneCostOverrides[].cost`); this section
> and the FU-2 follow-up text both said three. The backfill's `OVERRIDE_FIELDS`
> accordingly has **two** entries, not three, while still covering all three
> import entities — leg distances land in `distanceOverrides` alongside ordinary
> distances.
>
> The part worth keeping is *how* the row above got written. The production audit
> ran a count over `inputs->'legDistanceOverrides'` and got `0`, and that was read
> as "no affected rows" when the real reason was that **the key does not exist, so
> the query could only ever return 0** — a null measurement misread as a benign
> zero, which is the exact error class this branch spent its reviews flagging in
> other people's work. A `0` from a query over a field name nobody verified is not
> evidence of absence; it is evidence of nothing. The distilled rule is in root
> `CLAUDE.md`.

So completing D5 needs a **one-off backfill** rounding existing override values
to 4 dp — two values in one row in production. Without it the fix is partial,
which the project's own standard forbids.

The backfill must be idempotent (rounding an already-4 dp value is a no-op, so
this is satisfied by construction, and a test asserts it) and must leave
non-override fields alone.

### 6.1 The no-epoch-bump decision, corrected

The original reasoning here was **too strong and is withdrawn**. It claimed that
rounding at the 5th decimal "cannot change a solver outcome to any visible
precision". A counterexample exists.

**The counterexample, corrected twice.** The first version given here was
`449.99996 → 450.0` "crossing the boundary at 450". That is **wrong**, and
checking it is what produced the right answer: bands are *upper bounds* ("within
450 mi"), so `449.99996` and `450.0` are both **inside** the 450 band and
membership does not change. The genuine case is the other direction —
**`450.00004 → 450.0`**, which moves a value from the overflow bucket *into* the
450 band.

This matters beyond pedantry: a boundary test written as an interval
(`min < band <= max`) reports the harmless case and **misses** the real one. The
correct test is whether **band membership** changes — compute the first band
`>= value` for the stored and rounded values and compare.

What that does and does not break:

- It does **not** change the solve. Distance bands are a reporting lens computed
  in post-processing, not model constraints — this repo's own standing note.
- It **can** change `result.metrics.bandCoverage` in the *cached* envelope,
  which would then disagree with a client-side recompute of the same bands. That
  is precisely the cached-result-drift class the staleness guard exists for, and
  not bumping the epoch is what would let it persist.

Two round-trip claims were tested and **hold**, so only the boundary case is at
issue: across 4010 values (including every integer kilometre figure in range and
4000 random ones) a km→mi→km→mi→km chain with 4 dp rounding at every hop was
**stable in all 4010 cases**, zero oscillation or drift.

**So the decision stands but must be made true by construction rather than by
luck.** The backfill:

1. computes, per row, whether any value it would round **crosses a band boundary
   declared in that scenario's own `distanceBands`**;
2. if none do, writes the rounded values and does **not** clear `result` or bump
   the solve epoch — the original rationale applies, since nothing observable
   changes;
3. if any do, it **refuses that row and reports it** rather than choosing for the
   operator, because the correct handling (accept a changed band attribution, or
   bump the epoch and force a re-solve) is a judgement about a student's saved
   work.

Verified for the actual production data: scenario 40's bands are
`[200, 400, 800, 1600]` and its two values round `6.2137119223733395 → 6.2137`
and `9.32056788356001 → 9.3206`, neither crossing any boundary. So the real
backfill takes path (2) — but it takes it because the guard checked, not because
the spec asserted it.

This remains a deliberate difference from `ch4ToMiles.ts`, whose epoch bump *was*
load-bearing because the unit itself changed.

## 7. Testing

**Pure functions get real unit tests.** `formatInputIssues` and
`describeWriteError` have no React or network dependency. Cases that must be
covered because each is a distinct code path: a `too_small` issue, a bare
`"Required"`, a `custom` cross-field issue (`highServiceDistMi must be less than
maxDistMi`), multiple issues at once, an unmapped path, and a nested
`distanceOverrides[n].distance` path.

**The error paths must be driven, not inferred.** The CH4O review found three
existing Chapter 4 tests that asserted the PATCH *body* and never invoked
`onSuccess`/`onError` — which is precisely how FU-5 survived a 2293-test suite.
So each new RTL test must invoke the mutation's `onError` with a real
`ApiError`-shaped rejection and assert the **user-visible** result (the toast's
text), not a ref or an internal.

**The skipped-row notice must be tested on a shape the production writer
produces.** A fixture that genuinely omits the required keys — not a hand-built
object that happens to lack them while carrying fields a real row never
would. This repo's standing hazard is a test that hand-authors a persisted shape
no writer emits; the notice's whole purpose is to handle a real migration
outcome, so the fixture should be derived from what `ch4ToMiles.ts` classifies as
`skipped`.

**The notice must be proven NOT to render for other models.** A p-median
fixture with no `highServiceDistMi` must show no notice. This is the regression
the §4.3 correction exists to prevent, and it is the one assertion that would
have caught the original sketch.

**Clone validation needs both directions**: an invalid source 422s, and a valid
source still clones successfully with ownership behaviour unchanged (a non-owned
source still 404s, not 422 — a 422 there would leak existence).

**FU-6 needs a red-first test** that an edit-and-revert in km mode does not mark
the scenario dirty, and a companion proving a genuine 4 dp change still commits —
otherwise the guard could be made to pass by never committing at all.

**The backfill gets an idempotency test** before it runs anywhere, and a dry run
reporting the rows it would touch. FU-13 (already landed) established that a dry
run which cannot predict its own effect is worse than none; this one must not
repeat that.

Four tests added by the review, each pinning a finding that would otherwise be
only prose:

- **All nine mutation sites surface a failure.** A test that enumerates
  `Workspace.tsx`'s `.mutate(` call sites and asserts each has an `onError`,
  in the style of the existing `lockedModelGuards.test.ts` and
  `maxCoverageWriteGuard.test.ts` source-reading guards. Without it, the tenth
  call site added next year silently reintroduces the whole defect — which is
  exactly how this one arose.
- **The second 422 shape is rendered, not truncated.** `describeWriteError`
  given `{ error: "Network-edit precheck failed", errors: [...] }` must surface
  the entries, not just the label.
- **The notice does not misfire when the manifest detail is unreadable.** Given
  an `inputsSchema` whose `required` is absent or not a string array, the guard
  fails closed and renders nothing.
- **The backfill refuses a band-crossing row.** A fixture whose value rounds
  across one of its own `distanceBands` must be reported and skipped, not
  written — and a sibling fixture that crosses nothing must be written without
  an epoch bump. Both halves are needed: a guard that refuses everything would
  pass the first assertion alone.

## 8. Out of scope

Stated so none of it is assumed:

- No per-field inline error UI, and no `path`→form-field registry (D2).
- No client-side pre-validation — it would duplicate the server's rules and
  create two sources of truth that drift, and it cannot help FU-7, where the row
  is already invalid on arrival.
- No `issues[]` structured field on the API contract.
- No change to Run Optimizer's failure card or `setSolveError`.
- No change to `deriveServerOwnedInputs`' pass-through behaviour.
- FU-1 and the four gate proposals (`codegen_drift`, `config_preflight`,
  `deploy_config`, `review_caught`) belong to the gate-infrastructure project.

## 9. Risks

- **The label table drifts from the form's labels.** Accepted in §3.2. Mitigation
  is a test asserting every key in `max-coverage-us`'s
  `inputsSchema.required` has a label, so a new required field fails loudly
  rather than rendering a raw path.
- **The backfill touches production data.** It is two values in one row, it is
  idempotent, and it does not clear results. It needs its own approval and its
  own runbook section, separate from any deploy, per this repo's standing rule
  that a migration is a distinct authorisation.
- **D5 is lossy by choice.** Future km-sourced imports store 4 dp rather than
  full precision. The round trip remains stable at `roundForFile`'s precision,
  which is the precision every file carries anyway, so no user-visible value
  changes — but a consumer wanting full precision from an import no longer has
  it.
