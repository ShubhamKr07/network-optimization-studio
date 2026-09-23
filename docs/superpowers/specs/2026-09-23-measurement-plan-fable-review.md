# Measurement Plan — Round-4 Approval Review (independent model pass)

**Date:** 2026-09-23 · **Reviewer:** Fable (independent model, per the repo convention that review runs on a separate model from the author) · **Subject:** `../plans/2026-09-22-scnd-measurement-plan.md`

**Status:** Historical record. Not normative. Preserved here verbatim so the fold that follows reads as a real diff against it rather than erasing it — the rule established in `ddad812` after rounds 1–2 of the A-plan reviews were destroyed by folding first.

---

**Verdict: REQUEST CHANGES.**

The three settled architecture decisions and every explicitly rejected scope item are respected; nothing below asks for new instrumentation or rigor. What remains is the same class round 3 targeted — snippets and tests that do not compose with the Canonical API — plus two tests that fail on first run by arithmetic, one task that cannot pass because it imports a module the next task creates, a stopping rule whose code contradicts its own stated rule, and two checkpoints that have no step where they are actually asked. Findings are ordered by severity; each was checked by hand (and, where it was cheap, by executing the same computation).

### F-R1. `Observation` in `measure.py` omits the canonical `gap` field, and `measure_once`'s three constructors disagree — a timeout row is silently re-tagged `kind="timeout"` and vanishes from the failure rate
**Severity: CRITICAL** · M1.2 Step 3 vs Canonical API; constructors on the timeout, unreadable-output and success paths; `test_stats.py`'s `_obs`.

The Canonical API declares `cell_key; case_key; gap; wall_sec; …` (14 fields). The M1.2 dataclass has **no `gap`** (13 fields). The two positional constructors pass 13 positionals **as if `gap` existed**: `Observation(cell.key, case.case_key(cell), cell.gap, time.monotonic() - t0, 0.0, 0.0, 0, 0, None, None, None, False, "timeout")`. Against the snippet's own dataclass this does not raise — it shifts every field by one: `wall_sec=cell.gap`, `cpu_tree_sec=<wall>`, `ok=None`, `error=False`, **`kind="timeout"`**. `aggregate()` drops every row with `kind != "campaign"`, so a hung solve — the exact tail the capacity model most needs — silently leaves `failure_rate`, `n_obs` and `p95_wall`. Conversely, if the implementer follows the Canonical API, the keyword constructor on the success path raises `TypeError` on **every successful observation**, and `test_stats.py`'s `_obs` fails all six M1.4 tests at construction. Both branches are broken; `test_runner.py`'s `_obs` is the only consistent copy.

**Required:** make `measure.py`'s dataclass identical to the Canonical API (add `gap: float` third); switch the two positional constructors to keyword form; add `gap=cell.gap` to the success-path constructor; add `gap=0.0` to `test_stats.py`'s `_obs`. Add one test: a `solve_fn` that sleeps past `timeout_sec=0.2` yields `ok is False`, `error == "timeout"`, `kind == "campaign"`, and appears in `aggregate()`'s `failure_rate`.

### F-R2. `test_simulate.py` passes bare floats where the Canonical API requires `EventSample`; the R3-R4 "required test" does not exist
**Severity: CRITICAL** · M2.3 Step 1 vs Canonical API and the "Required test (R3-R4)" paragraph.

Canonical: `simulate(trace, strata: dict[str, tuple[list[EventSample], float]], workers, seed)`. Every test calls `simulate(trace, {"only": ([2.0], 1.0)}, …)` — a list of floats. Either the implementer honours the contract and all five tests die with `AttributeError: 'float' object has no attribute 'solver_wall_sec'`, or the implementer accepts floats and `cache_class`/`api_overhead_sec`/`consumes_solver_slot` have no exercised path — precisely the "20/60/20 profile not replayable as written" defect R3-R4 was recorded as fixing. The prose says "run a hit-heavy profile and assert worker utilisation is unchanged while end-to-end latency still reflects the API overhead"; no such test is in the block, and Step 4 claims PASS.

**Required:** add a `_ev(wall, api=0.0, cls="cold_miss", slot=True)` helper returning `EventSample` and use it in every stratum; add the cache-hit test: strata `{"hit": ([EventSample("hit", 0.0, 0.3, False)], 1.0)}` at 1 job/s, `workers=1` → `utilization == 0`, `p95_end_to_end ≈ 0.3`, `p95_wait == 0`. State in Step 3 that `p95_end_to_end = wait + solver_wall_sec + api_overhead_sec` and that `consumes_solver_slot=False` events never enter the server heap.

### F-R3. `aggregate()` calls `_mean`, which is never defined — `NameError` on the first usable cell
**Severity: HIGH** · M1.4 Step 3 (five call sites) vs `def mean(xs)`.

`stats.py` defines `mean` (canonical) and then uses `_mean` five times. Three M1.4 tests reach a usable cell and raise. R3-R1's disposition says "`mean`/`relative_half_width` defined" — defined, but not the name the code uses.

**Required:** replace `_mean` with `mean` throughout `aggregate()`.

### F-R4. `test_aggregate_reports_failure_rate` asserts `== 0.1`; the implementation yields `0.09999999999999998`
**Severity: HIGH** · M1.4 Step 1 vs Step 3 (`failure_rate=1 - len(ok) / len(rows)`).

Executed: `1 - 9/10 == 0.1` → `False` (`0.09999999999999998`). The test fails on first run even after F-R3. This is the CLAUDE.md gotcha (boundary equality on a float) in a new coat.

**Required:** compute `failure_rate = (len(rows) - len(ok)) / len(rows)` (exactly `0.1`) — preferable, since it is also what the bootstrap indicator vector measures — **and** assert `pytest.approx(0.1)`.

### F-R5. M1.3's `run_campaign` imports `benchmark.stats`, which M1.4 creates — M1.3 Step 4 "PASS" is unreachable in the stated order
**Severity: HIGH** · M1.3 Step 3 (`from benchmark.stats import bootstrap_ci, relative_half_width, mean`, executed at the top of every call) vs M1.4 Files ("Create: …/stats.py").

The import is at function-body top, so every `run_campaign` call raises `ModuleNotFoundError` regardless of `min_cases`. Four of five M1.3 tests fail; the commit at M1.3 Step 5 would land a red suite. This is task-ordering circularity, the fourth in the programme.

**Required:** swap M1.3 and M1.4 (stats has no dependency on runner), renumbering commits. Swapping is the honest fix.

### F-R6. The stopping rule's code contradicts its declared rule: it stops each gap cell independently on CI width alone — the R3-R3 pairing defect the task claims to have fixed
**Severity: HIGH** · M1.3 prose ("requires *all three* … a minimum retained paired case count shared with every compared gap, and a minimum count of observations in the upper tail") and code comment ("a cell stops only once every gap sharing its stratum is also ready") vs the code (`if len(rows) >= min_cases: … stopped.add(cell.key)`).

The code checks one criterion and adds only `cell.key`. Nothing consults sibling gap cells. Concretely: with a shared cohort of 200, if `a|…|0.0` reaches CI width at 40 observations and `a|…|0.02` runs to 200, the retained sets are 40 vs 200 and the paired objective delta — the only quality evidence the gap alternative has — thins to 40 pairs, quietly. The shared cohort fixes which cases are *scheduled*; it does not fix which are *retained*. `test_same_case_cohort_across_gaps` uses `min_cases=99 > max_cases=3`, so the stop path is never exercised and this cannot be caught.

**Required:** make the stop decision per **stratum**: compute readiness for every gap key of the stratum and add all of them to `stopped` together, only when each has `≥ min_cases` retained and meets `ci_width`. Delete the "upper tail count" criterion from the prose or implement it — a rule that exists only in a sentence is not a rule. Add a test: `gaps=(0.0, 0.02)`, `min_cases=2`, `max_cases=6`, constant `cpu_tree_sec` (CI width 0 → immediate stop) — assert the retained `case_key` sets at both gaps are equal.

### F-R7. `objective_deltas`, `corpus_frequency` and the `objective_delta_*` fields are declared and claimed "implemented and tested here", but appear in neither `stats.py` nor `test_stats.py`; the `CellStats` prose schema contradicts the canonical one; the aggregate CSV has no delta columns
**Severity: HIGH** · Canonical API; M1.4 ("`corpus_frequency()` **is implemented and tested here**"); prose schema (`p50_wall (+CI)`, `mean_peak_rss_tree (+CI)`); trimmed-estimate sentence; M1.5 aggregate columns.

This is MP-R4's own finding recurring after being marked fixed. The `stats.py` dataclass lacks `objective_delta_vs_gap0`/`objective_delta_ci`; no `objective_deltas` or `corpus_frequency` function exists; no test covers them; Step 4 claims 6 passed as if complete. The prose schema still names `p50_wall (+CI)` and `mean_peak_rss_tree (+CI)` — both withdrawn by L-R1. The trimmed-estimate policy has no field anywhere. The aggregate CSV carries `corpus_frequency` but **no** `objective_delta_vs_gap0`, so MP-R3's "relaxed gaps presented as explicit alternatives **with their paired objective-quality deltas**" has no artifact column — the gap decision cannot be made from the deliverable.

**Required:** (a) delete the stale schema and trimmed-estimate sentences; (b) add `objective_deltas(observations)` keyed by `case_key` vs the `gap==0` row of the same `case_key`, excluding-and-counting pairs where either side is `ok=False` or `objective is None` (test: three cases at gaps 0/0.02, one failed at 0.02 → two deltas, `excluded == 1`); `corpus_frequency(observations, manifest)` (test: realised share equals `n_obs`-weighted proportion per stratum); populate `objective_delta_vs_gap0`/`_ci` for non-zero-gap cells; (c) add `objective_delta_vs_gap0,objective_delta_ci_low,objective_delta_ci_high,objective_pairs_excluded` to the aggregate header and its header test.

### F-R8. MP-1 and MP-2 have no executable step that asks and records them, and the self-review table still says "MP-1 before M5.2"
**Severity: HIGH** · Phase 3 preamble (both checkpoints exist only as blockquote prose); P5 ("Every MP-1…MP-4 task ends with an explicit post-answer step … A checkpoint answered anywhere else is not answered"); self-review table ("§2 SLO ratification | **MP-1 before M5.2**") vs the preamble ("MP-1 … fires before the first authoritative run, **NOT before M5.2**").

An agent executing the checkbox list never encounters a `- [ ]` that asks MP-1 or MP-2. M3.1 Step 1 starts recording the pinned set and Step 2 provisions — no MP-2 checkbox precedes it. Nothing drafts the MP-1 table. MP-3 is closer but likewise has no "ask and record" checkbox. MP-4 is the only one with a step. Meanwhile the self-review row asserts the pre-MP-R6 ordering, so the document again holds both orderings.

**Required:** add `- [ ] M3.0 — ask MP-2 verbatim, record answer/UTC/decider in the changelog` as the first checkbox of M3.1; add `- [ ] M3.3b — draft the MP-1 table (every §2 item, starting from the §2 proposals), ask verbatim, record` between M3.3 and M3.4b, and label M3.4b Steps 3–4 "authoritative — requires the M3.3b record"; add a `- [ ] Step 3b — ask MP-3 verbatim, record` to M5.1. Fix the self-review row to "MP-1 (M3.3b) before M3.4b's first authoritative run".

### F-R9. M2.1b physically lives inside Phase 2 with a `node … --plan <id>` step, contradicting its own "does NOT live in Phase 2"; the calibration target service is undefined; worker plans are unreachable before MP-3
**Severity: MEDIUM** · M2.1b block inside "Phase 2 — Capacity model (pure computation, no infra)", ahead of M2.1's own Step 1, vs its own opening line, vs M5.1 ("provision the disposable worker → **calibrate on the worker plan**").

Step 2 runs a Render calibration; an agent walking checkboxes top-down reaches it before M3.1 exists. Step 1's shortlist includes "at most two worker plans", but nothing runs on a worker plan until MP-3 provisions the prototype, so "after MP-1 and MP-2" is necessary but not sufficient for two of three shortlisted plans. `--plan <id>` never says which deployed service is being driven.

**Required:** move the M2.1b block to Phase 5 immediately before M5.2 (leave a one-line pointer in M2.1), state that the vertical comparator is calibrated on the isolated API service and worker plans on the MP-3 prototype, and add `--service <id>` to the command.

### F-R10. `cores_per_slot` has no derivation, so the only cores→slots bridge is unexecutable and `parallel_efficiency` can be counted twice
**Severity: MEDIUM** · M2.1b Step 3 (two formulas for three quantities); MP-R3 #3 prose ("have `required_cores` consume that stored value rather than a caller's guess") vs the Canonical signature and the test passing `parallel_efficiency=0.8`.

`required_cores` already divides by η. If `cores_per_slot` is derived as `cpu_util × plan_cores / N` at the knee, it already embeds the same contention loss, and `map_to_instances` divides by it again — instances over-provisioned by ~1/η with every intermediate number "arithmetically fine" (R3-R2's own warning). No formula means the implementer chooses, and the choice changes the headline.

**Required:** define `cores_per_slot` once, e.g. `cpu_util_at_N × plan_cores / N`, **and** state that `required_cores` is then called with `parallel_efficiency=1.0` when `cores_per_slot` is calibrated (or the reverse) — pick one, forbid the other. Rewrite the MP-R3 #3 sentence to "the *final* call uses the value from `parallel-efficiency.csv`; the function stays parameterised".

### F-R11. `candidate_worker_counts(…, max_instances=…)` bounds **slots**, and nothing states how `map_to_instances`' `(instances, slots)` becomes `simulate`'s `workers`
**Severity: MEDIUM** · Canonical API; the test (`max_instances=8` → `[c.workers …] == list(range(1, 9))`); prose ("explored range … derives from the candidate topology and Render's 100-instance limit").

`workers` is declared as concurrent solver slots; the parameter bounding it is named `max_instances` — the very conflation R3-R2 closed. A 100-instance fleet at 4 slots each is 400 slots; a default of 100 would never explore it. Separately, Phase 2 yields two numbers and no sentence says the simulator is run at `workers = instances × slots` to produce the "predicted queue behaviour" for the analytic count (spec §1.4.1 requires both the calculation and the prediction for *the same* count).

**Required:** rename to `max_workers`, default `100 × slots_per_instance` supplied by the caller; add one sentence to M2.3: "`simulate` is run at `workers = instances × slots` from `map_to_instances`; `candidate_worker_counts` is the sensitivity sweep around it."

### F-R12. M3.3 Step 5's "fail the run if achieved < 99% of intended" contradicts the UI-faithful profile, which is closed-loop per student by definition
**Severity: MEDIUM** · M3.3 Step 1 ("A closed-loop driver invalidates the run"), Step 5, vs the profile table ("One job in flight per student").

Under UI-faithful, a scheduled event for a student whose job is still running cannot be submitted on schedule; achieved < intended is the *expected* outcome, and Step 5 as written fails every UI-faithful run. `outstanding_job_policy` names the knob but not what the driver does on collision, or how that counts against the 99% rule.

**Required:** scope Step 1's invalidation and Step 5's 99% rule to the open-loop profiles; for UI-faithful, declare the collision action (recommend: drop and record `deferred_by_policy`, reported beside achieved rate, excluded from both cost denominators).

### F-R13. M3.4b's soak, burst and restart probe are not attributed to any topology candidate, while M5.2's matrix assigns the restart probe to the *selected* candidate only
**Severity: MEDIUM** · M3.4b Steps 3–4 vs M5.2's matrix and the Phase 3 preamble.

Because MP-1 precedes M3.4b, its runs are authoritative by the preamble's own definition — but for which candidate? If they are the vertical comparator's, the matrix row should cite M3.4b's run IDs and the restart probe is executed on an unselected candidate, contradicting the matrix. If they are harness shakedown, they must be labelled non-authoritative. As written the plan will run a three-hour soak that either duplicates M5.2 or is silently discarded.

**Required:** one sentence in M3.4b: "These are the **vertical comparator's** authoritative representative + burst runs (cited in M5.2's first row); the restart probe here is a harness shakedown, labelled non-authoritative — the authoritative probe is M5.2's selected-candidate run."

### F-R14. `Cell.key` embeds the gap as `str(gap)`, so the real manifest's `gaps: [0, …]` yields `…|0` while every test uses `0.0` → `…|0.0`
**Severity: MEDIUM** · `corpus.py` (`f"…|{self.gap}"`); M1.1 Step 5 (`gaps: [0, 0.005, 0.01, 0.02]`); tests (`|0.0`); M2.1 (`cell.gap != gap` — `0 != 0.0` is `False`, so the cell is selected, but `stats.get(cell.key)` then looks up whatever string the loader produced).

Consistent within one process, but the CSV round-trip reconstructs keys from a re-loaded manifest or a float-parsed `gap` column and can miss `gap=0` — the mandatory baseline — with a `SizingError: required stratum missing` that looks like a corpus defect.

**Required:** `cells()` uses `float(g)`; `load_manifest` normalises `gaps` to floats; one test loads `gaps: [0]` and asserts the key ends `|0.0`.

### F-R15. On timeout, `measure_once` SIGKILLs the forked child but not CBC (the child's child), which keeps burning a core through subsequent observations
**Severity: MEDIUM** · `measure.py` (`os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)`).

The plan promises "a hung solve must not stall the campaign"; it does not stall, but the orphaned CBC contaminates every wall-time and CPU observation that follows on a shared box — exactly the drift R3-R3(b)'s interleaving was meant to prevent from aligning with a cell. This fires only on the tail, which is where it matters.

**Required:** in the child, `os.setsid()` before calling `solve_fn`; on deadline, `os.killpg(pid, signal.SIGKILL)`.

### F-R16. `test_stratified_replay_respects_declared_weights` asserts a ±1.1σ band on a seeded draw — a coin-flip on first run
**Severity: MEDIUM** · M2.3 (`0.015 < r.observed_stratum_mix["slow"] < 0.025` on 1000 events at p=0.02).

Binomial σ = √(1000·0.02·0.98) ≈ 4.4 events; the band is ±5 events. Deterministic under `seed=0`, but the draw pattern depends on how the implementer consumes the RNG, so roughly one implementation in four fails an assertion that is asserting nothing about correctness.

**Required:** 10 000 events with a band at ≥3σ, or assert the count against a `random.Random(0)`-derived expectation.

### F-R17. M1.3 names four required tests; the block asserts only two of them
**Severity: MEDIUM** · M1.3 prose ("campaign `case_id`s within a cell are **all distinct**; … **no measured observation precedes its cell's warm-ups**") vs `test_warmups_all_execute_before_any_measured_row` (asserts three counts, no ordering) and no distinctness assertion anywhere.

A runner that shuffles warm-ups in with measured rows and discards them by flag passes this test unchanged.

**Required:** assert the warm-up set is exactly the first entries of the log, and assert per-cell distinct `case_key` count.

### F-R18. Stale counts and instructions that contradict adjacent tasks
**Severity: MEDIUM** · M2.1 Step 4 ("PASS (**3** passed)" — the block has six tests); M1.3 Step 2/3 ("`Observation` has no `kind`" / "add `kind: str = "campaign"`" — M1.2 already has it, as does the canonical); M3.1 has two "Step 5"; `scripts/measurement/collect-telemetry.mjs` is "Create" in both M3.4a and M3.4b.

R3-R1's disposition says "pass counts derived from the actual blocks"; one was not. The M1.3 instruction, if followed, produces a duplicate field.

**Required:** "6 passed"; delete the M1.3 `kind` instruction; renumber M3.1; own `collect-telemetry.mjs` in M3.4b only.

### F-R19. M1.1's `validate()` prose requires checks the snippet does not perform, and one is load-bearing (`chens-cosmetics-cn` needs `timeLimitSec`)
**Severity: MEDIUM** · prose ("must check: `version`; allowed `model_id` values against `solvers/*/manifest.json`; … allowed gaps; … required input fields per model") vs the code (weights, regime, edit_family, duplicate ids, min cases, duplicate keys only).

Verified in the repo: `solve_chens` reads `inp["gap"]` and `inp["timeLimitSec"]` unconditionally (`solve.py:1341`); the harness injects `gap` but a Chen's case without `timeLimitSec` fails with `KeyError` in the child and becomes an `ok=False` row — an entire stratum reported as 100% failure rather than a manifest error at load time. `version` and `model_id` are also unchecked, so a typo'd model id produces "Unknown modelType" failures at run time instead of a `ManifestError`.

**Required:** implement `version == 1`, `model_id ∈ {six live ids}`, `gap ∈ allowed set`, and a per-model required-key table (minimum: `modelType` for all; `timeLimitSec` for `chens`); one test per check.

### F-R20. Spec coverage: two gaps
**Severity: MEDIUM** · Spec §1.1 ("**Re-measure at `gap=0`** the forced-open JADE regime (the spike's 0.6–3.5 s vs the parent's ~13 s claim)") — no task reports this comparison. Spec MP-3 question lacks "dispatcher-mode configuration", which the plan's MP-3 adds while the spec says "ask verbatim".

**Required:** add a one-line deliverable reporting `two-echelon-jade-us|forced_open|*|0.0` p50/p95 wall beside the 0.6–3.5 s and ~13 s prior claims; reconcile the spec's MP-3 question text with the plan's in the same commit.

---

### Confirmed sound

- **Canonical API vs `test_capacity.py`:** all six tests re-derived — `0.9·1 + 0.1·11 = 2.0`; `0.98·0.5 + 0.02·100 = 2.49`; `required_cores = (2.0·0.694)/(0.8·0.7)`; `map_to_instances(4.0, 8, 0.5, 2e8, 4e9)` → `mem_capped = 20`, `slots = 8`, `instances = 1`; `(4.0, 8, 0.5, 1.5e9, 4e9)` → `slots = 2`, `1 core/instance`, `instances = 4`; missing-stratum raises in cell order. Keyword `CellStats` construction matches the canonical dataclass.
- **`test_corpus.py`:** 2 strata × 2 gaps = 4 cells; the weight check runs before `s["cases"]` is touched, so the malformed fixture reaches "weights must sum to 1"; min-case message matches the regex.
- **`test_runner.py` counts:** 2 cells × 2 warm-ups + 2 × 4 measured = 12 log entries, 8 kept; `min_cases=99` never reaches the stop branch. Seed-3 interleave test executed with the runner's exact RNG consumption order → `a,a,a,b,b,b,b,a` → not sorted → assertion holds. Cohort sharing across gaps holds because `cohort` is keyed by stratum and built on first sight.
- **Queue tests:** 1 server at 1 job/s with 2 s service → `wait_i = i`, p95 (linear interpolation, 100 values) = 94.05 > 50; 2 servers give zero wait and 2.0 s end-to-end → first passer is 2 under SLO 2.5, worker 1 fails. The property-not-digit rewrite is correct.
- **`percentile([1,2,3,4], 0.5) = 2.5`** and the bootstrap bracket test hold.
- **`solve.py`** exposes `solve(inp)` dispatching on `modelType`, and every model reads `inp.get('gap', …)` — the gap injection reaches CBC as `gapRel`. The gap experiment measures what it says.
- **pytest import layout:** `tests/` has no `__init__.py`; with `benchmark/__init__.py` created, rootdir insertion puts `tests/` on `sys.path` for both invocation styles. `_default_solve`'s `parents[2]` resolves to `solver/`.
- **Units:** `required_cores` returns cores; `weighted_mean_service_demand` sums one gap at a time over weights summing to 1; `EventSample.solver_wall_sec` is the occupancy input and `cpu_tree_sec` stays out of the simulator; `map_to_instances` is the sole bridge (subject to F-R10/F-R11).
- **Ordering that is consistent:** MP-2 precedes M3.1 provisioning; MP-3 sits between M5.1's seam and prototype halves; MP-4 is the last M5.4 step; M3.2 precedes M3.3 precedes M3.4b; all-JADE cold-input generation and inter-repetition cleanup are in M3.2 Step 4b.
- **Settled items untouched:** open-loop authoritative load, mean-CPU sizing with p95 as validation, two gates, two cost denominators, isolated environment, 12c-96g/100-instance/Pro-autoscaling limits, no phase hooks, no tree-RSS sampler, geometric 1/2/4/8 sweep, 200 as cap, no topology×profile product. `e2e_accuracy.py` is not touched by any task.
