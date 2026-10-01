# Chapter 9 (JADE) — editable transportation cost inputs

**Date:** 2026-10-02
**Model:** `two-echelon-jade-us` (Chapter 9, JADE Investment Decision)
**Status:** design, pending user review

---

## 1. Problem

Chapter 9's four transportation cost parameters are hardcoded constants in the solver and have no UI
surface at all. A student can edit distances, demands, plant-product capability, and `p`, but cannot
see — let alone change — the rates that turn those distances into the dollars the objective
minimises.

Current state, verified this session:

| Book name | Constant | Value | Meaning |
|---|---|---|---|
| `ic_trans_cost` | `JADE_IC_RATE` (`solve.py:152`) | `0.07` | $ per ton-mile, plant → warehouse (inter-company / inbound) |
| `ic_min_trans` | `JADE_IC_MIN` (`solve.py:153`) | `10.0` | $ per ton minimum charge, plant → warehouse |
| `ob_trans_cost` | `JADE_OB_RATE` (`solve.py:150`) | `0.12` | $ per ton-mile, warehouse → customer (outbound) |
| `ob_min_trans` | `JADE_OB_MIN` (`solve.py:151`) | `10.0` | $ per ton minimum charge, warehouse → customer |

Both legs price a lane as `max(rate × distance, min)` $/ton — `solve.py:1163-1167`:

```python
def ic_cost(pl, w):
    return max(JADE_IC_RATE * dist.get((pl, w), 9999), JADE_IC_MIN)

def ob_cost(w, c):
    return max(JADE_OB_RATE * dist.get((w, c), 9999), JADE_OB_MIN)
```

Neither constant appears in `manifest.json`'s `inputsSchema`, in `jadeInputs.ts`, in
`buildPayload()`, or anywhere in `artifacts/studio`. The model's tab set
(`Workspace.tsx:1296-1304`) is Input Map / Plants / Capability Matrix / Warehouses / Customers /
Distances / Optimization Parameters — no cost tab, unlike `two-echelon-gold-au` (`laneCosts`) and
`delivery-teaching-us` (`deliveryCosts`).

The rates enter the objective purely as cost coefficients (`solve.py:1177-1182`), so making them
editable is a coefficient change, not a new code path — CLAUDE.md hard rule 6 is satisfied by
construction.

---

## 2. Decisions

Each was chosen explicitly; the rejected alternatives are recorded so a later session does not
reopen them.

### 2.1 Editable, and the per-lane consequence is shown — not read-only

The four rates become scenario inputs that feed the solve, **and** the existing Distances tab gains
a derived `$/ton` column plus a marker for lanes where the $10 minimum charge binds rather than the
rate.

*Rejected:* read-only display of the constants (closes the visibility gap but a student still can't
ask "what if inbound freight got 30% more expensive?", which is the chapter's actual question).

### 2.2 Four global scalars — per-lane cost stays derived

One set of four numbers for the whole network, exactly as the book states them. The per-lane $/ton
is always computed as `max(rate × distance, min)`; it is never stored and never independently
editable.

*Rejected:* globals plus per-lane overrides (a ~2600-row override grid — 4×25 inbound + 25×100
outbound — plus a precedence rule and an import/export story, for a flexibility the chapter does not
use; `delivery-teaching-us` already exists for lane-level rate work and that is the whole point of
that chapter being separate).

*Not applicable:* per-product rates. `products.json` carries only `{id, sourceId, name}` — no
weight or handling factor — and the objective applies the same $/ton to every product family. A
per-product rate would be inventing data the dataset does not have.

### 2.3 A new "Transportation Costs" input tab, plus two columns on Distances

New tab sits after Distances and before Optimization Parameters. Two rows, four fields:

```
Transportation Costs
 Leg                        Rate $/ton-mi   Min $/ton
 Inbound  plant->warehouse  [0.07]          [10.00]
 Outbound warehouse->cust   [0.12]          [10.00]
 cost per ton = max(rate x distance, min)

Distances (existing tab, +2 cols)
 Leg  From  To    Base  Override  $/ton   Min?
 P->W pl-1  wh-9  200   -         14.00
 W->C wh-9  c-13  10    -         10.00   min
```

*Rejected:* folding the four fields into Optimization Parameters (conceptually wrong — these are
model cost data, not solver controls like `gap`/`timeLimitSec`, and that tab is already dense), and a
self-contained tab carrying its own full lane-cost grid (duplicates a grid that already exists and
doubles the virtualization/export surface).

### 2.4 The display-unit toggle converts the rate, with drift made structurally impossible

In km display mode the field shows `$/ton-km`; `0.07 $/ton-mi` reads as `0.0435 $/ton-km`.

The obvious risk — a float round-trip silently rewriting a stored rate on a sacred-accuracy model —
is closed structurally rather than by tolerance arithmetic:

- Canonical storage is **always `$/ton-mile`**. The toggle is a display concern only.
- The field is draft-until-commit (same pattern as `ChenDistanceInput`): it writes on blur/Enter,
  never on keystroke.
- **On commit, compare in display space, not canonical space.** Render what the field *would* show
  for the currently stored canonical value, and compare it to the string the user actually
  committed. Equal ⇒ no write at all. Only a genuinely different displayed value converts back to
  canonical and writes.

So flipping the toggle, or tabbing through a field without editing it, can never mutate a stored
rate — there is no epsilon to tune and no accumulating round-trip error.

A rate is per *unit distance*, so its conversion is the **reciprocal** of a distance conversion:
`UnitContext`'s `toDisplay(v, canonical)` (`contexts/UnitContext.tsx:60`) multiplies, which is wrong
for a rate. The tab needs its own two-line helper derived from the same source of truth:

```ts
// rate per mile -> rate per display unit = rate / (length of 1 canonical unit in display units)
const rateToDisplay = (rate: number, canonical: CanonicalUnit) => rate / toDisplay(1, canonical);
const rateFromDisplay = (rate: number, canonical: CanonicalUnit) => rate * toDisplay(1, canonical);
```

Reusing `toDisplay`/`fromDisplay` directly on a rate is the specific bug this clause exists to
prevent: it would make km mode read `0.1127 $/ton-km`, i.e. freight getting *more* expensive purely
because someone flipped a display switch.

*Noted at decision time and accepted by the user:* the "always `$/ton-mile`, never convert" option
would have had zero conversion surface at the cost of a student being unable to eyeball
`rate × distance` against km distances.

### 2.5 The result records the rates it was solved at

`solve_jade` echoes the four effective rates into the result envelope so Compare can explain a cost
delta ("A solved at 0.07/0.12, B at 0.09/0.12") instead of just showing two different numbers.

*Rejected:* relying on `inputs` alone (Compare reads the cached result, so a rate difference would be
invisible there), and reading the rates from each scenario's live `inputs` in the UI (for a stale
scenario the inputs no longer match what the cached result was solved at — the display would lie).

---

## 3. Data contract

### 3.1 Inputs key

Field names stay traceable to the book / `JADE_case_Chapter_9_Network_Design_Book.ipynb`:

```
transportCosts: {            // the OBJECT is optional; when present, ALL FOUR are required
  icTransCost: number >= 0,  // $/ton-mile, plant -> warehouse
  icMinTrans:  number >= 0,  // $/ton min charge, plant -> warehouse
  obTransCost: number >= 0,  // $/ton-mile, warehouse -> customer
  obMinTrans:  number >= 0,  // $/ton min charge, warehouse -> customer
}
```

All-or-nothing on the object: a partially-specified `transportCosts` is a 422, not a half-merge.
This removes the whole class of "which three fields silently fell back to the constant" bugs. The UI
always writes all four.

Bounds: `>= 0` and finite on every field. `0` is legal for a min charge and means "no minimum" — a
real scenario a student may want. `0` is legal for a rate too (then the min charge governs every
lane on that leg). No upper bound.

`transportCosts` is **absent** on every existing scenario and on every newly created one; absence
means the textbook values.

### 3.2 Registration points

Derived from `model-integration-precheck.md` Gate 1 — the points that apply to a new *input field*
plus a new *output field*, not to a new model:

| # | File | Change | Failure mode if missed |
|---|---|---|---|
| 1 | `solvers/two-echelon-jade-us/manifest.json` | `inputsSchema.properties.transportCosts` | documented contract diverges from enforced one |
| 2 | `artifacts/api-server/src/validation/inputs/jadeInputs.ts` | Zod object, optional, all-four-required | **silent** — key Zod-stripped, PATCH succeeds, solve ignores it |
| 3 | `lib/api-spec/openapi.yaml` + `pnpm --filter @workspace/api-spec run codegen` | inputs schema + the new result field | generated client rejects or strips the field; regen lands in the same commit (hard rule 1/4) |
| 4 | `artifacts/api-server/src/solver/pmedian.ts:88-136` | `transportCosts: i.transportCosts` in the JADE `buildPayload()` branch | **silent** — precheck point 6: payload is a field-by-field translation, an unlisted field never reaches the solver and the solve quietly uses defaults |
| 5 | `artifacts/api-server/src/solver/solve.py` | read the rates in `solve_jade` | n/a (the above would already have it) |
| 6 | `artifacts/api-server/src/solver/resultEnvelope.ts:34-58` | `transportRates` optional on `MetricsSchema` | **silent** — precheck failure #1: Zod strips unknown result keys, UI never sees them |
| 7 | `artifacts/studio/src/pages/Workspace.tsx:1296-1304` | `{ id: "transportCosts", label: "Transportation Costs" }` in the JADE case of `inputEntriesForModel` | tab simply does not exist |
| 8 | `artifacts/studio/src/pages/Workspace.tsx` render switch | a branch rendering the new tab for `two-echelon-jade-us` | tab appears in the sidebar and renders nothing |

Not registration points here, confirmed by reading them: `merge_inputs.py` (scalars are not dataset
entities — nothing enters `build_merged_jade_dataset`), `precheck.ts`'s
`runNetworkEditsPrecheckForModel` (Zod bounds are the whole validation story for four scalars),
`objective.ts`'s `objectiveDimension` (JADE's objective is already dollars), and the import/export
entity registry (§7).

### 3.3 Backward compatibility

With `transportCosts` absent the objective is byte-identical to today's, so
`artifacts/api-server/src/solver/tests/e2e_accuracy.py` must keep passing **99/99 unmodified** —
that is the acceptance criterion for this whole section, per hard rule 2.

Cache behaviour, verified at `jobRunner.ts:60-71`: the result-cache key includes `SOLVER_CODE_HASH`,
a sha256 of `solve.py`'s bytes. Editing `solve.py` therefore invalidates every cached result
repo-wide. Consequence to expect and not misread as a bug: existing JADE scenarios will re-solve on
next solve rather than hit cache, and must return the same numbers they did before.

---

## 4. Solver

`solve.py:150-153` constants **stay**, and become the named defaults. In `solve_jade`, immediately
before the cost closures (`solve.py:1163`):

```python
tc      = inp.get("transportCosts") or {}
ic_rate = tc.get("icTransCost", JADE_IC_RATE)
ic_min  = tc.get("icMinTrans",  JADE_IC_MIN)
ob_rate = tc.get("obTransCost", JADE_OB_RATE)
ob_min  = tc.get("obMinTrans",  JADE_OB_MIN)

def ic_cost(pl, w):
    return max(ic_rate * dist.get((pl, w), 9999), ic_min)

def ob_cost(w, c):
    return max(ob_rate * dist.get((w, c), 9999), ob_min)
```

Pure coefficient substitution — no `if` on a business rule, no second model branch.

The `dist.get(..., 9999)` missing-distance sentinel is left exactly as it is. It now scales with an
editable rate, which is a pre-existing wart (a missing lane prices at `9999 × rate` rather than being
rejected), not something this change introduces or should fix opportunistically.

Result echo, alongside the existing JADE-only `inboundCost`/`outboundCost`:

```
metrics.transportRates = { icTransCost, icMinTrans, obTransCost, obMinTrans }
```

optional on `MetricsSchema`, never `.default(...)` — a pre-change stored envelope lacks the key
entirely and must keep validating (the export route `safeParse`s persisted results).

---

## 5. Frontend

### 5.1 Transportation Costs tab

- Four numeric fields in two labelled leg rows, per §2.3's layout.
- Draft-until-commit per field; commit on blur or Enter. Per the repo's own Gotcha, prefer blur
  (click a neighbouring field) over Enter in tests when a commit can open a dialog.
- Display-space commit comparison and the reciprocal rate conversion per §2.4.
- A non-numeric or negative draft is rejected at the field with an inline message and leaves the
  stored value untouched — it never reaches a PATCH.
- "Reset to textbook values" action: clears `transportCosts` from inputs entirely (not "writes
  0.07/0.12/10/10"), so a reset scenario is indistinguishable from one never edited.
- Edits go through the normal inputs PATCH, which bumps `inputsUpdatedAt`, so `Scenario.stale`
  flips and the previous result stays visible behind the stale badge. Deliberately **not** a
  field-scoped endpoint like `PATCH /scenarios/{id}/distance-bands`: bands are a reporting lens,
  rates change the objective.

### 5.2 Distances tab, two added columns

`JadeDistancesTab` (header at `JadeDistancesTab.tsx:744-752`: Leg / From / To / Base / Override /
actions) gains:

- **`$/ton`** — `max(rate × effectiveDistance, min)` using the leg's rate pair and
  `effectiveDistance = override ?? base` in canonical miles. The value is a dollar amount per ton and
  so carries no distance unit; it does not change when the display toggle flips.
- **`Min?`** — marks the row when `rate × effectiveDistance <= min`, i.e. the minimum charge is what
  the lane actually pays. This is the educational payload: it shows at a glance which short lanes are
  insensitive to the rate.

Both are derived at render time from the same four values the tab above edits, so they cannot drift.

### 5.3 Cost summary and Compare

`CostSummaryTab` already renders JADE's `inboundCost`/`outboundCost` (`:347-351`) and has a
per-scenario Compare column path (`:460-475`). The four rates follow the identical pattern: a
"solved at" block in the single-scenario view and one column per scenario in Compare, each read from
that scenario's own `result.metrics.transportRates`, falling back to the textbook values labelled as
such when the key is absent (a pre-change result).

---

## 6. Testing

Python (`artifacts/api-server/src/solver/tests/`):

- `transportCosts` absent ⇒ objective identical to the current constants (the back-compat lock).
- A supplied rate changes the objective in the predicted direction and magnitude on a small fixture.
- Minimum-charge boundary cases, extending the two already written at `test_jade.py:162-163`
  (200 mi inbound at 0.07 = $14, rate governs; 10 mi outbound at 0.12 = $1.20, the $10 min governs) —
  re-run with a non-default rate so the *crossover* point moves.
- `min = 0` disables the floor; `rate = 0` makes the min govern every lane on that leg.
- `e2e_accuracy.py` run unmodified, expecting 99/99.

API (`artifacts/api-server`, vitest):

- `jadeInputs` accepts a complete object, rejects a partial one, rejects negative/non-finite.
- `buildPayload` passes `transportCosts` through for JADE and omits it for every other model.
- `ResultEnvelopeSchema` round-trips `metrics.transportRates` and still validates an envelope
  without it.

Studio (`artifacts/studio`, vitest/RTL):

- Tab renders the four fields seeded from inputs, and from the textbook defaults when absent.
- **Toggle km → mi → km leaves the stored canonical value exactly `0.07`** (the §2.4 guard; this is
  the single most important frontend test in this spec).
- km mode shows `0.0435`, not `0.1127` (the reciprocal-conversion regression).
- Derived `$/ton` column and `Min?` marker compute correctly, including on a lane with a distance
  override.
- Reset clears the key rather than writing the defaults.

Playwright (`artifacts/studio/e2e`): edit a rate, solve, assert the total cost changes and the stale
badge appears on edit. Per the repo's standing step, grep `e2e/` for any JADE testid or visible
string this bundle changes and rewrite the sibling specs **before** merge, not after.

Full gate per CLAUDE.md, plus `e2e_accuracy.py` by hand (the pytest-only gate does not run it), plus
a concurrent-vitest check (`ps aux | grep "[v]itest" | grep -v "zsh -c"` must be empty) before
trusting the studio suite.

---

## 7. Out of scope

Stated so a reviewer can object now rather than discovering a gap later:

- **Per-lane rate overrides** and **per-product rates** — §2.2.
- **CSV export/import of the rates.** The export entity registry (`templates.ts` / `import.ts` /
  the route pairing checks) is untouched; rates are four scalars on the scenario, not a row-shaped
  entity. They do become visible in the `costSummary` export only if §5.3's envelope field is added
  to `CostSummaryExportRow`, which this spec does **not** do.
- **Other models.** `two-echelon-gold-au` has its own `laneCosts` tab and `delivery-teaching-us` its
  own `deliveryCosts` lane table; neither is refactored toward a shared abstraction here.
- **The `dist.get(..., 9999)` sentinel** — §4.
- **Rates as dataset files.** They stay solver constants + scenario inputs; no new JSON under
  `solvers/two-echelon-jade-us/dataset/`, so `version.json`/sha256 and `PACKAGE_SPECS` are untouched.

---

## 8. Definition of done

- [ ] All eight registration points of §3.2 landed, codegen committed with its spec change.
- [ ] `e2e_accuracy.py` passes 99/99 unmodified.
- [ ] Full verification gate green: `pnpm run typecheck`, api-server vitest, studio vitest, solver
      pytest.
- [ ] `pnpm e2e:gate` green, with any JADE sibling specs rewritten.
- [ ] A scenario with no `transportCosts` solves to the same objective it did before the change.
- [ ] Unit-toggle round-trip leaves a stored rate bit-identical.
- [ ] Changelog entry in `docs/CHANGELOG-implementation.md` in the same commit as the work.
- [ ] `/harness-retro <task_id>` run.
