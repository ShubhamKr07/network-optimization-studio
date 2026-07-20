# PRD — Network Optimization Studio v2: From Gamified Demo to Classroom Tool

| | |
|---|---|
| **Status** | Draft for review |
| **Author** | Product (drafted with Claude) |
| **Date** | 19 July 2026 |
| **Version** | 0.1 |
| **Related** | Repo: `ShubhamKr07/network-optimization-studio` · Textbook: Watson et al., *Supply Chain Network Design*, Ch. 3 & 5 |

---

## 1. Problem statement

Network Optimization Studio proves that students can learn facility-location modeling by running a real ILP solver against textbook datasets — but the current product is built as a single-player gamified demo, not a classroom tool. Students cannot log in individually (scenarios are global and overwrite each other), cannot edit the two inputs that matter most pedagogically (per-warehouse capacity and customer demand), and cannot reliably compare scenarios (Compare accepts mismatched models and silently reads stale cached results). The Arcadia quest/XP layer adds maintenance surface without serving the core learning outcome. If we do not fix this, the app cannot be deployed to an actual course cohort.

## 2. Goals

1. **A cohort of 30+ students can use the app concurrently**, each with their own account and their own scenarios, with zero cross-student data collisions.
2. **Students can modify every model input the textbook exercises call for** — number of warehouses (p), overall or per-warehouse capacity, warehouse status, customer status, and customer demand — through the UI or bulk CSV/JSON import.
3. **Bulk data import is safe by construction**: every import is validated (format, syntax, logic) and previewed before any state changes; no invalid file can corrupt a scenario.
4. **Compare answers the pedagogical question** "what did I change and what did it cause?" — input diffs and output diffs, restricted to same-model, solved scenarios only.
5. **Results are legible at a glance**: routes auto-render colored by distance band, bands are re-configurable post-solve without re-solving, achieved gap and runtime are reported, active constraints are always visible, and the map is scoped to the relevant country.

## 3. Non-goals

1. **Instructor dashboards, rosters, grading, or LMS integration** — the auth design must not preclude these (role flag ships), but no instructor-facing UI ships in v2. Separate initiative.
2. **New optimization models or datasets** — v2 works only with the three existing textbook models (Ch. 3 p-median, Ch. 5 transportation LP, Ch. 5 Brazil capacitated p-median). Custom datasets are a future consideration.
3. **SSO / OAuth / institutional identity** — email + password only. SSO is premature until an institution adopts the tool.
4. **Country masking on the map** — v2 ships pan/zoom bounds locked to the dataset country; visually masking the rest of the world is cosmetic polish deferred to a later release.
5. **Mobile-optimized layout** — the tool targets laptop/desktop classroom use. It should not break on tablets, but no mobile-specific design work.
6. **Preserving any Arcadia gamification** — quests, XP, levels, streaks, badges, and leaderboard are removed entirely, not hidden behind a flag.

## 4. Users & personas

- **Student** — enrolled in a supply-chain course; runs assigned labs, experiments with inputs, compares scenarios, exports/imports data for assignments. Primary persona.
- **Self-learner** — works through the textbook independently; same needs as Student minus any course context.
- **Instructor (future)** — not served by v2 UI, but the account model (role flag, scenario ownership) is designed so instructor features can be added without schema migration.

## 5. User stories

**Accounts & ownership**
- As a student, I want to register with email and password and see only my own scenarios, so my work is not overwritten by classmates.
- As a student, I want my solved scenarios to persist across sessions, so I can continue a lab started in a previous class.
- As a returning user with the old cookie-based session, I want a clear prompt to create a real account, so I am not silently locked out.

**Navigation & model selection**
- As a student, I want to pick my lab by textbook chapter from a landing page, so the app mirrors how my course is structured.
- As a student, I want the problem type to be implied by the chapter I chose, so I never have to understand or select a "problem type" dropdown.

**Configuring inputs**
- As a student, I want to set the number of warehouses to open, capacity (uniform or per-warehouse), and customer status/demand in the left panel, so I can run every variation the textbook exercises require.
- As a student, I want an expandable warehouse table (city, capacity, status) and an expandable customer table (city, demand, status), so I can review and edit the full dataset without leaving the page.
- As a student, I want to export either table as CSV or JSON, so I can edit large changes in a spreadsheet or submit data with my assignment.
- As a student, I want to re-import an edited file and see exactly which rows have errors and what will change **before** anything is applied, so a bad file cannot silently corrupt my scenario.
- As a student, I want a one-click "reset to textbook dataset," so I can always get back to the canonical baseline.

**Solving & results**
- As a student, I want solver settings labeled "Optimization gap" and "Max time (seconds)," and the achieved gap and runtime shown after the run, so I understand solution quality.
- As a student, I want routes to appear automatically after a solve, colored by distance band, so I immediately see the network shape.
- As a student, I want to adjust distance bands after the solve and see coverage update instantly, so I can analyze one solution through multiple lenses without re-solving.
- As a student, I want my active constraints (p, capacity, forced-open/inactive counts, excluded customers) always visible while looking at the map, so I never misread a result against the wrong assumptions.
- As a student, I want the map locked to the country containing my warehouses and customers, so I do not get lost panning the world.

**Comparing**
- As a student, I want to compare two or more solved scenarios of the same model and see which inputs differ and how the outputs changed (objective delta, sites opened/closed, reassigned customers, band-coverage shift), so I can explain cause and effect in my lab writeup.
- As a student, I want a clear message when a scenario in my comparison is unsolved or stale (edited after solving), so I never draw conclusions from mismatched data.

## 6. Requirements

Requirements are grouped into six workstreams (WS-A … WS-F) plus cross-cutting items. Priorities: **P0** = v2 does not ship without it; **P1** = high-value fast-follow; **P2** = architectural insurance, design for it but do not build.

### WS-A — Accounts, ownership, and de-gamification *(source items 1, 2)*

**A1 (P0) — Email + password authentication.**
Registration, login, logout. Passwords hashed (argon2 or bcrypt). Session via signed HTTP-only cookie. A `role` field (`student` | `instructor`) exists on the user record, defaulting to `student`; no role-specific UI ships.
- [ ] Given a new visitor, when they register with a valid email and password (min 8 chars), then an account is created and they are logged in.
- [ ] Given an existing email, when registration is attempted, then a clear "account exists" error is shown without leaking whether the password matched.
- [ ] Given invalid credentials at login, when submitted, then a generic failure message is shown (no user enumeration).
- [ ] Passwords are never stored or logged in plaintext; hash verified in code review.
- [ ] The legacy `arcadia_uid` username-only login path is removed; legacy `/callback` and `/mobile-auth/*` endpoints are removed from the OpenAPI spec.

**A2 (P0) — Scenario ownership.**
Add `user_id` (FK, indexed) to `scenarios`. All scenario endpoints (list, get, patch, delete, clone, solve, compare) filter by and enforce the authenticated owner. This is the highest-risk schema change in v2 and blocks WS-D and WS-F.
- [ ] Given student A's scenario, when student B requests it by ID, then the API returns 404 (not 403, to avoid ID enumeration).
- [ ] Given the scenario list endpoint, when called, then only the caller's scenarios are returned.
- [ ] A migration path is defined for pre-existing global scenarios (assign to a system/seed account or archive). *(Decision needed — see Open questions.)*

**A3 (P0) — Remove gamification.**
Delete Arcadia pages (Dashboard, QuestMap, Leaderboard, Badges), `GamificationContext`, `ArcadiaShell`, quest logic, `/progress` routes, and drop the XP/level/streak/badge fields. Sequencing: A1 must land first because current auth lives inside the Arcadia layer.
- [ ] No route, component, context, API endpoint, or DB column related to XP, levels, streaks, badges, quests, or leaderboards remains.
- [ ] App shell, navigation, and login flow function fully with the layer removed (verified by existing Playwright E2E suite, updated).

**A4 (P1) — Solve history.**
Preserve the one useful kernel of the progress system: a per-user record of solves (scenario, timestamp, status, objective). Backend table + minimal "recent solves" list in the UI. Designed so a future instructor view can query it (P2).

### WS-B — Chapter navigation *(source items 3, 4)*

**B1 (P0) — Chapter-based routing.**
Landing page listing labs by chapter: **Chapter 3 — Al's Athletics (p-median)**, **Chapter 5 — Coal transportation (LP)**, **Chapter 5 — Brazil network (capacitated p-median)**. Each routes to its own studio page.
- [ ] Given the landing page, when a student selects a chapter lab, then the studio opens pre-bound to that model with no problem-type selector anywhere in the UI.

**B2 (P0) — `problemType` becomes derived, not deleted.**
The field is removed from all UI but **retained** in the DB, API, and solver dispatch. It is set automatically from the chapter route at scenario creation and is used by Compare to enforce same-model comparison.
- [ ] `problemType` is not user-editable via UI; PATCH requests attempting to change it on an existing scenario are rejected (422).
- [ ] Solver dispatch and Compare validation continue to read the field.

### WS-C — Data layer extraction *(prerequisite for WS-D; from critique of items 5–7)*

**C1 (P0) — Extract datasets from `solve.py`.**
Warehouse and customer datasets (IDs, city, state/region, coordinates, base demand, distance matrices) move from hardcoded Python blobs into canonical data files consumed by **both** the TS server and the Python solver. The frontend's dataset endpoint serves from the same source. Scenario-level overrides (WS-D) are applied on top at solve time.
- [ ] A single canonical dataset file per model exists; `solve.py` and the API load from it; a checksum/version test fails CI if they diverge.
- [ ] `e2e_accuracy.py` still validates textbook answers against the **unmodified** canonical dataset (see X3).

**C2 (P0) — Fix dataset label defects before export ships.**
Correct known errors that become user-visible once export exists: warehouse 23 "San Francisco, MO" and warehouse 25 "St. Louis, FL" (verify coordinates against intended cities). Audit the full warehouse and customer lists for further label/coordinate mismatches.
- [ ] All warehouse and customer city/state labels match their coordinates; audit results documented.
- [ ] Accuracy tests re-validated after corrections (label fixes must not change distances used by the textbook validation; if they do, resolve with the textbook as authority — see Open questions).

### WS-D — Scenario inputs: left panel, tables, import/export *(source items 5, 6, 7)*

**D1 (P0) — Left-panel input controls.**
Left panel exposes, per model where applicable: number of warehouses to open (p), capacity mode (none / uniform / per-warehouse) with uniform value input, and entry points to the warehouse and customer tables (D2/D3).
- [ ] Given any chapter studio, when the student edits p or capacity settings, then values persist via PATCH and are used on the next solve.
- [ ] Capacity mode "per-warehouse" activates the per-WH capacity column in D2 and passes per-WH values through the full contract chain (OpenAPI → Zod → Drizzle → SolveInput → stdin payload → PuLP constraint). *(New solver capability.)*

**D2 (P0) — Warehouse table (expandable).**
Columns: warehouse ID (read-only), city + state (read-only), capacity (editable when mode = per-warehouse), status (active / forced open / inactive). Inline editing with validation; changes persist to the scenario.
- [ ] Given per-WH mode, when a capacity cell is edited to a non-negative number, then it saves; negative or non-numeric input is rejected inline.
- [ ] Status changes are reflected in the next solve as variable bounds (forced open ⇒ Open≥1, inactive ⇒ Open≤0).

**D3 (P0) — Customer table (expandable).**
Columns: customer ID (read-only), city + state (read-only), demand (editable), status (active / excluded). Demand overrides and status persist per scenario and flow to the solver. *(New solver capability: demand overrides.)*
- [ ] Given an edited demand value, when the scenario is solved, then the objective reflects the override (spot-checked in solver tests).
- [ ] Excluding a customer removes them from assignment constraints; the map renders them distinctly (e.g., hollow marker).

**D4 (P0) — Export (CSV & JSON).**
Both tables export in a versioned template. **The stable ID is the join key**; city/state are display-only columns — required because the customer set contains duplicate city names (two Arlingtons, two Kansas Citys, two Springfields, etc.).
- [ ] Exported CSV/JSON includes a template-version header/field and the ID column.
- [ ] Round-trip (export → no edits → import) produces zero changes and zero errors.

**D5 (P0) — Import with validate-preview-apply.**
Import accepts the same template (CSV or JSON, auto-detected). Pipeline: parse → validate → **preview diff + row-level errors** → explicit confirm → atomic apply. Nothing mutates before confirmation.
Validation classes:
- *Format*: wrong file type, unreadable encoding, missing/unknown template version.
- *Syntax*: missing required columns, wrong types, malformed rows (reported with line numbers).
- *Logic*: unknown IDs, negative demand/capacity, invalid status values, duplicate IDs, and cross-field warnings (e.g., total active capacity < total demand for chosen p — **warn, don't block**; infeasibility is a teaching moment).
- [ ] Given a file with 3 bad rows out of 200, when imported, then the preview lists each bad row with line number and error class, and the student chooses "apply valid rows only" or "cancel"; no partial state exists on cancel.
- [ ] Given a file keyed on duplicate city names without IDs, when imported, then it is rejected as a format error with guidance to use the exported template.
- [ ] Given any import error path, when triggered, then the scenario's pre-import state is fully intact (atomicity verified by test).

**D6 (P0) — Reset to textbook baseline.**
One action restores a scenario's warehouse capacities, statuses, demands, and customer statuses to the canonical dataset (with confirmation).

### WS-E — Results & map UX *(source items 8, 9, 10, 11, 12)*

**E1 (P0) — Distance bands move to the right (results) panel and are recomputable post-solve.**
Bands are a reporting lens, not a model constraint. Since solve results include per-assignment distances, band edits recompute coverage **client-side with no re-solve**. UI copy must state that band changes do not change the solution.
- [ ] Given a solved scenario, when a band boundary is edited, then coverage percentages and route colors update in < 200 ms with no network call to the solver.
- [ ] An info hint clarifies "bands re-analyze the current solution; they do not re-optimize."

**E2 (P0) — Always-visible constraint chip bar.**
In place of a floating overlay (rejected: steals map drag/scroll events, occludes markers, collapses on small screens), a slim chip bar sits directly above the map: e.g., `p = 4 · Capacity: uniform 10M · 2 forced open · 1 inactive · 3 customers excluded · demand edited (12)`. Chips are clickable and focus the corresponding input.
- [ ] The chip bar is visible at all scroll positions of the studio page and never overlaps the map canvas.
- [ ] Each chip click opens/scrolls to its source input.

**E3 (P0) — Solver settings relabel + achieved metrics.**
Inputs labeled **"Optimization gap"** and **"Max time (seconds)."** After a run, the results panel shows runtime (already measured) and solution quality. Because PuLP does not cleanly expose CBC's best bound, v2 reports one of: exact achieved gap (if CBC log parsing is implemented) **or** the status statement "proven optimal" / "feasible within configured gap X% (limit reached)". *(Decision needed — see Open questions.)*
- [ ] Post-solve, runtime in seconds and the solution-quality statement are displayed adjacent to the objective.

**E4 (P0) — Auto-show routes, colored by band.**
On solve completion, the routes toggle switches ON automatically and the ~200 assignment polylines render colored with the **same palette** as the band coverage panel (one visual system).
- [ ] Given a completed solve, when results arrive, then routes are visible without user action, and each route's color matches its band's legend color.

**E5 (P0) — Map locked to dataset country.**
Per model, the map applies `maxBounds`, an appropriate `minZoom`, and fit-to-bounds on load: US for Ch. 3 and the coal LP, Brazil for the Brazil lab. Visual masking of other countries is a non-goal (see §3.4).
- [ ] The user cannot pan or zoom the map outside the dataset country's bounds.

### WS-F — Compare v2 *(source item 13)*

**F1 (P0) — Valid comparisons only.**
Compare accepts only scenarios that (a) share `problemType`, (b) belong to the caller, and (c) have a solved, non-stale result. Staleness = inputs modified after the cached solve (see X1).
- [ ] Given scenarios of different models, when comparison is attempted, then the API returns 422 with an explanatory message and the UI prevents the selection upfront.
- [ ] Given an unsolved or stale scenario in the selection, when compared, then the UI labels it "needs solving" with a one-click solve action, and no numbers are shown for it.

**F2 (P0) — Input diff + output diff.**
Side-by-side (2–4 scenarios): input diff (p, capacity mode/values, warehouse statuses, customer statuses, demand overrides — changed values highlighted) and output diff (objective delta in absolute and %, weighted avg distance delta, sites opened/closed between scenarios, count of customers whose assignment changed, band coverage shift).
- [ ] Given two solved same-model scenarios differing only in p (4 vs 5), when compared, then the input diff highlights exactly the p row and the output diff shows objective delta, the specific site(s) added, and the reassigned-customer count.
- [ ] Values identical across scenarios are visually de-emphasized; only differences are highlighted.

**F3 (P1) — Compare map overlay.**
Optional map view overlaying two scenarios' open sites and highlighting reassigned customers.

### Cross-cutting

**X1 (P0) — Result staleness guard.**
Any PATCH that changes a solve-relevant input on a scenario either nulls the cached `result` or sets a `stale` flag (store `solvedAt`; stale if `updatedAt` of solve-relevant fields > `solvedAt`). The studio badges stale results ("inputs changed since last solve"); Compare excludes them (F1). This closes the silent input/result drift bug.
- [ ] Given a solved scenario, when p is changed, then the result is marked stale immediately and the UI reflects it without reload.

**X2 (P1) — Async solve.**
Replace blocking `spawnSync` with async `spawn` + job status: `POST /solve` returns a job ID; the frontend polls (or SSE). Rationale: a 60–120 s solve currently freezes the entire Node process; with 30 concurrent students (A1), sync solving is a pile-up. P1 rather than P0 only if v2 pilots with a small cohort; **must be P0 if launch cohort > ~10 concurrent users.** *(Decision needed — see Open questions.)*
- [ ] Two students solving simultaneously do not block each other's page loads; concurrent solves are capped by a small worker pool (e.g., 2–4) with queued jobs reporting position.

**X3 (P0) — Protect the accuracy baseline.**
The canonical textbook dataset is immutable in the data layer; scenario overrides never mutate it. `pytest` accuracy suite (`e2e_accuracy.py`) continues to validate textbook answers on the untouched baseline; new solver capabilities (per-WH capacity, demand overrides) get their own solver-level tests.
- [ ] CI runs the accuracy suite on every change to the data layer or `solve.py`; it must pass unmodified.

**X4 (P0) — Contract-first discipline.**
Every API change in WS-A/D/E/F starts in `lib/api-spec/openapi.yaml`, followed by Orval codegen. Hand-edits to generated clients/validators are prohibited (enforced by CI check that codegen output is clean).

**P2 (design-for, don't build):** instructor views over solve history and student scenarios; assignment templates seeded by instructors; custom user-uploaded datasets; SSO; country masking on maps.

## 7. Success metrics

*Baseline note: current usage is effectively zero (pre-classroom); targets are hypothesis-based and should be recalibrated after the first pilot cohort.*

**Leading (first 30 days of pilot)**
- **Account activation**: ≥ 90% of enrolled pilot students register and complete ≥ 1 solve (measure: solve history table).
- **Input-editing adoption**: ≥ 70% of students run at least one scenario with a non-default capacity or demand configuration (measure: scenarios with overrides / active students).
- **Import success rate**: ≥ 80% of import attempts end in a confirmed apply (not abandonment); < 5% of applied imports are followed by an immediate reset (proxy for "import corrupted my work").
- **Compare usage**: ≥ 60% of students who solve ≥ 2 scenarios open Compare at least once.
- **Zero cross-user data incidents**: 0 reports/logs of a student reading or overwriting another's scenario.
- **Solve reliability**: ≥ 99% of solve requests return a well-formed result (optimal/infeasible/error with reason), no hung requests; p95 non-solver API latency < 300 ms during a class session.

**Lagging (end of term)**
- **Assignment completion**: ≥ 85% of lab assignments submitted using app exports (instructor-reported).
- **Instructor NPS / re-adoption**: pilot instructor commits to using the tool next term.
- **Support load**: < 1 support request per student per term related to data loss, login, or import confusion.

**Evaluation points**: 1 week after pilot start (activation, reliability), mid-term (adoption metrics), end of term (lagging).

## 8. Open questions

**Blocking (answer before build starts)**
1. **Legacy scenario migration** (Engineering + Product): assign existing global scenarios to a seed account, or archive them? — affects A2 migration.
2. **Launch cohort size** (Product/Instructor): if > ~10 concurrent users, X2 (async solve) is promoted to P0. What is the pilot class size?
3. **Dataset defect resolution** (Product + Instructor/SME): for warehouse 23/25 label-coordinate mismatches, is the textbook's *distance matrix* or the *city label* authoritative? Corrections must not silently break `e2e_accuracy.py`.

**Non-blocking (resolve during implementation)**
4. **Achieved-gap reporting depth** (Engineering): implement CBC log parsing for an exact gap number, or ship the status-statement version in v2 and parse logs in a fast-follow?
5. **Import partial-apply UX** (Design): default to "apply valid rows only" or "all-or-nothing"? Both must exist per D5; which is default?
6. **Demand-override semantics for the transportation LP** (Engineering + SME): Ch. 5 coal LP has supply/demand structure differing from p-median — do D3 demand edits apply there, and how do capacity factors interact?
7. **Email verification** (Product): required at registration, or deferred? (Leans deferred for classroom pilot; instructor vouches for the roster.)

## 9. Timeline & phasing

No external hard deadline is known; the natural target is **ready before the next course term start**. Dependency-ordered phases (each independently shippable to staging):

**Phase 1 — Foundations (blocks everything)**
A1 auth → A2 ownership → A3 de-gamification → B1/B2 chapter routing. Exit: multi-user safe, Arcadia gone, chapters navigable.

**Phase 2 — Data layer**
C1 dataset extraction → C2 defect fixes → X3 accuracy-baseline CI. Exit: single source of truth for datasets, tests green.

**Phase 3 — Inputs (largest phase; one epic, not seven tickets)**
D1 left panel → D2/D3 tables (incl. new solver capabilities: per-WH capacity, demand overrides) → D4 export → D5 import pipeline → D6 reset → X1 staleness guard. Exit: goals 2 and 3 met.

**Phase 4 — Results UX**
E3 labels/metrics → E1 client-side bands → E4 auto-routes → E5 map bounds → E2 chip bar. Exit: goal 5 met. (Mostly parallelizable with late Phase 3.)

**Phase 5 — Compare v2**
F1 validity rules → F2 diffs → (F3 overlay if time permits). Exit: goal 4 met. Sequenced last deliberately — it consumes ownership (A2), problemType enforcement (B2), overrides (D), and staleness (X1).

**Continuous**: X4 contract-first CI from Phase 1 onward; X2 async solve slotted per Open question 2 (before Phase 3 completes if promoted to P0).

## 10. Explicitly rejected alternatives (from design critique)

Recorded to prevent relitigating during implementation:
- **Floating constraint panel over the map** — rejected for event-stealing, marker occlusion, and small-screen collapse; replaced by the chip bar (E2).
- **City-name as import join key** — rejected due to duplicate city names in the dataset; ID-keyed templates (D4).
- **Apply-then-report import errors** — rejected as unsafe; validate-preview-apply (D5).
- **Deleting `problemType`** — rejected; needed for solver dispatch and Compare validity; hidden from UI instead (B2).
- **Country visual masking in v2** — deferred; bounds-locking delivers the pedagogical value at a fraction of the cost (E5, §3.4).
- **Wholesale Arcadia deletion before auth extraction** — rejected; auth currently lives inside the Arcadia layer, so sequence is A1 → A3.
