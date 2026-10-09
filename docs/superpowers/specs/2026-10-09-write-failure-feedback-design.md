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
user", and one of them is silence.

| Path | On failure today |
|---|---|
| Run Optimizer | `toast(destructive)` + a persistent failure card + `setSolveError` |
| `DirtyNavPrompt`'s Save action | surfaced inline — **as a raw Zod dump**, see below |
| The toolbar Save control | **nothing** — `saveWholeInputsAsync().catch(() => {})`, `Workspace.tsx:2124` |
| Clone | no validation at all, so it cannot fail where it should |

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
dump (DirtyNavPrompt), and a correct toast (Run Optimizer) — which is the
strongest possible argument for D1. It also means §4.2's change to the inline
path is a **bug fix**, not merely wording alignment.

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
422 path reaches the client through it — `routes/scenarios.ts:217` (create),
`services/scenarioInputWrite.ts:74` (update, via `{ kind: "invalid" }`),
`routes/distanceBands.ts:54`. So replacing that one expression with a formatted
sentence improves **every** consumer at once, with no OpenAPI change, no
regenerated client, and no new field.

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

Not a React hook; a pure function, so it is unit-testable without rendering.

### 4.2 Four call sites, one wording

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

So **the caller computes, the component renders**:

- `Workspace.tsx` derives `missingRequiredInputs: string[]` as the manifest's
  `required` keys absent from `localInputs`, and passes it down.
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

**D5 prevents new mismatches but does not fix existing ones.** A value already
stored at full precision still differs from its own 4 dp export, so the spurious
changed-row survives for that data. This is measured, not hypothetical:

| Scope | Rows with >4 dp stored | Detail |
|---|---|---|
| local `nos_dev` | 0 | nothing to fix |
| **production** | **1 scenario, 2 values** | scenario 40 (`p-median-us`): `6.2137119223733395` and `9.32056788356001`. Computed, not eyeballed: `10 / 1.609344` and `15 / 1.609344` reproduce both stored doubles exactly, confirming a km-sourced import rather than hand-entry |
| production `laneCostOverrides` | 0 | — |
| production `legDistanceOverrides` | 0 | — |

So completing D5 needs a **one-off backfill** rounding existing override values
to 4 dp — two values in one row in production. Without it the fix is partial,
which the project's own standard forbids.

The backfill must be idempotent (rounding an already-4 dp value is a no-op, so
this is satisfied by construction, and a test asserts it), must leave
non-override fields alone, and — unlike the CH4O migration — must **not** clear
`result` or bump the solve epoch: rounding a stored override at the 5th decimal
cannot change a solver outcome that was computed from the unrounded value to any
visible precision, and invalidating a student's solved result over it would be
worse than the wart. This is a deliberate difference from `ch4ToMiles.ts`, whose
epoch bump *was* load-bearing because the unit changed.

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
