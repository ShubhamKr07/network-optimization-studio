# Model integration pre-check

**Use this before integrating any new optimization model.** Generalized from the
`two-echelon-gold-au` integration and the SCN v0.3 Input Map v2 rollout; not specific to either.

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

## Gate 1 — The ten registration points

Adding a model is **ten** registrations across five packages. Each omission fails differently.
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
- [ ] **9. Override entity registration (import/export)** — `services/templates.ts`
      (`apply<Entity>Overrides` + `<entity>RowsToCsv`), `services/import.ts` (`ImportEntity` union +
      `COLUMNS`/`ENTITY_HAS_VALUE`/`VALID_STATUSES`), `routes/scenarios.ts` (entity union + the
      model↔entity pairing checks repeated in `GET .../export`, `POST .../import`,
      `POST .../import/apply`, and `POST .../reset-to-baseline`).
      *Miss:* the model solves fine and lists fine — export/import/reset-to-baseline just 422 with
      no other symptom, or worse, silently validate against the *wrong* dataset if your new model
      reuses an existing entity name like `"customers"` (thread `modelId` through
      `parseAndValidateImport` to disambiguate — see its `modelId` parameter). This is exactly what
      shipped for `two-echelon-gold-au`: fully solvable, zero override-editing UI, for a full session
      before anyone noticed. Not every entity has a value column either — a status-only entity
      (no capacity/demand field at all) needs `ENTITY_HAS_VALUE[entity] = false`, not a reused
      column layout.
- [ ] **10. Map multi-select allowlist** — `Studio.tsx`'s `multiSelectedWarehouseIds` /
      `multiSelectedCustomerIds` / the `<MapBulkEditToolbar>` render gate are a hardcoded
      `modelId === X || modelId === Y` allowlist, entirely separate from every other point on this
      list.
      *Miss:* shift/ctrl-click selection and bulk edit silently do nothing for the new model — no
      error, and easy to miss in manual testing since ordinary single-click flows work fine. If the
      dataset has a non-overridable entity mixed into the same array as overridable ones (e.g. a
      fixed supply node alongside candidate facilities), tag it (`kind` field or equivalent — see
      Gate 2) and exclude it from the multi-select toggle handler in `NetworkMap.tsx`, not just from
      the override UI.

- [ ] **[BLOCKER]** Run the registration consistency test (`registration.test.ts`). If it doesn't
      exist yet, write it — it makes this entire gate automatic for every future model. (Points 9–10
      have no automated equivalent yet — cover them with route/component tests instead, see Gate 7.)

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
- [ ] **[VERIFY]** If your model mixes a non-overridable entity into an array the frontend otherwise
      treats as uniformly overridable (e.g. one fixed mine sharing `Dataset.warehouses` with several
      candidate facilities, `WarehouseCandidate.kind: "mine" | "facility"`), tag it explicitly on the
      wire rather than leaving callers to infer it from id or position. Every consumer — the override
      table, export, import, map multi-select (Gate 1.10) — must filter on the same tag.

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
- [ ] **[BLOCKER]** Override editing is wired for the new model, not just displayed: an
      import/export section (Gate 1.9) and map multi-select + `<MapBulkEditToolbar>` (Gate 1.10).
      A model that solves and renders correctly but silently lacks these is the **default outcome**
      of copying an existing chapter's JSX without also copying its allowlist entries — every
      `modelId === "..."` gate in `Studio.tsx` (left-panel sections, the Overrides block, the
      multi-select props) must be checked for your model, not just the ones that obviously error.
- [ ] **[BLOCKER]** Header title/subtitle come from `chapters.ts`'s `CHAPTERS` lookup
      (`labHeaderTitle`/`labHeaderSubtitle`), not a hardcoded per-model ternary. A ternary with no
      branch for your model doesn't error — it silently renders whichever model the ternary's
      `else` falls back to. This exact bug shipped for `two-echelon-gold-au`: the header read
      "Al's Athletics" (Chapter 3) on every Chapter 10 screen for a full session.
- [ ] **[VERIFY]** Any left-panel section gated to specific models (e.g. a P-value slider, a
      capacity-mode toggle) is scoped to the models that actually have that concept — not left
      ungated (shows for every model, including ones it doesn't apply to) and not over-narrowed to
      a single existing model when a sibling model shares the same concept (e.g. two different
      p-median variants both need a P slider; gating to only one of them regresses the other).

---

## Gate 6.5 — Input Map v2 editor (Workspace tabbed surface)

Since SCN v0.3, the `/workspace` surface has a **map-first editor** (`InputMapTab.tsx`) that lets
students inspect and edit entities directly on the map (symbology, details card, action menus,
create/edit/move/copy/delete dialogs, drag). It is **p-median-us-complete**; every other model
either degrades to the legacy Task-4 pin-drop map or a placeholder until these are wired. This is a
**different component tree** from the Studio-page multi-select (Gate 1.10) — wiring one does not
wire the other. Several of these registrations are per-model allowlists with the same silent-failure
signature as Gate 1.9/1.10.

- [ ] **[BLOCKER]** **InputMapTab variant.** `InputMapTab`'s props are a discriminated union
      (`mode: "pmedian" | "legacy" | "placeholder"`); `Workspace.tsx` picks the variant by
      `modelId`. A new model not added to the full-editor (`pmedian`-style) branch silently renders
      the legacy pin map (or the Brazil placeholder) — it solves and lists fine, but has zero
      symbology/inspect/dialogs. Decide which of the model's entities are **supply (triangles)** vs
      **demand (bubbles)** before wiring.
- [ ] **[BLOCKER]** **Symbology.** `map/statusPresentation.ts` (status→marker style) and
      `map/EntityMarkers.tsx` (triangle/bubble SVG builders) are keyed to the p-median
      warehouse/customer roles. A model with other roles (mines/stations; mines/refineries/customers)
      must map each entity to triangle/bubble and fold its status vocabulary (if any) into the shared
      presentation mapping — never a per-model ternary (same failure mode as the Gate 6 header
      ternary). Bubble size comes from `types.ts`'s `demandRadius` (or the quantile scale) and needs
      the model's demand field.
- [ ] **[BLOCKER]** **Effective-row projection.** `Workspace.tsx` builds `MapWarehouse`/`MapCustomer`
      view models = base dataset ⊕ this scenario's overrides (status/capacity/demand) ∪ added rows,
      and passes that — not raw base data — to the map. A new model must build the same projection
      for its entities, or the map renders base state and ignores every override (an excluded/inactive
      entity still shows as active).
- [ ] **[BLOCKER]** **Added-entity identity.** Entities created on the map (or via the grid/CSV
      add-row) carry a **stable opaque `id`** (`lib/entityId.ts` `newUid` — the distance/lane join
      key, which **never changes on move**) plus a derived **`displayCode`** (`nextDisplayCode`,
      `WH-STATE-CITY-SEQ`). `lib/gazetteer.ts` reverse-geocodes the drop point. The model's
      added-entity Zod schema needs the optional `displayCode` field, and its distance/lane grid must
      display `displayCode`, not the raw uuid (thread `displayCodeById` from `Workspace.tsx` — see the
      p-median `DistancesTab`). Missing the schema field = `displayCode` is silently Zod-stripped on
      every save.
- [ ] **[BLOCKER]** **Auto-estimate distances.** `normalizeAddedEntityDistances` (`routes/scenarios.ts`)
      dispatches by `modelId` to fill missing added-entity distance/lane rows as `estimated` haversine
      on **every** persist path (POST create, PATCH, import/apply). A new model not added to the
      dispatch leaves added entities with no distances → precheck then blocks the solve. Use
      **role-scoped** coordinate maps and the model's distance convention: transport-coal = haversine
      × **circuity 1.17** (the base costs.json factor); two-echelon = **plain haversine per leg**. A
      unit divisor in the objective (e.g. `TRUCKLOAD_KG`) stays in the solver — never bake it into the
      input distance.
- [ ] **[VERIFY]** **Save reconciliation.** Because the normalizer augments `inputs` server-side, the
      Workspace Save `onSuccess` adopts the **response** `inputs` into `localInputs`/`savedInputsRef`/
      the query cache (else the scenario immediately re-flags dirty and the new estimated rows hide).
      Generic across models — confirm it isn't gated to p-median-us.
- [ ] **[VERIFY]** **Move/delete never re-key.** Move regenerates only `displayCode`/coords (the `id`
      is not even a parameter of the confirm) and clears **that entity's own** distance rows; delete
      drops the added row + its own rows. Neither touches the `*Overrides` arrays (those belong to
      base entities and could hold a colliding id). Any new-model edit path must preserve this.

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
- [ ] Export/import route tests: correct entity accepted, sibling models' entities rejected (422),
      apply persists into the right `inputs` field, reset-to-baseline clears it
- [ ] Frontend test: the header title/subtitle shown for the new model is correct — assert the
      new model's text is present AND an existing model's text is absent (a ternary fallback bug
      passes a positive-only assertion)
- [ ] Frontend test: map multi-select props/toolbar actually render for the new model (not just that
      they don't crash)
- [ ] Frontend test (Input Map v2, Gate 6.5): the Workspace `InputMapTab` renders the full editor
      (symbology markers + legend) for the new model, not the legacy/placeholder branch; a created
      added entity mints a role-prefixed uid + `displayCode`; the model's distance/lane grid shows
      `displayCode` not the raw uuid
- [ ] API test (Gate 6.5): `normalizeAddedEntityDistances` fills `estimated` rows for the new model on
      PATCH/POST/import-apply, with the model's distance convention (circuity vs plain haversine), and
      `e2e_accuracy.py` stays unchanged (the normalizer touches only added-entity rows)
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

## Quick reference — the nine silent failures

Ranked by how long they waste before you find them.

| # | Symptom you see | Actual cause |
|---|---|---|
| 1 | New fields never reach the frontend | `resultEnvelope.ts` Zod-strips unknown keys |
| 2 | "My fix did nothing" | Result cache keyed on dataset version, not solver code |
| 3 | Plausible but wrong results | Dispatcher fell through to `solve_pmedian` |
| 4 | Coverage chart reads ~100% | Out-of-range distances absorbed into the last band |
| 5 | Model lists but can't be created | Missing from `VALID_MODEL_IDS` |
| 6 | Model solves, lists, and renders — but override editing (import/export, multi-select) and/or the header title are just missing/wrong, with zero errors anywhere | Gate 1.9/1.10's hardcoded per-model allowlists (`ImportEntity`, the export/import route pairing checks, `Studio.tsx`'s multi-select props, the header ternary) were never extended for the new model |
| 7 | Workspace Input Map has no symbology/inspect/dialogs — just the old pin-drop map (or a blank placeholder) | `InputMapTab`'s `mode` was never set to the full editor branch for the new model (Gate 6.5) |
| 8 | Added entities never get distances; solve is blocked by precheck | `normalizeAddedEntityDistances`'s `modelId` dispatch was never extended (Gate 6.5) |
| 9 | Added-entity id renders as an opaque `aw-…`/`am-…`/`ar-…` uuid in the distance/lane grid | `displayCode` not on the added-entity schema (Zod-stripped) and/or `displayCodeById` not threaded to the model's grid (Gate 6.5) |

None of these produce an error. All nine are cheap to prevent and expensive to diagnose.
