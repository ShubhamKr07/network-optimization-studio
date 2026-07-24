# Model integration pre-check

**Use this before integrating any new optimization model.** Generalized from the
`two-echelon-gold-au` integration; not specific to it.

Work top to bottom. Each gate must pass before starting the next. The ordering is deliberate —
gates are sequenced cheapest-first, so a wrong assumption surfaces in minutes rather than after a
week of solver work.

Legend: **[BLOCKER]** stop and fix · **[VERIFY]** confirm before proceeding · **[NOTE]** be aware

---

## Gate 0 — Before writing any code

- [ ] **[BLOCKER]** Read `artifacts/api-server/src/solver/resultEnvelope.ts`. Does your model need
      any field the envelope doesn't already define?
      → Zod `z.object()` **strips unknown keys silently**. New fields must be added here or they
      vanish in transit with no error.
- [ ] **[BLOCKER]** Confirm the repo's actual state matches what you're planning against.
      `README.md` describes subsystems that do not exist (see
      `application-audit-and-remediation-plan.md` §B1). Verify with `git ls-files`, not the README.
- [ ] **[VERIFY]** Does an existing model already solve a structurally identical problem? Extending
      a solver beats adding one.
- [ ] **[VERIFY]** Identify the model's echelon count. Every model shipped so far is single-echelon;
      multi-echelon needs `edge.leg` and per-leg metrics.
- [ ] **[NOTE]** Estimate the largest distance/cost in your dataset. If it exceeds the largest
      default distance band, band coverage will silently misreport (see Gate 4).

---

## Gate 1 — The eight registration points

Adding a model is **eight** registrations across five packages. Each omission fails differently.
Tick every row.

- [ ] **1. Manifest** — `solvers/<model-id>/manifest.json`
      *Miss:* model absent from `GET /api/models`; invisible in UI.
- [ ] **2. Dataset version** — `solvers/<model-id>/dataset/version.json` as `{version, sha256}`
      *Miss:* every solve throws inside `readVersion()` **before** the solver spawns. Mandatory.
      Generate `sha256` with `computeSha256()`, never by hand.
- [ ] **3. Zod input schema** — `validation/inputs/<model>.ts` + entry in `KNOWN_SCHEMAS`
      (`registry/modelRegistry.ts`)
      *Miss:* model lists fine; every create/solve returns `Unknown model_id`.
- [ ] **4. Route allowlist** — `VALID_MODEL_IDS` in `routes/scenarios.ts`
      *Miss:* lists fine, validates fine, `POST /scenarios` returns 422. **Most-missed item** —
      it's a hardcoded `Set` entirely separate from the manifest registry.
- [ ] **5. Package spec** — `PACKAGE_SPECS` in `lib/dataset-schema/src/index.ts`
      *Miss:* dataset skips integrity validation and sha256; corruption undetected.
- [ ] **6. Payload builder** — `SolveInput` union + `buildPayload()` branch in `solver/pmedian.ts`
      *Miss:* type error, or payload silently missing your parameters → solver uses defaults.
- [ ] **7. OpenAPI enum** — `modelId` enum in `lib/api-spec/openapi.yaml`, then
      `pnpm --filter @workspace/api-spec run codegen`
      *Miss:* generated client rejects the id. **Never hand-edit** `lib/api-client-react` or
      `lib/api-zod`.
- [ ] **8. Dispatcher** — `solve(inp)` in `solver/solve.py`
      *Miss:* falls through to `solve_pmedian` and **returns a plausible wrong answer**. The
      fallback is silent; there is no unknown-model error.

- [ ] **[BLOCKER]** Run the registration consistency test (`registration.test.ts`). If it doesn't
      exist yet, write it — it makes this entire gate automatic for every future model.

---

## Gate 2 — Dataset integrity

- [ ] **[BLOCKER]** IDs are **stable string slugs**, unique across *all* entity types.
      Numeric IDs that overlap between entity types (a "3" that is both a refinery and a customer)
      are safe inside one Python function and dangerous across HTTP/DB boundaries.
- [ ] **[BLOCKER]** Entry schema matches `lib/dataset-schema` exactly — including `lng` (not `lon`)
      and `state`, which is required by `WarehouseEntry` and has no natural analogue in some
      textbook datasets.
- [ ] **[VERIFY]** Do **not** reuse `MineEntry` unless your model genuinely has `capacity` — it's
      a required field there.
- [ ] **[VERIFY]** Distances/costs copied verbatim from the source, never recomputed. Recomputed
      values are more accurate and less correct when the textbook's answer key is the spec.
- [ ] **[VERIFY]** Any unit-conversion divisor from the source (e.g. a truckload capacity) is a
      **named constant**, not a bare literal that looks like cruft to a future tidier.
- [ ] **[VERIFY]** Coordinate sign/range assertions for the region (southern/western hemispheres are
      negative).
- [ ] **[VERIFY]** Totals asserted against the source (entity counts, total demand, distance-pair
      count).

---

## Gate 3 — Solver hygiene

- [ ] **[BLOCKER]** No `print()` anywhere except the final `print(json.dumps(result))`.
      `jobRunner` does `JSON.parse(stdout)` on the **whole buffer** — any stray output destroys the
      response.
- [ ] **[BLOCKER]** No `writeLP()`. The subprocess inherits the server's working directory and
      concurrent solves race on the filename.
- [ ] **[BLOCKER]** No notebook-only artefacts: `!pip install`, `plotly`, `IPython.display`,
      `init_notebook_mode()`.
- [ ] **[BLOCKER]** `PULP_CBC_CMD(..., msg=False)` — solver chatter goes to stdout otherwise.
- [ ] **[VERIFY]** Binary variables compared with `> 0.5`, never `== 1`. CBC returns
      `0.9999999997`.
- [ ] **[VERIFY]** Flow filters use a **relative** epsilon (`total_demand * 1e-9`), not an absolute
      `< 1` — an absolute threshold silently drops edges if anyone rescales units.
- [ ] **[VERIFY]** Constraints that loop over multiple index sets are checked for
      **over-constraining**. Pattern to watch: a balance constraint written per `(a, b)` pair when
      it should be summed over `a`. Correct for `|a| == 1`, silently wrong for `|a| > 1`, and
      always feasible so nothing errors.
- [ ] **[VERIFY]** Averages computed from flows (`Σ(d × f) / Σf`), never derived from the objective
      — objectives often carry unit divisors that make `obj / demand` wrong by that factor.
- [ ] **[VERIFY]** Division guards on every ratio (`if denominator > 0`).
- [ ] **[VERIFY]** Infeasibility returns a **named cause and a fix**, matching the house style in
      `solve_transport`.

---

## Gate 4 — Distance bands

- [ ] **[BLOCKER]** Largest dataset distance ≤ largest default band, **or** an explicit overflow
      bucket exists.
      The shared band helper assigns out-of-range distances to the *last* band rather than an
      overflow, so coverage reports read ~100% when the truth is far lower. This produces a
      plausible, entirely wrong chart.
- [ ] **[VERIFY]** Manifest `distanceBands` default is sized for the dataset's geography, not
      inherited from a US-scale model.
- [ ] **[VERIFY]** For multi-echelon models, decide which leg bands apply to — banding both legs
      double-counts against total demand.

---

## Gate 5 — Contract & caching

- [ ] **[BLOCKER]** Solver output changes and `resultEnvelope.ts` changes ship in the **same
      commit**. Splitting them yields a correct solver whose new fields are silently discarded.
- [ ] **[BLOCKER]** During development, bump `dataset/version.json`'s `version` on every solver
      logic change — the result cache key covers dataset version but **not** solver code. Otherwise
      you will debug a solver you already fixed.
      (Permanent fix: include a solver-code hash in the cache key.)
- [ ] **[VERIFY]** New envelope fields are **optional**, so existing models are unaffected.
- [ ] **[VERIFY]** `timeLimitSec` is required in the Zod schema. `jobRunner` computes
      `timeLimitSec * 1000 + 15000`; if absent, `setTimeout(fn, NaN)` fires immediately and kills
      every solve.

---

## Gate 6 — Frontend

- [ ] **[VERIFY]** New optional metrics are rendered conditionally — never assume presence.
- [ ] **[VERIFY]** Unknown/absent discriminators (e.g. `edge.leg`) fall back to neutral styling
      rather than throwing.
- [ ] **[VERIFY]** Map bounds come from the manifest via `lib/mapBounds.ts`. Do **not** add another
      country-specific map component.
- [ ] **[VERIFY]** Copy layer maps generic field names (`openWarehouseIds`, `warehouseId`) to
      model-appropriate labels.
- [ ] **[VERIFY]** Numeric inputs round before sending (sliders emit `1.7000000000000002`).
- [ ] **[NOTE]** There is currently **no React error boundary**. A render throw in your panel blanks
      the whole app. Until that's fixed app-wide, defensive rendering is mandatory.

---

## Gate 7 — Tests

- [ ] Baseline: each textbook scenario selects the expected facilities
- [ ] Objective matches the source to `1e-6` relative
- [ ] Constraints hold structurally (balance, demand met per-entity not just in aggregate)
- [ ] Over-constraining guard: synthetic extra entity in the multi-index set
- [ ] The **pedagogical claim** is asserted directly — whatever the exercise teaches should be a
      test, not an emergent property
- [ ] Threshold/tie tests assert a **bracket**, never a specific point (CBC breaks ties
      arbitrarily across versions and platforms)
- [ ] Band overflow not absorbed
- [ ] Infeasibility messages for each reachable cause
- [ ] API: envelope **retains** new fields after Zod parse
- [ ] API: invalid inputs rejected at the boundary, not in the runner
- [ ] Registration consistency test includes the new model
- [ ] **[BLOCKER]** Existing `e2e_accuracy.py` and `e2e_journey.py` pass **unchanged**

---

## Gate 8 — Rollout

- [ ] Land shared-infrastructure changes first, alone, with existing tests green
- [ ] Land dataset + manifest (model listable, not solvable) — cheapest proof the registry works
- [ ] Land solver + envelope together
- [ ] Land API contract + codegen; review the generated diff
- [ ] Land frontend
- [ ] Post-deploy: `GET /api/models` count correct; new model's objectives match source; **each
      existing model's objectives unchanged**

**Rollback triggers**
- Any existing model's accuracy test fails → revert immediately
- API boot failure → revert the manifest (one malformed manifest currently crashes boot)
- Any `Failed to parse solver output` in logs → revert the solver commit

---

## Quick reference — the five silent failures

Ranked by how long they waste before you find them.

| # | Symptom you see | Actual cause |
|---|---|---|
| 1 | New fields never reach the frontend | `resultEnvelope.ts` Zod-strips unknown keys |
| 2 | "My fix did nothing" | Result cache keyed on dataset version, not solver code |
| 3 | Plausible but wrong results | Dispatcher fell through to `solve_pmedian` |
| 4 | Coverage chart reads ~100% | Out-of-range distances absorbed into the last band |
| 5 | Model lists but can't be created | Missing from `VALID_MODEL_IDS` |

None of these produce an error. All five are cheap to prevent and expensive to diagnose.
