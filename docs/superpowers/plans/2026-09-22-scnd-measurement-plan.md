# SCND Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Read "Preflight gates" and the spec's MP-1…MP-4 checkpoints before starting anything** — several tasks stop and ask.

**Goal:** Build the harness and analysis that produce the evidence sizing the Scaling build — capacity ceiling, exact bottleneck, per-solve cost, cache-hit reality, topology winner — without a real cohort.

**Architecture:** Three layers, each consuming the previous one's artifacts. (1) A **local, in-process Python microbenchmark** measures per-solve service demand over a declared stratified corpus and writes raw CSV. (2) A **pure-computation capacity model** implements distribution replay and parameterised sizing — never sizing from p95. (3) An **HTTP load harness** runs against an isolated environment, supplies target-plan calibration, produces the final candidate counts, and validates them. Analysis is deliberately separated from measurement so re-analysis never requires re-running a three-hour soak.

**Tech Stack:** Python 3.13 (PuLP 3.3.2 / CBC), pytest · Node 24 driver for HTTP load · Postgres · Render (isolated environment)

**Spec:** `../specs/2026-09-22-scnd-measurement-design.md`

## Global Constraints

- **Sequencing:** the full Option A rollout ships **before** this plan executes, and the **AP-4 cohort-gate waiver must already be recorded** in `2026-09-22-scnd-correctness-A-full-contract.md`. Verify both in Preflight; do not infer either.
- **Isolated environment only.** Never run the load harness against production (`nos-api`/`nos-postgres`). §1.5 of the spec.
- **No production infra as a committed change.** The worker prototype is disposable scaffolding under MP-3 with a named teardown owner.
- **p95 never sizes capacity.** Capacity comes from mean CPU service demand × declared stratum weights, validated by p95. (M-R8)
- **Corpus composition is never student prevalence.** Declared manifest weights are labelled generator weights; realised `n_obs` shares are labelled observation allocation, never frequency or prevalence. (M-R9)
- **Two cost denominators, always both.** Per successful submitted job (cache hits in) and per successful CBC execution (cache hits out). (M-R10)
- **Never fabricate a metric** — an underivable value is the literal string `unknown` (CLAUDE.md).
- **Benchmark unit tests must not run real solves.** They execute inside `pnpm --filter api-server test`'s sibling gate (`python3 -m pytest tests/ -x`) and must stay fast; real measurement runs are a separate CLI.
- `e2e_accuracy.py` is sacred (hard rule #2). Nothing here modifies it.

---

## Preflight gates (no code — verify and record)

- [ ] **P1.** Confirm Option A has shipped: `A0…A14b` commits exist and `A13a` pre-activation evidence is committed.
- [ ] **P2.** Confirm the **AP-4 cohort-gate waiver** is recorded in the A plan. If absent → **STOP**, this plan has no authority to run.
- [ ] **P3.** Confirm no dependency edge points back: the A plan must not name Measurement as its own evidence source anywhere. (M-R7's standing bidirectional check.)
- [ ] **P4.** Record all three verifications in `docs/CHANGELOG-implementation.md` with date.
- [ ] **P5 (MP-R9).** Confirm `docs/CHANGELOG-implementation.md` **exists on this branch**. It did not when this plan was first written — it lives on `main`, added via `ch4-fixes` after `scnd-scaling` was cut — so three documents instructed agents to record answers in a file that was not there. Restored 2026-09-23 with the decision record. **Every MP-1…MP-4 task ends with an explicit post-answer step** writing the exact scoped answer, UTC timestamp, decider and referenced artifact/run IDs to that file **before proceeding**. A checkpoint answered anywhere else is not answered.

> **Note for the product owner, surfaced not acted on:** Phase 1 (M1.x) and Phase 2 (M2.x) have **no technical dependency on Option A** — they are a local Python harness plus pure computation, touching no queue, no worker, no Render. They sit behind A only because of the programme-order decision of 2026-09-22. If you ever want early evidence, Phases 1–2 could run without waiting. Raising this once; not reopening the decision.

---

## Canonical API — the single source of truth for M1/M2 (R3-R1)

> **Why this section exists.** Three consecutive reviews found the same defect: snippets that do not compose. The cause was structural, not carelessness — every signature lived in **three** places (the task's Interfaces bullet, its test snippet, its implementation snippet), hand-edited independently, so each fold drifted them apart. `aggregate` ended up declared `(observations, manifest)`, tested `(rows, min_cases=…)` and implemented `(observations)` **in one task**.
>
> **Fix: one copy.** Every signature and schema is defined **here, once**. Task Interfaces bullets point here instead of restating. Implementation snippets are kept only where the logic is genuinely subtle (`measure.py`'s fork/rusage handling); elsewhere the task gives the canonical signature plus a behavioural spec and its tests, because a second hand-maintained copy is what broke.

```python
# ---- corpus.py ----
class ManifestError(ValueError): ...
@dataclass(frozen=True)
class Case:
    case_id: str; inputs: dict; generator_seed: int | None = None
    def case_key(self, cell) -> str: ...        # model|regime|edit_family|case_id (NO gap)
@dataclass(frozen=True)
class Cell:
    model_id: str; regime: str; edit_family: str | None
    gap: float; weight: float; cases: tuple[Case, ...]
    @property
    def key(self) -> str: ...                    # model|regime|edit_family|gap
@dataclass(frozen=True)
class Manifest:
    version: int; strata: list; gaps: list
    def cells(self) -> list[Cell]: ...
    def validate(self, min_cases_per_cell: int) -> None: ...
def load_manifest(path: str, min_cases_per_cell: int = 1) -> Manifest: ...

# ---- measure.py ----
@dataclass
class Observation:
    cell_key: str; case_key: str; gap: float
    wall_sec: float; cpu_tree_sec: float; harness_overhead_sec: float
    python_peak_rss: int; cbc_peak_rss: int
    objective: float | None; solution_status: str | None; termination_reason: str | None
    ok: bool
    resource_complete: bool = True       # False => CPU demand is censored/unknown
    error: str | None = None; kind: str = "campaign"
def normalize_maxrss(value: int, system: str | None = None) -> int: ...
def measure_once(cell: Cell, case: Case, solve_fn=None, timeout_sec: float = 300) -> Observation: ...

# ---- runner.py ----
def run_campaign(manifest, *, min_cases=30, max_cases=200, ci_width=0.10,
                 warmup=3, seed=0, measure=measure_once) -> list[Observation]: ...
def run_determinism(cell, case, *, reps=30, measure=measure_once) -> list[Observation]: ...

# ---- stats.py ----
def mean(xs) -> float: ...
def percentile(xs, q) -> float: ...
def bootstrap_ci(xs, stat, *, reps=2000, alpha=0.05, seed=0) -> tuple[float, float]: ...
def relative_half_width(ci: tuple[float, float], point: float) -> float: ...
@dataclass
class CellStats:
    n_cases: int; n_obs: int; n_success: int; usable: bool
    unusable_reason: str | None = None
    mean_cpu_tree_sec: float = 0.0; mean_cpu_ci: tuple = (0.0, 0.0)
    p95_wall: float = 0.0; p95_wall_ci: tuple = (0.0, 0.0)
    failure_rate: float = 0.0; failure_rate_ci: tuple = (0.0, 0.0)
    objective_delta_vs_gap0: float | None = None
    objective_delta_ci: tuple | None = None
    objective_pairs_excluded: int = 0
    p50_wall: float = 0.0                       # descriptive
    mean_python_peak_rss: float = 0.0           # descriptive
    mean_cbc_peak_rss: float = 0.0              # descriptive
def aggregate(observations, *, min_cases: int) -> dict[str, CellStats]: ...
# Both dicts are keyed by NON-ZERO-GAP cell_key: paired deltas and excluded count.
def objective_deltas(observations) -> tuple[dict[str, list[float]], dict[str, int]]: ...
# Per stratum: declared weight and observation allocation; never conflate them.
def corpus_frequency(observations, manifest) -> dict[str, dict[str, float]]: ...

# ---- report.py ----   (R6-2: the CSVs carry run_id and observation_share, so the
#                        writers take what fills them; nothing else can supply them)
def write_raw(observations, path, *, run_id: str) -> None: ...
def write_aggregates(stats, observations, manifest, path, *, run_id: str) -> None: ...
#   observation_share per row = corpus_frequency(observations, manifest)[stratum]["observation_share"]

# ---- capacity.py ----   (R3-R2: three DISTINCT quantities, never conflated)
class SizingError(ValueError): ...
@dataclass(frozen=True)
class Calibration:
    plan_id: str; app_sha: str; profile_id: str; gap: float
    target_mean_cpu_sec: float; slots_per_instance: int
    cores_per_slot: float; rss_per_slot_bytes: int; instance_memory_bytes: int
    wall_scale_factor: float
def weighted_mean_service_demand(stats, manifest, gap: float) -> float: ...   # CPU-seconds/job
def required_cores(demand_cpu_sec, arrival_rate_per_sec,
                   parallel_efficiency, headroom) -> float: ...               # CORES
def map_to_instances(required_cores: float, slots_per_instance: int,
                     cores_per_slot: float, rss_per_slot_bytes: int,
                     instance_memory_bytes: int) -> tuple[int, int]: ...      # (instances, slots)
def load_calibration(path, *, plan_id, app_sha, profile_id, gap) -> Calibration: ...
# Returns (instances, slots_per_instance, required_cores), using TARGET-plan CPU demand.
def size_calibrated_plan(calibration: Calibration, arrival_rate_per_sec: float,
                         headroom: float) -> tuple[int, int, float]: ...

# ---- simulate.py ----  (R3-R4: wall-time occupancy, explicit cache class)
@dataclass(frozen=True)
class EventSample:
    cache_class: str            # "hit" | "near_miss" | "cold_miss"
    solver_wall_sec: float      # slot occupancy -- NOT cpu_tree_sec
    api_overhead_sec: float     # measured; non-zero even for cache hits
    consumes_solver_slot: bool
@dataclass
class SimResult:
    p50_wait: float; p95_wait: float; p95_end_to_end: float
    max_queue_depth: int; utilization: float; observed_stratum_mix: dict
@dataclass
class CandidateResult:
    workers: int; result: SimResult; passes: bool
def simulate(trace, strata: dict[str, tuple[list[EventSample], float]],
             workers: int, seed: int) -> SimResult: ...
def candidate_worker_counts(trace, strata, *, slo_p95_end_to_end_sec=None,
                            slo_p95_queue_wait_sec=None,
                            max_workers: int, seed: int = 0) -> list[CandidateResult]: ...
def build_event_samples(observations, cache_class_by_case_key,
                        api_overhead_by_cache_class,
                        *, wall_scale_factor: float) -> list[EventSample]: ...
```

**Units, stated once (R3-R2).** `required_cores` returns **CPU cores**. `simulate(workers=…)` takes **concurrent solver slots**. These are *not* interchangeable: a slot may consume less than, equal to, or more than one effective core at the measured concurrency point, and **memory can cap slots before CPU does**. `map_to_instances` is the only place the two meet, and it needs calibrated `cores_per_slot` and `rss_per_slot_bytes` from M2.1b.

## Phase 1 — Solver microbenchmark (local, no infra)

**File structure.** New package `artifacts/api-server/src/solver/tests/benchmark/`:

| File | Responsibility |
|---|---|
| `corpus.py` | Load + validate the stratified corpus manifest; enumerate cells |
| `measure.py` | One observation: fork, time, capture peak RSS, return a record |
| `runner.py` | Orchestrate observations: randomized order, warm-up, stopping rule |
| `stats.py` | Aggregation, percentiles, bootstrap confidence intervals |
| `report.py` | Emit raw rows + aggregates to `docs/superpowers/metrics/` |
| `cli.py` | `python3 -m benchmark.cli run --manifest …` entrypoint |
| `test_*.py` | Fast unit tests, no real solves |
| `corpus/manifest.json` | The declared corpus (data, not code) |

### Task M1.1: Corpus manifest — schema, loader, cell enumeration

**Files:**
- Create: `artifacts/api-server/src/solver/tests/benchmark/__init__.py` (empty)
- Create: `artifacts/api-server/src/solver/tests/benchmark/corpus.py`
- Create: `artifacts/api-server/src/solver/tests/benchmark/corpus/manifest.json`
- Test: `artifacts/api-server/src/solver/tests/benchmark/test_corpus.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `ManifestError`, `Case`, `Cell`, `Manifest`, `load_manifest` — **signatures in the Canonical API; not restated here** (R3-R1).

> **MP-R1 — the single most important correction in this fold.** The round-1 design gave each `Cell` **one** `inputs: dict`, and M1.3 then ran that one input 200 times. Those 200 rows measure **runtime variance for one scenario** — precisely what the spec classifies as a *determinism* run — and labelling them `kind="campaign"` does not make them independent. The capacity model would then have been built on 200 repetitions of a single case per cell. **A cell now holds a set of distinct cases**; 200 means **200 distinct `case_id`s**, never 200 trials of one. Repeated execution of a fixed `case_id` is legal only inside `run_determinism()`.

**Manifest validation (review recommendation).** A weights-only check is insufficient for an authoritative corpus. `validate()` must check: `version`; allowed `model_id` values against `solvers/*/manifest.json`; allowed `regime` ∈ {`forced_open`, `free_choice`}; allowed `edit_family` ∈ {`demand`, `capacity`, `force`, `distance`, `null`}; finite non-negative weights summing to 1; allowed gaps; **unique `Cell.key` and unique `case_id` within a cell**; required input fields per model; and that every declared cell has **≥ the configured minimum case count**.

- [ ] **Step 1: Write the failing test**

```python
# test_corpus.py
import json, pytest
from benchmark.corpus import load_manifest, ManifestError

def _stratum(model, regime, fam, weight, n_cases):
    model_type = {"two-echelon-jade-us": "two_echelon_jade",
                  "p-median-us": "p_median"}[model]
    base = ({"modelType": model_type, "p": 3, "distanceBands": [500],
             "timeLimitSec": 60}
            if model == "two-echelon-jade-us" else
            {"modelType": model_type, "p": 3, "capacityMode": "none",
             "distanceBands": [500], "timeLimitSec": 60})
    return {"model_id": model, "regime": regime, "edit_family": fam, "weight": weight,
            "cases": [{"case_id": f"{model}-{i}", "inputs": {**base, "p": 3 + i}}
                      for i in range(n_cases)]}

def test_cells_carry_distinct_cases_not_one_input(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "version": 1,
        "strata": [
            _stratum("two-echelon-jade-us", "free_choice", "demand", 0.5, 3),
            _stratum("p-median-us", "forced_open", None, 0.5, 3),
        ],
        "gaps": [0, 0.005],
    }))
    m = load_manifest(str(p))
    cells = m.cells()
    assert len(cells) == 4                       # 2 strata x 2 gaps
    assert {c.gap for c in cells} == {0, 0.005}
    for c in cells:
        ids = [case.case_id for case in c.cases]
        assert len(ids) == len(set(ids)) == 3     # MP-R1: distinct cases, not repeats

def test_minimum_case_count_is_enforced(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "version": 1,
        "strata": [_stratum("p-median-us", "forced_open", None, 1.0, 2)],
        "gaps": [0],
    }))
    with pytest.raises(ManifestError, match="at least 200 distinct cases"):
        load_manifest(str(p), min_cases_per_cell=200)

def test_weights_must_sum_to_one(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "version": 1,
        "strata": [{"model_id": "p-median-us", "regime": "forced_open",
                    "edit_family": None, "weight": 0.4, "inputs": {}}],
        "gaps": [0],
    }))
    with pytest.raises(ManifestError, match="weights must sum to 1"):
        load_manifest(str(p))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest benchmark/test_corpus.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'benchmark.corpus'`

- [ ] **Step 3: Write minimal implementation**

```python
# corpus.py
import json, math
from pathlib import Path
from dataclasses import dataclass

class ManifestError(ValueError):
    pass

MODEL_TYPES = {
    "p-median-us": "p_median", "p-median-brazil": "capacitated_pmedian",
    "transport-coal": "transport", "two-echelon-gold-au": "two_echelon",
    "two-echelon-jade-us": "two_echelon_jade", "chens-cosmetics-cn": "chens",
}

def _repo_root():
    p = Path(__file__).resolve()
    return next(parent for parent in p.parents
                if (parent / "pnpm-workspace.yaml").exists())

def _required_inputs(model_id):
    manifest = json.loads((_repo_root() / "solvers" / model_id / "manifest.json").read_text())
    # gap is supplied by Cell; modelType is the solve.py dispatcher field.
    return (set(manifest["inputsSchema"]["required"]) - {"gap"}) | {"modelType"}

@dataclass(frozen=True)
class Case:
    case_id: str
    inputs: dict
    generator_seed: int | None = None

    def case_key(self, cell) -> str:
        """L-R4: case_id is unique only WITHIN a cell, but objective deltas
        pair the same case ACROSS gaps. The pairing key therefore excludes
        gap and includes the stratum identity."""
        return f"{cell.model_id}|{cell.regime}|{cell.edit_family or '-'}|{self.case_id}"

@dataclass(frozen=True)
class Cell:
    model_id: str
    regime: str
    edit_family: str | None
    gap: float
    weight: float
    cases: tuple          # tuple[Case, ...] — MP-R1: a SET of distinct cases

    @property
    def key(self) -> str:
        return f"{self.model_id}|{self.regime}|{self.edit_family or '-'}|{self.gap}"

@dataclass(frozen=True)
class Manifest:
    version: int
    strata: list
    gaps: list

    def validate(self, min_cases_per_cell: int) -> None:
        """L-R1: a weights-only check is insufficient for an authoritative
        corpus. Full validation, all failures raising ManifestError."""
        weights = [s["weight"] for s in self.strata]
        if any(not isinstance(w, (int, float)) or not math.isfinite(w) for w in weights):
            raise ManifestError("weights must be finite numbers")
        if abs(sum(weights) - 1.0) >= 1e-9:
            raise ManifestError("stratum weights must sum to 1")
        if any(s["weight"] < 0 for s in self.strata):
            raise ManifestError("weights must be non-negative")
        if self.version != 1:
            raise ManifestError(f"unsupported manifest version: {self.version}")
        live = set(MODEL_TYPES)
        if any(not isinstance(g, (int, float)) or not math.isfinite(g) or
               g not in (0, 0.005, 0.01, 0.02) for g in self.gaps):
            raise ManifestError(f"gap outside the allowed set: {self.gaps}")
        for s in self.strata:
            if s["model_id"] not in live:
                raise ManifestError(f"unknown model_id: {s['model_id']}")
            required = _required_inputs(s["model_id"])
            for c in s["cases"]:
                missing = required - set(c["inputs"])
                if missing:
                    raise ManifestError(
                        f"{s['model_id']} case {c['case_id']} missing {sorted(missing)}")
                if c["inputs"]["modelType"] != MODEL_TYPES[s["model_id"]]:
                    raise ManifestError(
                        f"{s['model_id']} case {c['case_id']} has wrong modelType")
            if s["regime"] not in ("forced_open", "free_choice"):
                raise ManifestError(f"bad regime: {s['regime']}")
            if s.get("edit_family") not in (None, "demand", "capacity", "force", "distance"):
                raise ManifestError(f"bad edit_family: {s.get('edit_family')}")
            ids = [c["case_id"] for c in s["cases"]]
            if len(ids) != len(set(ids)):
                raise ManifestError(f"duplicate case_id in {s['model_id']}")
            if len(ids) < min_cases_per_cell:
                raise ManifestError(
                    f"{s['model_id']} has {len(ids)} cases; need at least "
                    f"{min_cases_per_cell} distinct cases")
        keys = [c.key for c in self.cells()]
        if len(keys) != len(set(keys)):
            raise ManifestError("duplicate cell key")

    def cells(self) -> list:
        return [
            # F-R14: float(g). A manifest written `gaps: [0, ...]` would
            # otherwise key the mandatory baseline as `...|0` while every
            # consumer looks up `...|0.0`, surfacing as "required stratum
            # missing" that reads like a corpus defect after a CSV round-trip.
            Cell(s["model_id"], s["regime"], s.get("edit_family"), float(g), s["weight"],
                 tuple(Case(c["case_id"], c["inputs"], c.get("generator_seed"))
                       for c in s["cases"]))
            for s in self.strata for g in self.gaps
        ]

def load_manifest(path: str, min_cases_per_cell: int = 1) -> Manifest:
    raw = json.loads(open(path).read())
    m = Manifest(raw["version"], raw["strata"], raw["gaps"])
    m.validate(min_cases_per_cell)
    return m
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest benchmark/test_corpus.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Write the real manifest**

Populate `corpus/manifest.json` with all six live models (`p-median-us`, `p-median-brazil`, `transport-coal`, `two-echelon-gold-au`, `two-echelon-jade-us`, `chens-cosmetics-cn`), both regimes where the model supports facility status, the four edit families (`demand`, `capacity`, `force`, `distance`), and `gaps: [0, 0.005, 0.01, 0.02]`. **Weights are declared here and are corpus weights, not student prevalence** — add that sentence as a `"_note"` field in the JSON so it travels with the data.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/solver/tests/benchmark/
git commit -m "[M1.1] benchmark corpus manifest: schema, loader, cell enumeration"
```

### Task M1.2: Single-observation measurement primitive

**Files:**
- Create: `artifacts/api-server/src/solver/tests/benchmark/measure.py`
- Test: `artifacts/api-server/src/solver/tests/benchmark/test_measure.py`

**Interfaces:**
- Consumes: `Cell`, `Case` from M1.1.
- Produces: `Observation`, `normalize_maxrss`, `measure_once` — **signatures in the Canonical API; not restated here** (R3-R1). *(No `build_sec`/`solve_sec` — withdrawn per L-R1; no single tree-RSS field — the two peaks stay separate and labelled.)*

> **MP-R2 — three defects in the round-1 primitive, each of which corrupts the capacity model downstream.**
>
> **1. CBC's CPU was excluded entirely.** `time.process_time()` measures the *Python* process only, and PuLP launches CBC as an **external subprocess** — so the dominant solver CPU never entered `cpu_sec`. M2.1's mean service demand would have been far too small, and every worker count derived from it too low. **Correction:** measure the whole **Python + CBC process tree**, user *and* system time, by having the child report `resource.getrusage(RUSAGE_SELF)` **plus** `RUSAGE_CHILDREN` at exit (CBC is the child's child). `process_time()` alone is insufficient and is removed.
>
> **2. The RSS "delta" could not work.** `RUSAGE_CHILDREN.ru_maxrss` is a **historical high-water mark, not a cumulative counter**, so it cannot be differenced; and `max(after - before, after)` always selects `after` for non-negative values, so the round-1 "fix" was a no-op that silently reported the largest RSS ever seen by any prior observation. **Correction (scoped down by L-R1):** the child reports **`python_peak_rss` and `cbc_peak_rss` separately and labelled accurately** — `RUSAGE_SELF` and `RUSAGE_CHILDREN` at exit. **`max(self, child)` is NOT aggregate tree RSS and must never be labelled as such**; true simultaneous tree RSS would need a sampler this plan deliberately does not build. **Memory sizing uses aggregate *instance* RSS from the authoritative load run** (M3.4b), where it is measured directly. `ru_maxrss` is **KB on Linux, bytes on macOS** — normalise or be wrong by 1024×.
>
> **3. `build_sec = wall - runTimeSec` was not the required split — and the split itself is now out of scope (L-R1).** `solve.py:214` returns `round(run_time, 2)`, quantised to 10 ms, while `wall_sec` also carries fork, import, temp-file, pickle and IPC overhead; for ~0.2 s teaching solves that subtraction is noise-dominated and can go **negative**. My last fold proposed an `on_phase` callback threaded through every solver path to fix it. **That is rejected as disproportionate:** capacity needs **total process-tree CPU and wall time**, neither of which requires a build/solve split. Spawn/import/dataset-load cost is measured where it actually matters — the **paired M4.2 persistent-worker experiment**. No production timing hooks are added. `harness_overhead_sec` still records harness/bootstrap cost separately and is **never** called build time.
>
> **Parent-spec consequence, applied not implied.** The measurement spec §1.1 required a "build-time vs inside-`prob.solve()` split". That requirement is **revised in the spec itself** rather than honoured with invasive hooks — see the spec's §1.1 note.

**Temp files (review recommendation).** `tempfile.mktemp()` is removed — it is deprecated and racy. Use `tempfile.TemporaryDirectory()`, handle child exit status and missing/corrupt output explicitly, and clean up in `finally`.

- [ ] **Step 1: Write the failing test**

```python
# test_measure.py
import time
from benchmark.measure import measure_once, normalize_maxrss
from benchmark.corpus import Cell, Case

def _cell(gap=0.0):
    return Cell("p-median-us", "forced_open", None, gap, 1.0,
                (Case("c1", {"modelType": "p_median"}),))

def _fake_solve(inp):
    return {"objective": 1234.0, "solutionStatus": "optimal",
            "terminationReason": "optimality_proven"}

def test_measure_once_captures_tree_cpu_and_separate_peaks():
    cell = _cell()
    obs = measure_once(cell, cell.cases[0], solve_fn=_fake_solve)
    assert obs.ok is True
    assert obs.cpu_tree_sec > 0            # user+sys across Python AND CBC
    assert obs.python_peak_rss > 0
    assert obs.cbc_peak_rss >= 0           # 0 when no child was spawned
    assert obs.harness_overhead_sec >= 0
    assert obs.cell_key == cell.key
    assert obs.case_key == "p-median-us|forced_open|-|c1"

def test_case_key_is_stable_across_gaps():
    # L-R4: objective deltas pair the same case across gaps, so the key must
    # NOT include gap.
    a, b = _cell(0.0), _cell(0.02)
    assert a.cases[0].case_key(a) == b.cases[0].case_key(b)

def test_measure_once_records_failure_without_raising():
    def boom(inp): raise RuntimeError("cbc exploded")
    cell = _cell()
    obs = measure_once(cell, cell.cases[0], solve_fn=boom)
    assert obs.ok is False
    assert "cbc exploded" in obs.error
    assert obs.objective is None
    assert obs.cpu_tree_sec >= 0           # resources still recorded on failure

def test_timeout_marks_resource_demand_censored():
    def hangs(inp):
        time.sleep(1)
    cell = _cell()
    obs = measure_once(cell, cell.cases[0], solve_fn=hangs, timeout_sec=0.01)
    assert obs.ok is False
    assert obs.resource_complete is False  # zero is not mistaken for zero demand
    assert obs.error == "timeout"

def test_normalize_maxrss_units():
    assert normalize_maxrss(1024, "Linux") == 1024 * 1024   # KB -> bytes
    assert normalize_maxrss(1024, "Darwin") == 1024         # already bytes
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest benchmark/test_measure.py -v`
Expected: FAIL — `No module named 'benchmark.measure'`

- [ ] **Step 3: Write minimal implementation**

```python
# measure.py
import os, platform, resource, signal, time, pickle, tempfile
from dataclasses import dataclass

@dataclass
class Observation:
    cell_key: str
    case_key: str                 # L-R4: (model, regime, edit_family, case_id)
    gap: float                    # F-R1: MUST match the Canonical API. Omitting
                                  # it shifted every positional constructor by
                                  # one field, silently tagging a timeout row
                                  # kind="timeout" -- which aggregate() then
                                  # DROPS, erasing the exact tail the capacity
                                  # model most needs from the failure rate.
    wall_sec: float
    cpu_tree_sec: float           # MP-R2: Python + CBC, user + sys
    harness_overhead_sec: float
    python_peak_rss: int          # L-R1: kept separate, never summed
    cbc_peak_rss: int
    objective: float | None
    solution_status: str | None
    termination_reason: str | None
    ok: bool
    resource_complete: bool = True         # False means CPU/RSS are censored
    error: str | None = None
    kind: str = "campaign"

def normalize_maxrss(value: int, system: str | None = None) -> int:
    system = system or platform.system()
    return value * 1024 if system == "Linux" else value

def _default_solve(inp):
    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
    import solve as solve_mod
    return solve_mod.solve(inp)

def _tree_cpu_and_rss():
    """Whole Python+CBC process tree CPU (user+sys), and the two peaks kept
    SEPARATE.

    MP-R2: process_time() counted only this Python process, excluding the CBC
    subprocess that dominates solver CPU. RUSAGE_CHILDREN covers CBC because
    CBC is *this* child's child.

    L-R1: python_peak and cbc_peak are returned separately and labelled as
    such. max(self, child) is NOT simultaneous tree RSS -- do not label it
    that way. Memory sizing uses aggregate instance RSS from the load run.
    """
    me = resource.getrusage(resource.RUSAGE_SELF)
    kids = resource.getrusage(resource.RUSAGE_CHILDREN)
    cpu = me.ru_utime + me.ru_stime + kids.ru_utime + kids.ru_stime
    return cpu, normalize_maxrss(me.ru_maxrss), normalize_maxrss(kids.ru_maxrss)

def measure_once(cell, case, solve_fn=None, timeout_sec: float = 300) -> Observation:
    solve_fn = solve_fn or _default_solve
    t_start = time.monotonic()
    with tempfile.TemporaryDirectory() as tmpdir:      # MP-R2: never mktemp()
        out_path = os.path.join(tmpdir, "obs.pkl")
        t0 = time.monotonic()
        pid = os.fork()
        if pid == 0:
            os.setsid()          # F-R15: own process group, so CBC dies with us
            rec = {}
            try:
                # L-R1: no on_phase hook. Capacity needs total tree CPU and
                # wall time; spawn/import cost is M4.2's paired experiment.
                env = solve_fn({**case.inputs, "gap": cell.gap})
                cpu, py_peak, cbc_peak = _tree_cpu_and_rss()
                rec = {"ok": True, "cpu_tree": cpu,
                       "python_peak": py_peak, "cbc_peak": cbc_peak,
                       "objective": env.get("objective"),
                       "status": env.get("solutionStatus"),
                       "reason": env.get("terminationReason")}
            except Exception as e:
                cpu, py_peak, cbc_peak = _tree_cpu_and_rss()
                rec = {"ok": False, "error": str(e), "cpu_tree": cpu,
                       "python_peak": py_peak, "cbc_peak": cbc_peak}
            try:
                with open(out_path, "wb") as f:
                    pickle.dump(rec, f)
            except Exception:
                os._exit(3)          # R3-R1: serialization failure must NOT exit 0
            os._exit(0)
        # R3-R1: bound the wait, kill on deadline, and treat a nonzero child
        # exit or unreadable output as a failed observation -- a hung solve
        # must not stall the campaign, and a corrupt pickle must not escape.
        deadline = t0 + timeout_sec
        status = None
        while time.monotonic() < deadline:
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                break
            time.sleep(0.05)
        else:
            # F-R15: kill the GROUP. SIGKILL on the forked child leaves CBC --
            # the child's child -- burning a core through every subsequent
            # observation, contaminating exactly the tail measurements the
            # interleaved schedule exists to protect.
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                # R6-1: the deadline can land before the child's os.setsid()
                # ran (no group `pid` exists yet). It has not started the
                # solve either, so killing the process alone is complete.
                os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
            return Observation(cell_key=cell.key, case_key=case.case_key(cell),
                               gap=cell.gap, wall_sec=time.monotonic() - t0,
                               cpu_tree_sec=0.0, harness_overhead_sec=0.0,
                               python_peak_rss=0, cbc_peak_rss=0, objective=None,
                               solution_status=None, termination_reason=None,
                               ok=False, resource_complete=False, error="timeout")
        wall = time.monotonic() - t0
        code = os.waitstatus_to_exitcode(status)   # waitpid returns the ENCODED status
        try:
            with open(out_path, "rb") as f:
                rec = pickle.load(f)
        except (OSError, EOFError, pickle.UnpicklingError) as e:
            return Observation(cell_key=cell.key, case_key=case.case_key(cell),
                               gap=cell.gap, wall_sec=wall, cpu_tree_sec=0.0,
                               harness_overhead_sec=0.0, python_peak_rss=0,
                               cbc_peak_rss=0, objective=None,
                               solution_status=None, termination_reason=None,
                               ok=False, resource_complete=False,
                               error=f"unreadable child output (exit {code}): {e}")
        if code != 0:
            rec = {"ok": False, "error": f"child exited {code}", **rec}
    overhead = (time.monotonic() - t_start) - wall
    return Observation(
        cell_key=cell.key,
        case_key=case.case_key(cell),        # L-R4: stable across gaps
        gap=cell.gap,                        # F-R1
        wall_sec=wall,
        cpu_tree_sec=rec.get("cpu_tree", 0.0),
        harness_overhead_sec=overhead,
        python_peak_rss=rec.get("python_peak", 0),
        cbc_peak_rss=rec.get("cbc_peak", 0),
        objective=rec.get("objective"),
        solution_status=rec.get("status"),
        termination_reason=rec.get("reason"),
        ok=bool(rec.get("ok")),
        resource_complete=True,
        error=rec.get("error"),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest benchmark/test_measure.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/solver/tests/benchmark/measure.py artifacts/api-server/src/solver/tests/benchmark/test_measure.py
git commit -m "[M1.2] benchmark: forked single-observation primitive with normalized peak RSS"
```

> **Task order: M1.4 (`stats.py`) is implemented BEFORE M1.3 (`runner.py`) — F-R5.** `run_campaign` imports `bootstrap_ci`, `relative_half_width` and `mean` from `benchmark.stats` at function-body top, so in the previous order **every** `run_campaign` call raised `ModuleNotFoundError` and M1.3's commit would have landed a red suite. `stats.py` has no dependency on the runner, so swapping is the honest fix — the fourth task-ordering circularity found in this programme. **Execute M1.4 first; commit tags are unchanged.**

### Task M1.3: Runner — randomized order, warm-up, stopping rule, determinism separation *(execute after M1.4)*

**Files:**
- Create: `artifacts/api-server/src/solver/tests/benchmark/runner.py`
- Test: `artifacts/api-server/src/solver/tests/benchmark/test_runner.py`

**Interfaces:**
- Consumes: `Manifest`, `Cell`, `Case` (M1.1); `measure_once`, `Observation` (M1.2).
- Produces: `run_campaign`, `run_determinism` — **signatures in the Canonical API; not restated here** (R3-R1).

**Stopping rule must protect what it feeds (R3-R3, corrected by F-R6).** A cell never stops alone: **every gap cell of its stratum must be ready, and they all stop together**, each having `≥ min_cases` retained **and** meeting `ci_width` on mean CPU. Otherwise `gap=0` can stop early while a relaxed gap runs on, and the paired objective delta quietly thins. Still a cap of `max_cases=200`, not a quota. *(Round 3's prose also named an "upper tail count" criterion that was never implemented. **Deleted rather than left as a sentence** — a rule that exists only in prose is not a rule. If tail stability later proves to need its own criterion, it gets added with its own test.)*

**Declared design (M-R4, corrected by MP-R1):** **200 distinct `case_id`s per sizing cell** — not 200 trials of one case. Warm-ups are **executed and discarded BEFORE the measured schedule is randomized**, not shuffled into it: the round-1 code appended warm-up and measured entries to one list and then shuffled, so a row flagged `warmup` could execute *after* measured observations, which is not a warm-up policy. Warm-up scope is declared as **per cell** (3 per cell). Measured order is randomized across all cells with a recorded seed. Determinism runs are a separate campaign, tagged `kind="determinism"`, and are **excluded from every sizing, frequency and uncertainty aggregate**.

**Tests this task must add (MP-R1):** campaign `case_id`s within a cell are **all distinct**; determinism `case_id`s are **all identical**; **no measured observation precedes its cell's warm-ups**; the same seed reproduces the identical measured order. *(R6-5: F-R17 was folded as "four named, two asserted — accepted", yet the warm-up test still asserted only counts and nothing asserted distinctness. Both are asserted below now; the warm-up/measured distinction is recovered from the fact that `kept` is appended in call order, so the measured rows must be exactly the tail of the call log.)*

- [ ] **Step 1: Write the failing test**

```python
# test_runner.py
from benchmark.corpus import Manifest, Cell
from benchmark.runner import run_campaign, run_determinism

from benchmark.measure import Observation

def _obs(cell, case):
    return Observation(cell_key=cell.key, case_key=case.case_key(cell), gap=cell.gap,
                       wall_sec=1.0, cpu_tree_sec=0.5, harness_overhead_sec=0.01,
                       python_peak_rss=100, cbc_peak_rss=200, objective=1.0,
                       solution_status="optimal", termination_reason="optimality_proven",
                       ok=True)

def _fake_measure_factory(log):
    def _m(cell, case, solve_fn=None, timeout_sec=300):
        log.append((cell.key, case.case_id))
        return _obs(cell, case)
    return _m

def _stratum(model, regime, fam, weight, n=8):
    return {"model_id": model, "regime": regime, "edit_family": fam, "weight": weight,
            "cases": [{"case_id": f"{model}-{i}", "inputs": {}} for i in range(n)]}

def _manifest(gaps=(0.0,)):
    return Manifest(1, [_stratum("a", "forced_open", None, 0.5),
                        _stratum("b", "free_choice", "demand", 0.5)], list(gaps))

def test_warmups_all_execute_before_any_measured_row():
    log = []
    obs = run_campaign(_manifest(), min_cases=99, max_cases=4, warmup=2, seed=1,
                       measure=_fake_measure_factory(log))
    assert len(obs) == 2 * 4                       # 2 cells x 4 measured
    assert len(log) == 2 * 2 + 2 * 4               # warm-ups executed, not kept
    assert all(o.kind == "campaign" for o in obs)
    # R6-5: the ORDER property the test is named for. Measured rows are kept
    # in call order, so they must be exactly the tail of the call log -- every
    # call before that tail is a warm-up, and no warm-up sits among them.
    measured = [(o.cell_key, o.case_key.rsplit("|", 1)[1]) for o in obs]
    assert log[-len(measured):] == measured
    assert len(log) - len(measured) == 2 * 2

def test_campaign_case_ids_are_distinct_within_a_cell():
    # MP-R1: 4 measured rows in a cell are 4 DISTINCT cases, never repeats.
    obs = run_campaign(_manifest(), min_cases=99, max_cases=4, warmup=0, seed=1,
                       measure=_fake_measure_factory([]))
    for key in {o.cell_key for o in obs}:
        keys = [o.case_key for o in obs if o.cell_key == key]
        assert len(keys) == len(set(keys)) == 4

def test_measured_schedule_is_globally_interleaved():
    # R3-R3: draining one cell at a time lets drift align with a cell.
    log = []
    run_campaign(_manifest(), min_cases=99, max_cases=4, warmup=0, seed=3,
                 measure=_fake_measure_factory(log))
    cells = [c for c, _ in log]
    assert cells != sorted(cells)                  # not grouped by cell

def test_all_gaps_of_a_stratum_stop_together():
    # F-R6: constant cpu_tree_sec -> CI width 0 -> immediate readiness. If a
    # cell could stop alone, the retained sets would diverge. They must not.
    log = []
    obs = run_campaign(_manifest(gaps=(0.0, 0.02)), min_cases=2, max_cases=6,
                       warmup=0, seed=11, measure=_fake_measure_factory(log))
    ret = lambda g: {o.case_key for o in obs if o.gap == g and o.cell_key.startswith("a|")}
    assert ret(0.0) == ret(0.02)

def test_same_case_cohort_across_gaps():
    # R3-R3: paired objective deltas need full overlap between gaps.
    log = []
    run_campaign(_manifest(gaps=(0.0, 0.02)), min_cases=99, max_cases=3, warmup=0,
                 seed=5, measure=_fake_measure_factory(log))
    at = lambda g: {cid for (k, cid) in log if k.endswith(f"|{g}") and k.startswith("a|")}
    assert at("0.0") == at("0.02")

def test_seed_is_reproducible():
    l1, l2 = [], []
    run_campaign(_manifest(), min_cases=99, max_cases=4, warmup=0, seed=7,
                 measure=_fake_measure_factory(l1))
    run_campaign(_manifest(), min_cases=99, max_cases=4, warmup=0, seed=7,
                 measure=_fake_measure_factory(l2))
    assert l1 == l2

def test_determinism_rows_are_tagged_and_separate():
    cell = _manifest().cells()[0]
    rows = run_determinism(cell, cell.cases[0], reps=3, measure=_fake_measure_factory([]))
    assert len(rows) == 3
    assert all(r.kind == "determinism" for r in rows)
    assert len({r.case_key for r in rows}) == 1    # ONE case, repeated
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest benchmark/test_runner.py -v`
Expected: FAIL — `No module named 'benchmark.runner'`

- [ ] **Step 3: Implement the runner.** `Observation.kind` already exists in M1.2; do not add another field.

```python
# runner.py
import random
from benchmark.measure import measure_once

def run_campaign(manifest, *, min_cases=30, max_cases=200, ci_width=0.10,
                 warmup=3, seed=0, measure=measure_once):
    """L-R1: warm-ups run and are DISCARDED BEFORE the measured schedule is
    randomized -- the round-1 code shuffled them together, so a 'warm-up'
    could execute after measured rows. Each observation uses a DISTINCT Case
    (MP-R1). Stopping is sequential: at least `min_cases`, stop when the
    bootstrap CI half-width on mean CPU demand is within `ci_width` relative,
    cap at `max_cases` -- 200 is a ceiling, not a quota."""
    from benchmark.stats import bootstrap_ci, relative_half_width, mean
    rng = random.Random(seed)

    # R3-R3 (a): ONE shared case cohort per stratum, reused across every gap,
    # so paired objective deltas always have full overlap. Shuffling each gap
    # independently would leave gap=0 and the relaxed gaps holding different
    # case subsets, and the pairing would quietly thin out or bias.
    cohort = {}
    for cell in manifest.cells():
        stratum = (cell.model_id, cell.regime, cell.edit_family)
        if stratum not in cohort:
            cases = list(cell.cases)
            rng.shuffle(cases)
            cohort[stratum] = cases[:max_cases]

    for cell in manifest.cells():                       # warm-ups FIRST, discarded
        for case in list(cell.cases)[:warmup]:
            measure(cell, case)

    # Schedule a CASE GROUP, not independent (cell, case) rows. Every selected
    # case is measured at every sibling gap before readiness is evaluated.
    # Independently shuffling rows and merely stopping siblings together still
    # retains different case sets across gaps when the stop boundary is hit.
    cells_by_stratum = {}
    for cell in manifest.cells():
        cells_by_stratum.setdefault(
            (cell.model_id, cell.regime, cell.edit_family), []).append(cell)
    schedule = [(stratum, case) for stratum, cases in cohort.items()
                for case in cases]
    rng.shuffle(schedule)

    # F-R6: stop per STRATUM, not per cell. Round 3's code added only
    # cell.key and checked CI width alone, so gap=0 could stop at 40 retained
    # cases while gap=0.02 ran to 200 -- and the paired objective delta, the
    # gap alternative's ONLY quality evidence, would thin to 40 pairs
    # silently. The shared cohort fixes which cases are SCHEDULED; this fixes
    # which are RETAINED.
    kept, by_cell, stopped_strata = [], {}, set()
    for stratum, case in schedule:
        if stratum in stopped_strata:
            continue

        # Randomise order within the group to avoid a fixed gap-order bias,
        # but complete the whole group atomically for paired retention.
        siblings = list(cells_by_stratum[stratum])
        rng.shuffle(siblings)
        for cell in siblings:
            obs = measure(cell, case)
            obs.kind = "campaign"
            kept.append(obs)
            by_cell.setdefault(cell.key, []).append(obs)

        def ready(key):
            rows = by_cell.get(key, [])
            if len(rows) < min_cases:
                return False
            # Failed attempts with complete telemetry consumed compute and are
            # service demand. Censored rows cannot justify stopping early.
            if any(not o.resource_complete for o in rows):
                return False
            cpus = [o.cpu_tree_sec for o in rows]
            return bool(cpus) and relative_half_width(
                bootstrap_ci(cpus, mean), mean(cpus)) <= ci_width

        if all(ready(c.key) for c in siblings):
            stopped_strata.add(stratum)         # after the complete case group
    return kept

def run_determinism(cell, case, *, reps=30, measure=measure_once):
    """The ONLY place a fixed case_id is executed repeatedly."""
    rows = []
    for _ in range(reps):
        obs = measure(cell, case)
        obs.kind = "determinism"
        rows.append(obs)
    return rows
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest benchmark/test_runner.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/solver/tests/benchmark/
git commit -m "[M1.3] benchmark runner: randomized order, warm-up discard, determinism tagging"
```

### Task M1.4: Statistics — percentiles, bootstrap CI, per-stratum aggregation

**Files:**
- Create: `artifacts/api-server/src/solver/tests/benchmark/stats.py`
- Test: `artifacts/api-server/src/solver/tests/benchmark/test_stats.py`

**Interfaces:**
- Consumes: `Observation` (M1.2), `Manifest` (M1.1).
- Produces: `mean`, `percentile`, `bootstrap_ci`, `relative_half_width`, `CellStats`, `aggregate`, `objective_deltas`, `corpus_frequency` — **signatures in the Canonical API section; not restated here** (R3-R1).

> **MP-R4 — the round-1 summary did not satisfy the spec's uncertainty contract.** It computed a CI for **p95 only**, while the spec requires raw rows **plus uncertainty** for p50, p95, mean service demand, slow-regime frequency, failure/rejection rates, RSS **and objective delta**. Three further defects: `corpus_frequency()` was declared in the Interfaces block and **never implemented or tested**; no outlier policy was declared; and an all-failure cell hits `walls[0]` on an empty list and **crashes** instead of reporting an unusable cell.

**`CellStats` — schema is in the Canonical API, not restated here (F-R7).** This sentence previously listed `p50_wall (+CI)` and a single `mean_peak_rss_tree (+CI)`, both of which L-R1 withdrew — a third copy of the schema, drifting exactly as the other copies did. CIs are carried on the **four decision metrics only**: mean CPU, p95 wall, failure rate, paired objective delta. Each is a bootstrap interval by the same method and recorded `alpha`.

- **Objective deltas (MP-R4):** computed **paired by `case_id`** against that same case's `gap=0` result. Explicit rule for infeasible / no-incumbent / failed outcomes: the pair is **excluded and counted**, never imputed. Without this, a faster relaxed-gap solve has no quality evidence and the gap experiment cannot be approved.
- **Outlier policy, declared before any measurement:** none are deleted, and **raw rows are preserved in full** — which is the whole policy. *(The round-2 wording also promised a trimmed estimate beside every raw one; no field for it exists anywhere in the schema or CSV, so the promise is **withdrawn** rather than left dangling — F-R7. Preserved raw rows already allow any trimming to be computed later, in the open.)*
- **Unusable cells fail loudly:** zero successes, fewer than the declared minimum distinct cases, or any row with censored resource telemetry sets `usable=False` with a reason. M2.1 **fails closed** on any unusable cell rather than treating it as zero demand. Failed attempts with complete telemetry remain in CPU-demand and wall-occupancy distributions because they consumed real capacity; a timeout recorded as CPU/RSS zero is censored evidence, not zero demand.
- **`objective_deltas()` and `corpus_frequency()` are implemented and tested HERE, with steps (F-R7).** MP-R4 found them declared-but-absent; round 3 marked that fixed and they were still absent — the same finding twice. Concretely:
  - `objective_deltas(observations)` keys its output by **non-zero-gap `cell_key`**, then compares each row against the same `case_key` at `gap==0`. This represents all relaxed gaps without overwriting them. The value is the signed raw delta `objective(gap) - objective(0)`; interpretation remains model-specific. A pair where either side is `ok=False` or `objective is None` is **excluded and counted** (`objective_pairs_excluded`), never imputed. `aggregate()` populates `objective_delta_vs_gap0`/`_ci` for each non-zero-gap cell.
  - `corpus_frequency(observations, manifest)` reports **two different values** per stratum: the declared manifest weight and the realised observation allocation. Sequential stopping changes `n_obs`, so observation allocation is diagnostic and must never be relabelled as generator frequency or student prevalence (M-R9).
  - Tests cover all relaxed gaps, exclusion counts, failed-attempt demand, censored telemetry, and the declared-weight/observation-allocation distinction.
  **Without the delta columns the gap decision cannot be made from the deliverable at all** — MP-R3 requires relaxed gaps to be presented with their paired objective-quality effects, and an artifact with no delta column cannot carry that.

- [ ] **Step 1: Write the failing test**

```python
# test_stats.py
import pytest
from benchmark.corpus import Manifest
from benchmark.measure import Observation
from benchmark.stats import (percentile, bootstrap_ci, aggregate,
                             objective_deltas, corpus_frequency)

def _obs(key, wall, cpu, case="c0", ok=True, kind="campaign", gap=0.0,
         objective=1.0, resource_complete=True):
    # cell_key ends in gap; case_key deliberately does not.
    stratum = key.rsplit("|", 1)[0]
    return Observation(cell_key=key, case_key=f"{stratum}|{case}", gap=gap, wall_sec=wall,
                       cpu_tree_sec=cpu, harness_overhead_sec=0.01,
                       python_peak_rss=1000, cbc_peak_rss=2000, objective=objective,
                       solution_status="optimal", termination_reason="optimality_proven",
                       ok=ok, resource_complete=resource_complete,
                       error=None, kind=kind)

def test_percentile_linear_interpolation():
    assert percentile([1, 2, 3, 4], 0.5) == 2.5
    assert percentile([1], 0.95) == 1

def test_bootstrap_ci_brackets_the_point_estimate():
    xs = [1.0] * 50 + [9.0] * 50
    lo, hi = bootstrap_ci(xs, lambda s: percentile(s, 0.95), reps=500, seed=3)
    assert lo <= percentile(xs, 0.95) <= hi

def test_aggregate_excludes_determinism_rows():
    rows = [_obs("k", 1.0, 0.5, case=f"c{i}") for i in range(10)]
    rows += [_obs("k", 99.0, 99.0, case="c0", kind="determinism") for _ in range(10)]
    stats = aggregate(rows, min_cases=1)
    assert stats["k"].n_obs == 10
    assert stats["k"].n_cases == 10           # 10 DISTINCT cases, not 10 repeats
    assert stats["k"].p95_wall < 2.0          # determinism outliers not included

def test_aggregate_reports_failure_rate():
    rows = [_obs("k", 1.0, 0.5, case=f"c{i}") for i in range(9)]
    rows += [_obs("k", 0.0, 0.0, case="c9", ok=False)]
    assert aggregate(rows, min_cases=1)["k"].failure_rate == pytest.approx(0.1)

def test_all_failure_cell_is_unusable_not_a_crash():
    # L-R1: round 1 indexed walls[0] on an empty list here.
    rows = [_obs("k", 0.0, 0.0, case=f"c{i}", ok=False) for i in range(5)]
    cs = aggregate(rows, min_cases=1)["k"]
    assert cs.usable is False and "no successes" in cs.unusable_reason

def test_under_sampled_cell_is_unusable():
    rows = [_obs("k", 1.0, 0.5, case=f"c{i}") for i in range(3)]
    cs = aggregate(rows, min_cases=30)["k"]
    assert cs.usable is False and "distinct cases" in cs.unusable_reason

def test_failed_attempt_with_complete_telemetry_counts_as_demand():
    rows = [_obs("a|forced_open|-|0.0", 1.0, 1.0, case="c1"),
            _obs("a|forced_open|-|0.0", 3.0, 3.0, case="c2", ok=False)]
    cs = aggregate(rows, min_cases=1)["a|forced_open|-|0.0"]
    assert cs.usable is True
    assert cs.mean_cpu_tree_sec == pytest.approx(2.0)
    assert cs.failure_rate == pytest.approx(0.5)

def test_censored_resource_row_makes_cell_unusable():
    rows = [_obs("a|forced_open|-|0.0", 1.0, 1.0, case="c1"),
            _obs("a|forced_open|-|0.0", 5.0, 0.0, case="c2", ok=False,
                 resource_complete=False)]
    cs = aggregate(rows, min_cases=1)["a|forced_open|-|0.0"]
    assert cs.usable is False and "censored" in cs.unusable_reason

def test_objective_deltas_keep_every_gap_and_count_exclusions():
    rows = []
    for case, base in (("c1", 100.0), ("c2", 120.0), ("c3", 140.0)):
        rows.append(_obs("a|forced_open|-|0.0", 1, 1, case=case,
                         gap=0.0, objective=base))
        rows.append(_obs("a|forced_open|-|0.005", 1, 1, case=case,
                         gap=0.005, objective=base + 1))
        rows.append(_obs("a|forced_open|-|0.02", 1, 1, case=case,
                         gap=0.02, objective=base + 4,
                         ok=(case != "c3")))
    values, excluded = objective_deltas(rows)
    assert values["a|forced_open|-|0.005"] == [1.0, 1.0, 1.0]
    assert values["a|forced_open|-|0.02"] == [4.0, 4.0]
    assert excluded["a|forced_open|-|0.02"] == 1

def test_corpus_frequency_separates_weight_from_observation_allocation():
    manifest = Manifest(1, [
        {"model_id": "a", "regime": "forced_open", "edit_family": None,
         "weight": 0.9, "cases": []},
        {"model_id": "b", "regime": "free_choice", "edit_family": "demand",
         "weight": 0.1, "cases": []}], [0.0])
    rows = [_obs("a|forced_open|-|0.0", 1, 1, case="a1"),
            _obs("b|free_choice|demand|0.0", 1, 1, case="b1"),
            _obs("b|free_choice|demand|0.0", 1, 1, case="b2")]
    freq = corpus_frequency(rows, manifest)
    assert freq["a|forced_open|-"]["declared_weight"] == pytest.approx(0.9)
    assert freq["a|forced_open|-"]["observation_share"] == pytest.approx(1 / 3)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest benchmark/test_stats.py -v`
Expected: FAIL — `No module named 'benchmark.stats'`

- [ ] **Step 3: Write minimal implementation**

```python
# stats.py
import random
from dataclasses import dataclass

@dataclass
class CellStats:
    n_cases: int
    n_obs: int
    n_success: int
    usable: bool
    unusable_reason: str | None = None
    # decision metrics -- these carry uncertainty (L-R1)
    mean_cpu_tree_sec: float = 0.0
    mean_cpu_ci: tuple = (0.0, 0.0)
    p95_wall: float = 0.0
    p95_wall_ci: tuple = (0.0, 0.0)
    failure_rate: float = 0.0
    failure_rate_ci: tuple = (0.0, 0.0)
    objective_delta_vs_gap0: float | None = None
    objective_delta_ci: tuple | None = None
    objective_pairs_excluded: int = 0
    # descriptive -- point estimates, backed by raw rows
    p50_wall: float = 0.0
    mean_python_peak_rss: float = 0.0
    mean_cbc_peak_rss: float = 0.0

def mean(xs):
    return sum(xs) / len(xs)

def relative_half_width(ci, point):
    lo, hi = ci
    return abs(hi - lo) / 2 / abs(point) if point else float("inf")

def percentile(xs, q):
    s = sorted(xs)
    if not s:
        return float("nan")
    if len(s) == 1:
        return s[0]
    pos = q * (len(s) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)

def bootstrap_ci(xs, stat, *, reps=2000, alpha=0.05, seed=0):   # keyword-only, as declared
    rng = random.Random(seed)
    draws = [stat([rng.choice(xs) for _ in xs]) for _ in range(reps)]
    return percentile(draws, alpha / 2), percentile(draws, 1 - alpha / 2)

def objective_deltas(observations):
    """Return raw signed objective deltas and excluded-pair counts per
    non-zero-gap cell. case_key is stable across gaps; cell_key is not."""
    campaign = [o for o in observations if o.kind == "campaign"]
    baseline = {o.case_key: o for o in campaign if o.gap == 0.0}
    values, excluded = {}, {}
    for row in campaign:
        if row.gap == 0.0:
            continue
        values.setdefault(row.cell_key, [])
        excluded.setdefault(row.cell_key, 0)
        base = baseline.get(row.case_key)
        if (base is None or not base.ok or not row.ok or
                base.objective is None or row.objective is None):
            excluded[row.cell_key] += 1
            continue
        values[row.cell_key].append(row.objective - base.objective)
    return values, excluded

def corpus_frequency(observations, manifest):
    """Report declared generator weight separately from realised allocation."""
    rows = [o for o in observations if o.kind == "campaign"]
    total = len(rows)
    counts = {}
    for row in rows:
        stratum = row.cell_key.rsplit("|", 1)[0]
        counts[stratum] = counts.get(stratum, 0) + 1
    out = {}
    for s in manifest.strata:
        fam = s["edit_family"] if s["edit_family"] is not None else "-"
        key = f'{s["model_id"]}|{s["regime"]}|{fam}'
        out[key] = {"declared_weight": s["weight"],
                    "observation_share": counts.get(key, 0) / total if total else 0.0}
    return out

def aggregate(observations, *, min_cases):
    by_cell = {}
    for o in observations:
        if o.kind != "campaign":
            continue
        by_cell.setdefault(o.cell_key, []).append(o)
    delta_values, delta_excluded = objective_deltas(observations)
    out = {}
    for key, rows in by_cell.items():
        ok = [r for r in rows if r.ok]
        n_cases = len({r.case_key for r in rows})
        # L-R1: an all-failure or under-sampled cell is reported as UNUSABLE,
        # never crashed on (round 1 indexed walls[0] on an empty list) and
        # never returned as zero demand (which would shrink sizing silently).
        censored = [r for r in rows if not r.resource_complete]
        if not ok or n_cases < min_cases or censored:
            out[key] = CellStats(n_cases=n_cases, n_obs=len(rows), n_success=len(ok),
                                 usable=False,
                                 unusable_reason=("resource demand censored"
                                                  if censored else
                                                  "no successes" if not ok else
                                                  f"only {n_cases} distinct cases"))
            continue
        # Failures consumed slots and CPU too. Successful-only distributions
        # understate demand exactly when failure/timeout rates rise.
        walls = [r.wall_sec for r in rows]
        cpus = [r.cpu_tree_sec for r in rows]
        deltas = delta_values.get(key, [])
        # L-R1: uncertainty ONLY on decision metrics. p50, RSS and corpus
        # frequency are descriptive -- point estimates plus raw rows suffice.
        out[key] = CellStats(
            n_cases=n_cases, n_obs=len(rows), n_success=len(ok), usable=True,
            mean_cpu_tree_sec=mean(cpus),
            mean_cpu_ci=bootstrap_ci(cpus, mean),
            p95_wall=percentile(walls, 0.95),
            p95_wall_ci=bootstrap_ci(walls, lambda s: percentile(s, 0.95)),
            # F-R4: (n - ok)/n is EXACTLY 0.1 for 9/10; 1 - ok/n gives
            # 0.09999999999999998 and fails an equality assertion on first run.
            failure_rate=(len(rows) - len(ok)) / len(rows),
            failure_rate_ci=bootstrap_ci([0.0 if r.ok else 1.0 for r in rows], mean),
            objective_delta_vs_gap0=mean(deltas) if deltas else None,
            objective_delta_ci=(bootstrap_ci(deltas, mean) if deltas else None),
            objective_pairs_excluded=delta_excluded.get(key, 0),
            p50_wall=percentile(walls, 0.5),                       # descriptive
            mean_python_peak_rss=mean([r.python_peak_rss for r in rows]), # descriptive
            mean_cbc_peak_rss=mean([r.cbc_peak_rss for r in rows]),       # descriptive
        )
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest benchmark/test_stats.py -v`
Expected: PASS (10 passed)

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/solver/tests/benchmark/stats.py artifacts/api-server/src/solver/tests/benchmark/test_stats.py
git commit -m "[M1.4] benchmark stats: percentiles, bootstrap CI, determinism-excluded aggregation"
```

### Task M1.5: CSV report + CLI

**Files:**
- Create: `artifacts/api-server/src/solver/tests/benchmark/report.py`
- Create: `artifacts/api-server/src/solver/tests/benchmark/cli.py`
- Modify: `docs/superpowers/metrics/README.md` (document both new CSVs' columns)
- Test: `artifacts/api-server/src/solver/tests/benchmark/test_report.py`

**Interfaces:**
- Consumes: `Observation` (M1.2), `CellStats` (M1.4).
- Produces: `write_raw`, `write_aggregates` — **signatures in the Canonical API; not restated here** (R3-R1, R6-2: the previous bullet declared `write_raw(observations, path)` and `write_aggregates(stats, manifest, path)`, neither of which could fill the `run_id` or `observation_share` columns it was told to write). CSVs `docs/superpowers/metrics/benchmark-raw.csv` and `benchmark-aggregates.csv`.

**Raw columns (L-R1 — `case_key` is mandatory or the advertised paired re-analysis is impossible from the artifact):**
`run_id,cell_key,case_key,case_id,model_id,regime,edit_family,gap,kind,wall_sec,cpu_tree_sec,harness_overhead_sec,python_peak_rss,cbc_peak_rss,objective,solution_status,termination_reason,ok,resource_complete,error`

Rows are written in measured order (the randomized schedule), so drift across the campaign is analysable from row order. *(R6-2: a `timestamp` column was listed here with nothing to fill it — `Observation` carries no timestamp and adding one would touch all five constructors; the column is deleted rather than the field invented.)* `case_id,model_id,regime,edit_family,gap` are split out of `cell_key`/`case_key` for filtering; the keys stay the join columns.

**Aggregate columns:**
`run_id,cell_key,model_id,regime,edit_family,gap,corpus_weight,observation_share,n_cases,n_obs,n_success,usable,unusable_reason,mean_cpu_tree_sec,mean_cpu_ci_low,mean_cpu_ci_high,p95_wall,p95_wall_ci_low,p95_wall_ci_high,failure_rate,failure_rate_ci_low,failure_rate_ci_high,objective_delta_vs_gap0,objective_delta_ci_low,objective_delta_ci_high,objective_pairs_excluded,p50_wall,mean_python_peak_rss,mean_cbc_peak_rss`

The four `objective_delta_*` columns are **mandatory, not optional** (F-R7): without them the relaxed-gap alternatives have no paired quality evidence in the artifact, and the gap decision MP-R3 requires cannot be made from the deliverable. The M1.5 header test asserts them.

Confidence intervals appear only on the four decision metrics (mean CPU demand, p95 wall, failure rate, and the paired objective delta reported alongside); `p50_wall`, the two RSS columns and `observation_share` are descriptive point estimates backed by the raw rows (L-R1). `corpus_weight` is the declared generator weight; `observation_share` is only the realised allocation after sequential stopping — it is **stratum-level** (`corpus_frequency` output) and is repeated on each of that stratum's gap rows. Neither is student prevalence.

- [ ] **Step 1: Write the failing test** — assert the header row matches the two lists above exactly, that a determinism row appears in raw with `kind=determinism`, that censored rows expose `resource_complete=false`, and that `corpus_weight` and `observation_share` remain separate in aggregates.
- [ ] **Step 2: Run it** — `python3 -m pytest benchmark/test_report.py -v` → FAIL.
- [ ] **Step 3: Implement** `write_raw`/`write_aggregates` with `csv.DictWriter` and the exact headers; `cli.py` generates one `run_id` per invocation and wires `load_manifest → run_campaign → aggregate → write_raw/write_aggregates` behind `argparse` (`--manifest`, `--min-cases`, `--max-cases`, `--ci-width`, `--warmup`, `--seed`, `--out-dir`, `--determinism-cell`). `--determinism-cell <cell_key>` additionally runs `run_determinism` on that cell's **first** case and appends its rows (`kind=determinism`) to the raw CSV under the same `run_id`; they never enter the aggregates.
- [ ] **Step 4: Run it** → PASS.
- [ ] **Step 5: Document the columns** in `docs/superpowers/metrics/README.md`, including the distinction: `corpus_weight` is the **declared generator weight**, `observation_share` is the **realised sampling allocation**, and neither is student prevalence (M-R9).
- [ ] **Step 5b: The JADE re-measure deliverable (F-R20).** Spec §1.1 requires re-measuring the forced-open JADE regime at `gap=0` against the spike's **0.6–3.5 s** and the parent design's **~13 s** claim; the corpus contains the cell but nothing surfaced the comparison. Take `two-echelon-jade-us|forced_open|*|0.0` p50/p95 wall from `benchmark-aggregates.csv` and write the comparison **beside both prior claims** into the **M5.4 final report** — the only report deliverable this plan defines (R6-2: "the benchmark report" named an artifact that does not exist) — citing the `run_id` and rows, and stating explicitly which (if either) the measurement supports. M5.4's report list names this item so it cannot be dropped in transit.
- [ ] **Step 6: Full gate**

Run: `cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x`
Expected: all pass, and the benchmark tests add < 5 s.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/solver/tests/benchmark/ docs/superpowers/metrics/README.md
git commit -m "[M1.5] benchmark CSV report + CLI, metrics README columns"
```

---

## Phase 2 — Capacity model (pure computation, no infra)

**Why separate from Phase 3.** Analysis must be re-runnable without repeating a three-hour soak. Phase 2 consumes Phase 1's CSV and implements the parameterised model; the final counts are materialised **per candidate** only after short target-plan calibration — the vertical comparator at M3.4b Step 2b, worker plans at M5.2 — each recorded **before** that candidate's authoritative run observes it.

### Task M2.1: Service-demand model — mean CPU demand weighted by declared strata

**Files:**
- Create: `artifacts/api-server/src/solver/tests/benchmark/capacity.py`
- Test: `artifacts/api-server/src/solver/tests/benchmark/test_capacity.py`

**Interfaces:**
- Consumes: `CellStats` (M1.4), `Manifest` (M1.1).
- Produces: `SizingError`, `Calibration`, `weighted_mean_service_demand`, `required_cores`, `map_to_instances`, `load_calibration`, `size_calibrated_plan` — **signatures in the Canonical API; not restated here** (R3-R1). **Units:** `required_cores` returns **cores**, never slots.

**The formula (M-R8), stated once so no task re-derives it:** offered work `ρ = λ × E[S_cpu]`, where `λ` is arrival rate and `E[S_cpu]` is the **weighted mean CPU service demand** — not p95, not wall time. Required cores = `ρ / (parallel_efficiency × (1 − headroom))`.

**Free-choice-frequency sensitivity (M-R9, spec §1.1 — R6-7: the spec names it for capacity and this plan had it only for cost in M5.3).** No machinery: call `weighted_mean_service_demand` with a `Manifest` whose stratum weights carry the alternate free-choice share, and report the relative change in `required_cores` beside the declared-weight result. It is labelled a sensitivity **input**, never a forecast.

> **MP-R3 — three corrections, and gap is the important one.**
>
> **1. Gap is a configuration alternative, not a workload dimension.** Round 1 iterated every gap cell and divided by `len(manifest.gaps)`, treating `gap ∈ {0, 0.005, 0.01, 0.02}` as an equal-probability production mix. It is not: production runs at whatever gap is configured, and averaging faster relaxed-gap runs into the mandatory `gap=0` baseline **understates required capacity**. **Correction:** capacity is computed **separately per gap**; `gap=0` is the mandatory baseline; relaxed gaps are presented as explicit alternatives **with their paired objective-quality deltas** (M1.4), never averaged in.
>
> **2. Missing cells must fail closed.** Round 1 did `if cs is None: continue`, so an absent cell **silently reduced** the demand estimate — the failure mode where less evidence produces a smaller, more comfortable number. **Correction:** raise on any required cell that is absent, unusable, or below the minimum distinct-case count.
>
> **3. `parallel_efficiency` must be measured, not guessed.** The spec requires measured per-solve CPU utilisation and parallel efficiency, and local CPU-seconds are **not transferable** to a different Render plan without calibration on that plan. **Correction:** add a **concurrency sweep** (below) on each candidate target plan, keyed by plan/application/profile/gap. The final mapping consumes calibrated `target_mean_cpu_sec` **and** `cores_per_slot`, **both measured at the operating concurrency** (M2.1b Step 3), so contention is already inside them; `required_cores` therefore receives `1.0` in that path and η is applied exactly once.

**M2.1b — calibration, and it does NOT live in Phase 2 (L-R3).** The last fold put a concurrency sweep requiring real Render runs inside a phase labelled *pure computation, no infrastructure*, ahead of MP-2 and MP-3 — so Phase 2 promised an artifact its own position made unobtainable. Corrected ordering:

1. **Phase 2 produces uncalibrated distributions only** — the analytical code, its tests, and candidate counts *parameterised* by efficiency and headroom. No infrastructure, no real runs, no final numbers.
2. **After MP-1 (headroom ratified) and MP-2 (environment approved)**, run a **short calibration** on the shortlisted plans at a **geometric concurrency set — 1, 2, 4, 8** — stopping early when throughput flattens or headroom fails. **Not** every integer on every plan; the sweep exists to find the efficiency knee, not to chart it.
3. **Final candidate counts are produced only after** calibration exists **and** headroom is ratified — they consume both.

> **M2.1b is only documented here; it EXECUTES per target plan once that plan's service exists (F-R9, refined R6-4): the vertical comparator at M3.4b Step 2b, worker plans in Phase 5 immediately before M5.2.** The block previously sat physically inside "Phase 2 — pure computation, no infra" while its Step 2 runs a Render calibration, so an agent walking checkboxes top-down would reach it before M3.1's environment exists. Worse, two of its three shortlisted plans are **worker** plans, which do not exist until MP-3 provisions the prototype in Phase 5 — "after MP-1 and MP-2" was necessary but not sufficient. But "all of it in Phase 5" over-corrected: the vertical comparator's authoritative runs are observed in **M3.4b**, and a calibration scheduled after them would have written that candidate's prediction *after* its result was known — the prediction-before-observation rule M5.2 states, broken for the first matrix row. Its target (the isolated API service) exists from M3.1 and MP-1, MP-2 and M3.3a all precede M3.4b, so nothing stops it running there. **Calibration targets, named:** the vertical comparator is calibrated on the **isolated API service**; worker plans on the **MP-3 prototype**.

**M2.1b is a task, not prose (R3-R5).** It previously named no runner, command, corpus, derivation or consumer — unexecutable by construction.

**Files:** Create `scripts/measurement/calibrate-concurrency.mjs`; output `docs/superpowers/metrics/parallel-efficiency-raw.csv` and `docs/superpowers/metrics/parallel-efficiency.csv`.

- [ ] **Step 1. Define "shortlisted plans" before anything uses the phrase:** the vertical comparator's current plan, plus at most two worker plans whose core/memory ratio brackets `required_cores` from Phase 2's uncalibrated run. Recorded in the run manifest.
- [ ] **Step 2. Run** `node scripts/measurement/calibrate-concurrency.mjs --plan <id> --service <id> --concurrency 1,2,4,8 --corpus representative`, stopping early when throughput flattens (<5% gain) or headroom fails. `--service` is mandatory (F-R9): the isolated API service for the vertical comparator, the MP-3 prototype for worker plans — `--plan` alone never said which deployed service was being driven.
- [ ] **Step 3. Derive per plan/profile/gap — every sizing quantity at the SAME operating concurrency (F-R10, corrected R6-3).** Local CPU seconds are not portable across plans. First measure an idle baseline (no load) to obtain `idle_cpu_core_seconds` per window. Find the knee `N` from the sweep — `parallel_efficiency = (throughput_at_N / N) / throughput_at_1` is the **knee-finding diagnostic**, recorded in the raw CSV and **never a sizing input**. Then, **at `N` and only at `N`**, over the steady measurement window, derive:
  - **`target_mean_cpu_sec = (∫ instance_cpu_cores dt − idle_cpu_core_seconds) / attempted solver executions`** — CPU-seconds per attempted execution **while `N` slots run concurrently**, so per-job CPU inflation under contention (cache/SMT sharing) is inside the number. The denominator includes successful and failed executions because both consume capacity; a missing interval invalidates the row.
  - **`cores_per_slot = cpu_util_fraction_at_N × plan_cores / N`** (`cpu_util_fraction` normalised to `[0,1]`) — cores actually drawn per slot, so contention that shows as *lost utilisation* (lock and I/O stalls) is inside it.
  - `rss_per_slot_bytes = aggregate_instance_rss_at_N / N` · `slots_per_instance = N` · `wall_scale_factor = target_p50_active_solver_wall_at_N / local_p50_wall` from the same case cohort, for queue replay — a slot is occupied for the wall time it sees **under contention**, not the wall time of a lone run.
  **Why `parallel_efficiency=1.0` in the calibrated path, stated exactly.** Round 4 wrote "`cores_per_slot` already embeds contention loss, so η is applied once there". That was half true: `cores_per_slot` captures contention that *lowers utilisation* but **not** contention that *raises CPU-seconds per job* — and for a CPU-bound single-threaded CBC, `cores_per_slot ≈ 1` at every `N`, so with `target_mean_cpu_sec` taken at concurrency 1 η would have been applied **zero** times, under-provisioning by the inflation factor with every intermediate number arithmetically fine (the mirror of the double-count R3-R2 warned about). Measuring `target_mean_cpu_sec` at `N` closes it: `instances = λ · cpu_N / ((1 − h) · N · cores_per_slot)` is exact by construction, because `N · cores_per_slot` is the cores an instance consumes at `N` and `cpu_N` is what each job costs there. **Rule: in the calibrated path `required_cores` is called with `parallel_efficiency=1.0`; η is a sweep diagnostic only.** The function stays parameterised (L-R3) for the uncalibrated Phase 2 path, where η is an assumed input — only the **final** call reads `parallel-efficiency.csv`.
- [ ] **Step 4. Emit two artifacts so the identity key is actually unique.** `parallel-efficiency-raw.csv` contains one row per sweep point: `plan_id,app_sha,profile_id,gap,concurrency,throughput,cpu_util_fraction,cpu_core_seconds,idle_cpu_core_seconds,attempted_executions,p50_active_solver_wall_sec,aggregate_rss,run_id` (R6-3: the previous raw schema lacked the four inputs Step 3's derivations consume, so the derived row could not be audited from the raw one). `parallel-efficiency.csv` contains exactly one derived row per `plan_id,app_sha,profile_id,gap`: `target_mean_cpu_sec,parallel_efficiency,cores_per_slot,rss_per_slot_bytes,instance_memory_bytes,slots_per_instance,wall_scale_factor` plus the source run IDs.
- [ ] **Step 5. Consume it explicitly:** `load_calibration()` selects exactly one row keyed by `plan_id + app_sha + profile_id + gap`; `size_calibrated_plan()` calls `required_cores(target_mean_cpu_sec, ..., parallel_efficiency=1.0, headroom=ratified)` and then `map_to_instances()`. `map_to_instances()` remains pure and never reads a file. For queue prediction, `build_event_samples()` applies the same row's `wall_scale_factor` before running `simulate(workers=instances × slots)`. Uncalibrated Phase 2 output is never a final answer.
- [ ] **Step 6. Validation:** a missing, duplicate, non-positive or mismatched calibration row **fails closed** — no defaulted efficiency, CPU demand, or wall scale.
- [ ] **Step 7. Commit** — `git commit -m "[M2.1b] concurrency calibration runner + parallel-efficiency.csv"`

- [ ] **Step 1: Write the failing test**

```python
# test_capacity.py
import pytest
from benchmark.capacity import (weighted_mean_service_demand, required_cores,
                                map_to_instances, size_calibrated_plan,
                                load_calibration, Calibration, SizingError)
from benchmark.stats import CellStats
from benchmark.corpus import Manifest

def _cs(cpu):                       # keyword construction -- see Canonical API
    return CellStats(n_cases=200, n_obs=200, n_success=200, usable=True,
                     mean_cpu_tree_sec=cpu)

def _stats(a_cpu, b_cpu):
    return {"a|forced_open|-|0.0": _cs(a_cpu), "b|free_choice|demand|0.0": _cs(b_cpu)}

def _stratum(model, regime, fam, weight):
    return {"model_id": model, "regime": regime, "edit_family": fam, "weight": weight,
            "cases": [{"case_id": f"{model}-{i}", "inputs": {}} for i in range(200)]}

def _manifest():
    return Manifest(1, [_stratum("a", "forced_open", None, 0.9),
                        _stratum("b", "free_choice", "demand", 0.1)], [0.0])

def test_weighted_mean_uses_declared_weights_not_raw_average():
    d = weighted_mean_service_demand(_stats(1.0, 11.0), _manifest(), gap=0.0)
    assert d == pytest.approx(0.9 * 1.0 + 0.1 * 11.0)   # 2.0, not the unweighted 6.0

def test_missing_required_stratum_fails_closed():
    incomplete = {"a|forced_open|-|0.0": _cs(1.0)}      # 'b' absent
    with pytest.raises(SizingError, match="required stratum missing"):
        weighted_mean_service_demand(incomplete, _manifest(), gap=0.0)

def test_required_cores_accounts_for_efficiency_and_headroom():
    cores = required_cores(demand_cpu_sec=2.0, arrival_rate_per_sec=0.694,
                           parallel_efficiency=0.8, headroom=0.3)
    assert cores == pytest.approx((2.0 * 0.694) / (0.8 * 0.7))

def test_cores_and_slots_are_different_units():
    # R3-R2: 4 cores of demand is NOT 4 slots. At 0.5 cores/slot it is 8 slots.
    instances, slots = map_to_instances(
        required_cores=4.0, slots_per_instance=8, cores_per_slot=0.5,
        rss_per_slot_bytes=200_000_000, instance_memory_bytes=4_000_000_000)
    assert slots == 8                 # memory allows 20, plan allows 8
    assert instances == 1             # 8 slots x 0.5 cores = 4 cores

def test_memory_caps_slots_before_cpu_does():
    instances, slots = map_to_instances(
        required_cores=4.0, slots_per_instance=8, cores_per_slot=0.5,
        rss_per_slot_bytes=1_500_000_000, instance_memory_bytes=4_000_000_000)
    assert slots == 2                 # only 2 slots fit in memory
    assert instances == 4             # 2 x 0.5 = 1 core/instance -> 4 instances

def test_rare_slow_stratum_beyond_p95_still_enters_themean():
    # 2% of load at 100 CPU-s sits beyond p95 yet dominates compute
    m = Manifest(1, [_stratum("fast", "forced_open", None, 0.98),
                     _stratum("slow", "free_choice", None, 0.02)], [0.0])
    d = weighted_mean_service_demand(
        {"fast|forced_open|-|0.0": _cs(0.5), "slow|free_choice|-|0.0": _cs(100.0)},
        m, gap=0.0)
    assert d == pytest.approx(0.98 * 0.5 + 0.02 * 100.0)   # 2.49 — slow stratum is most of it

def test_final_sizing_uses_target_plan_cpu_demand_once():
    cal = Calibration(plan_id="worker-pro", app_sha="abc", profile_id="representative",
                      gap=0.0, target_mean_cpu_sec=2.0, slots_per_instance=8,
                      cores_per_slot=0.5, rss_per_slot_bytes=200_000_000,
                      instance_memory_bytes=4_000_000_000, wall_scale_factor=1.2)
    instances, slots, cores = size_calibrated_plan(
        cal, arrival_rate_per_sec=0.7, headroom=0.3)
    assert cores == pytest.approx(2.0)       # 2.0 * 0.7 / (1 - 0.3)
    assert (instances, slots) == (1, 8)

def test_calibration_loader_requires_one_exact_identity(tmp_path):
    header = ("plan_id,app_sha,profile_id,gap,target_mean_cpu_sec,"
              "slots_per_instance,cores_per_slot,rss_per_slot_bytes,"
              "instance_memory_bytes,wall_scale_factor\n")
    row = "worker-pro,abc,representative,0.0,2.0,8,0.5,200000000,4000000000,1.2\n"
    path = tmp_path / "cal.csv"
    path.write_text(header + row)
    assert load_calibration(path, plan_id="worker-pro", app_sha="abc",
                            profile_id="representative", gap=0).target_mean_cpu_sec == 2.0
    with pytest.raises(SizingError, match="exactly one"):
        load_calibration(path, plan_id="worker-pro", app_sha="wrong",
                         profile_id="representative", gap=0)
    path.write_text(header + row + row)
    with pytest.raises(SizingError, match="exactly one"):
        load_calibration(path, plan_id="worker-pro", app_sha="abc",
                         profile_id="representative", gap=0)
```

- [ ] **Step 2: Run it** → FAIL, `No module named 'benchmark.capacity'`.
- [ ] **Step 3: Implement**

```python
# capacity.py
import csv
from dataclasses import dataclass

class SizingError(ValueError):
    pass

@dataclass(frozen=True)
class Calibration:
    plan_id: str
    app_sha: str
    profile_id: str
    gap: float
    target_mean_cpu_sec: float
    slots_per_instance: int
    cores_per_slot: float
    rss_per_slot_bytes: int
    instance_memory_bytes: int
    wall_scale_factor: float

def weighted_mean_service_demand(stats, manifest, gap):
    """L-R2: ONE gap at a time. gap=0 is the mandatory baseline; relaxed gaps
    are separate alternatives, never averaged together. Fails closed on any
    missing or unusable stratum -- silently skipping shrank the estimate."""
    total = 0.0
    for cell in manifest.cells():
        if cell.gap != gap:
            continue
        cs = stats.get(cell.key)
        if cs is None:
            raise SizingError(f"required stratum missing: {cell.key}")
        if not cs.usable:
            raise SizingError(f"stratum unusable ({cs.unusable_reason}): {cell.key}")
        total += cell.weight * cs.mean_cpu_tree_sec
    return total

def required_cores(demand_cpu_sec, arrival_rate_per_sec, parallel_efficiency, headroom):
    """Returns CPU CORES.

    R3-R2: my last fold renamed this to required_solver_slots() in response to
    'topology is instances x slots'. Renaming does not convert units. This
    formula is lambda * E[S_cpu] / (efficiency * (1 - headroom)) -- its units
    are cores, full stop. A solver slot may consume less than, equal to or
    more than one effective core at the measured concurrency point, and memory
    can cap slots before CPU does. Conflating the two can make the plan's
    central output wrong while looking arithmetically fine.
    """
    if not (0 < parallel_efficiency <= 1):
        raise ValueError("parallel_efficiency must be in (0, 1]")
    if not (0 <= headroom < 1):
        raise ValueError("headroom must be in [0, 1)")
    return (demand_cpu_sec * arrival_rate_per_sec) / (parallel_efficiency * (1 - headroom))

def map_to_instances(required_cores, slots_per_instance, cores_per_slot,
                     rss_per_slot_bytes, instance_memory_bytes):
    """Cores + memory -> (instances, slots_per_instance). The ONLY place the
    two units meet. Both inputs come from M2.1b calibration, keyed by
    plan_id + app_sha. Memory-capped slots win when they bind first."""
    import math
    mem_capped = max(1, instance_memory_bytes // rss_per_slot_bytes)
    slots = min(slots_per_instance, mem_capped)
    cores_per_instance = slots * cores_per_slot
    instances = math.ceil(required_cores / cores_per_instance)
    return instances, slots

def load_calibration(path, *, plan_id, app_sha, profile_id, gap):
    with open(path, newline="") as f:
        matches = [r for r in csv.DictReader(f)
                   if r["plan_id"] == plan_id and r["app_sha"] == app_sha
                   and r["profile_id"] == profile_id
                   and float(r["gap"]) == float(gap)]
    if len(matches) != 1:
        raise SizingError(f"expected exactly one calibration row, found {len(matches)}")
    r = matches[0]
    cal = Calibration(plan_id, app_sha, profile_id, float(gap),
                      float(r["target_mean_cpu_sec"]), int(r["slots_per_instance"]),
                      float(r["cores_per_slot"]), int(r["rss_per_slot_bytes"]),
                      int(r["instance_memory_bytes"]), float(r["wall_scale_factor"]))
    if min(cal.target_mean_cpu_sec, cal.slots_per_instance, cal.cores_per_slot,
           cal.rss_per_slot_bytes, cal.instance_memory_bytes,
           cal.wall_scale_factor) <= 0:
        raise SizingError("calibration values must be positive")
    return cal

def size_calibrated_plan(calibration, arrival_rate_per_sec, headroom):
    # Contention is already inside target_mean_cpu_sec AND cores_per_slot --
    # both measured at the operating concurrency (M2.1b Step 3). Do not
    # divide by an efficiency term again.
    cores = required_cores(calibration.target_mean_cpu_sec, arrival_rate_per_sec,
                           parallel_efficiency=1.0, headroom=headroom)
    instances, slots = map_to_instances(
        cores, calibration.slots_per_instance, calibration.cores_per_slot,
        calibration.rss_per_slot_bytes, calibration.instance_memory_bytes)
    return instances, slots, cores
```

- [ ] **Step 4: Run it** → PASS (8 passed).
- [ ] **Step 5: Commit** — `git commit -m "[M2.1] capacity: weighted mean CPU service demand + required-cores formula"`

### Task M2.2: Arrival trace generator

**Files:**
- Create: `artifacts/api-server/src/solver/tests/benchmark/trace.py`
- Test: `artifacts/api-server/src/solver/tests/benchmark/test_trace.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `open_loop_trace(rate_per_sec, duration_sec, seed, distribution="poisson") -> list[float]` (submission offsets in seconds); `burst_trace(n, at_sec) -> list[float]`.

**Declared parameters (M-R3):** sustained = **0.694/s for 10 800 s (3 h)**, Poisson arrivals, seed recorded. Burst = **50 submissions at one instant**, run as a separate profile.

- [ ] **Step 1: Write the failing test** — assert `len(open_loop_trace(0.694, 3600, seed=1))` is within 3σ of 2 500 ≈ ±150; assert the same seed reproduces the identical list; assert offsets are sorted and all `< duration`; assert `burst_trace(50, 10.0)` is 50 identical offsets.
- [ ] **Step 2: Run it** → FAIL.
- [ ] **Step 3: Implement** with `random.Random(seed)` and exponential inter-arrival times (`-log(1-u)/rate`), accumulating until `duration_sec`.
- [ ] **Step 4: Run it** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "[M2.2] arrival-trace generator: open-loop Poisson + synchronized burst"`

### Task M2.3: Queue simulator — distribution replay to candidate worker counts

**Files:**
- Create: `artifacts/api-server/src/solver/tests/benchmark/simulate.py`
- Test: `artifacts/api-server/src/solver/tests/benchmark/test_simulate.py`

**Interfaces:**
- Consumes: raw `Observation` samples grouped by cell (M1.2), `open_loop_trace` (M2.2), declared workload weights (M1.1).
- Produces: `EventSample`, `SimResult`, `CandidateResult`, `simulate`, `candidate_worker_counts`, `build_event_samples` — **signatures in the Canonical API; not restated here** (R3-R1). **Units:** `workers` is a count of **concurrent solver slots**, not cores.

**Design:** discrete-event, *n* servers, FIFO. Service times are sampled from the **empirical distribution**, never a fitted mean — the whole point of M-R8's "replay the full measured distribution".

> **R3-R4 — the simulator had no executable service-time contract, and that alone could produce the wrong worker count.** It consumed "raw `Observation` samples" while never saying *which field* is the server's service time. A queue slot is held for **wall time**; `cpu_tree_sec` is the *capacity* input and is a different, usually smaller, number. Picking the wrong one changes the predicted queue and therefore the answer. Worse, the plan claimed a cache hit "consumes no solver slot but retains its measured API cost" while `{stratum: (samples, weight)}` had **no field for cache class, API cost or slot consumption** — so the representative 20/60/20 profile could not actually be replayed as written.
>
> **`EventSample` (Canonical API) makes it executable:** `cache_class`, **`solver_wall_sec`** (slot occupancy — explicitly *not* CPU), `api_overhead_sec` (measured, non-zero even for hits), `consumes_solver_slot`. Solver **CPU** demand stays in M2.1 where it belongs.

**Required test (R3-R4):** a cache-hit event **adds to end-to-end latency and offered API load** while **consuming zero solver slots** — run a hit-heavy profile and assert worker utilisation is unchanged while end-to-end latency still reflects the API overhead.

> **MP-R3 — stratified replay, not a flat list.** Round 1 passed one flat `service_samples` list and drew with `rng.choice`, which **discards** the declared model/regime/edit-family weights, cache class, gap and case identity. If the corpus happens to hold equal counts per cell, uniform replay silently substitutes **equal population weights** for the declared sensitivity mix — the simulation would then answer a question nobody asked. **Correction:** `strata` is `{stratum_key: (samples, weight)}`; each event is **tagged by drawing a stratum from the declared weights**, then its service time is drawn from *that* cell's empirical distribution. `observed_stratum_mix` is reported so the realised mix can be checked against the declared one.
>
> **Cache hits bypass CBC.** A cache-hit event consumes **no** solver service time but **retains its measured API cost**, so hit-heavy profiles do not fictitiously free up worker capacity.
>
> **Both SLO variants, and a bound in the right units (F-R11).** `candidate_worker_counts` accepts an end-to-end **or** a queue-wait threshold and returns **all** explored counts with their results, flagging which pass — never only passers, so a near-miss stays visible. The bound is **`max_workers`**, not `max_instances`: `workers` counts **concurrent solver slots**, and naming its ceiling after instances re-created the very conflation R3-R2 closed — a 100-instance fleet at 4 slots each is **400 slots**, so a default of 100 would never explore it. The caller supplies `max_workers = 100 × slots_per_instance`.
>
> **How the two Phase-2 numbers meet (F-R11).** `required_cores → map_to_instances → (instances, slots)` is the analytic answer; `simulate` is then run at **`workers = instances × slots`** to produce the predicted queue behaviour *for that same count*, which is what spec §1.4.1 requires. `candidate_worker_counts` is the **sensitivity sweep around** it, not a second, competing answer.

- [ ] **Step 1: Write the failing test**

```python
# test_simulate.py
import pytest
from benchmark.measure import Observation
from benchmark.simulate import simulate, candidate_worker_counts, build_event_samples

from benchmark.simulate import EventSample

def _ev(wall, api=0.0, cls="cold_miss", slot=True):
    # F-R2: the Canonical API takes EventSample, not bare floats. Passing
    # floats either dies with AttributeError or leaves cache_class /
    # api_overhead_sec / consumes_solver_slot with no exercised path -- which
    # IS the "20/60/20 not replayable" defect R3-R4 was recorded as fixing.
    return EventSample(cache_class=cls, solver_wall_sec=wall,
                       api_overhead_sec=api, consumes_solver_slot=slot)

def test_single_server_queue_grows_when_overloaded():
    trace = [i * 1.0 for i in range(100)]                       # 1 job/s
    r = simulate(trace, {"only": ([_ev(2.0)], 1.0)}, workers=1, seed=0)
    assert r.p95_wait > 50                      # unstable, queue grows without bound
    assert r.utilization > 0.99

def test_enough_servers_keeps_wait_near_zero():
    trace = [i * 1.0 for i in range(100)]
    r = simulate(trace, {"only": ([_ev(2.0)], 1.0)}, workers=4, seed=0)
    assert r.p95_wait < 1.0

def test_cache_hit_costs_api_time_but_no_solver_slot():
    # F-R2 / R3-R4's promised-but-absent test.
    trace = [i * 1.0 for i in range(100)]
    r = simulate(trace, {"hit": ([_ev(0.0, api=0.3, cls="hit", slot=False)], 1.0)},
                 workers=1, seed=0)
    assert r.utilization == 0                   # never enters the server heap
    assert r.p95_wait == 0
    assert r.p95_end_to_end == pytest.approx(0.3)   # API cost still counted

def test_candidate_worker_counts_returns_all_counts_and_flags_passers():
    # This test has now been wrong TWICE. Round 1 was impossible (SLO 1.0 s
    # below a 2.0 s service time). Round 2 was merely false: at 1 arrival/s
    # with deterministic 2 s service, offered work is exactly 2 server-seconds
    # per second, so TWO workers already give zero wait and 2.0 s end-to-end.
    # The smallest passer is 2, not 3. Both errors came from asserting a
    # number instead of deriving it -- so assert the property, not the digit.
    trace = [i * 1.0 for i in range(200)]
    cands = candidate_worker_counts(trace, {"only": ([_ev(2.0)], 1.0)},
                                    slo_p95_end_to_end_sec=2.5, max_workers=8)
    assert [c.workers for c in cands] == list(range(1, 9))   # ALL counts, ascending
    first_pass = next(c for c in cands if c.passes)
    assert first_pass.workers == 2
    assert not cands[0].passes                               # 1 worker is overloaded

def test_queue_wait_slo_variant_is_also_available():
    trace = [i * 1.0 for i in range(200)]
    cands = candidate_worker_counts(trace, {"only": ([_ev(2.0)], 1.0)},
                                    slo_p95_queue_wait_sec=0.5, max_workers=8)
    assert next(c for c in cands if c.passes).result.p95_wait <= 0.5

def test_stratified_replay_respects_declared_weights():
    # MP-R3: a flat sample list silently substitutes equal population weights
    # for the declared sensitivity mix.
    # F-R16: the round-3 band was +/-5 events on sigma=4.4 -- about +/-1.1
    # sigma, so roughly one implementation in four fails an assertion that
    # asserts nothing about correctness. 10k events puts +/-0.005 past 3.5 sigma.
    trace = [i * 1.0 for i in range(10_000)]
    strata = {"fast": ([_ev(0.1)], 0.98), "slow": ([_ev(50.0)], 0.02)}
    r = simulate(trace, strata, workers=4, seed=0)
    assert 0.015 < r.observed_stratum_mix["slow"] < 0.025

def test_event_builder_scales_target_wall_and_requires_measured_api_cost():
    rows = [Observation(cell_key="a|forced_open|-|0.0",
                        case_key="a|forced_open|-|c1", gap=0.0,
                        wall_sec=2.0, cpu_tree_sec=1.0,
                        harness_overhead_sec=0.1, python_peak_rss=1,
                        cbc_peak_rss=1, objective=1.0,
                        solution_status="optimal",
                        termination_reason="optimality_proven", ok=True)]
    classes = {rows[0].case_key: "cold_miss"}
    events = build_event_samples(
        rows, classes, {"cold_miss": 0.2}, wall_scale_factor=1.5)
    assert events[0].solver_wall_sec == pytest.approx(3.0)
    assert events[0].api_overhead_sec == pytest.approx(0.2)
    with pytest.raises(ValueError, match="api overhead"):
        build_event_samples(rows, classes, {}, wall_scale_factor=1.5)
```

- [ ] **Step 2: Run it** → FAIL.
- [ ] **Step 3a: Implement `build_event_samples`.** It is declared in the Canonical API and pinned by the test above, but no step named it — an implementer working from the checkbox list rather than the tests would have shipped the simulator without its input builder. Behaviour (the **only** statement of it — R6-6: Step 3b carried a second, partly different copy): use `kind == "campaign"` rows with `resource_complete=True` only (failed-but-complete attempts included — they occupied a slot; determinism rows never); map each row to its `cache_class` via `cache_class_by_case_key` and **raise `ValueError` when a `case_key` has no assignment**; `wall_scale_factor` must be positive (M2.1b's target-plan scale — local wall times are not portable to Render); set `solver_wall_sec = wall_sec × wall_scale_factor` for non-hit classes and `0.0` for `cache_class == "hit"`; take `api_overhead_sec` from `api_overhead_by_cache_class` and **raise `ValueError` mentioning "api overhead" when a class is absent** — never default it to zero, which would silently make cache hits free; set `consumes_solver_slot = (cache_class != "hit")`.
- [ ] **Step 3b: Implement `simulate`** — a heap-based event loop: push arrivals, maintain `workers` free-at timestamps. **Per event, draw a stratum from the declared weights first, then draw an `EventSample` from that stratum's empirical list** (L-R2 — never `rng.choice` over a flat list, which substitutes uniform weights for the declared mix). A non-slot event (cache hit) never touches the heap and has `wait = 0`. **Definitions the tests rely on, stated once (R6-6):** `end_to_end = api_overhead_sec + wait + solver_wall_sec`; `utilization = Σ solver_wall_sec over slot-consuming events / (workers × (last completion − first arrival))`, so an all-hit profile reports `0`; `observed_stratum_mix[key]` is the **fraction** of events drawn from that stratum; `max_queue_depth` is the largest number of jobs waiting for a slot at any arrival. `candidate_worker_counts` runs `simulate` at every count `1..max_workers` with the same `seed` (default `0`, so candidates differ only in `workers`) and returns `CandidateResult(workers, result, passes)` for **every** count in ascending order — callers select the first `passes`, so a near-miss stays visible.
- [ ] **Step 4: Run it** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "[M2.3] queue simulator: empirical-distribution replay to candidate worker counts"`

---

## Phase 3 — Load harness (needs the isolated environment)

> **MP-2 fires at M3.1 Step 2 — after the pinned set and teardown runbook are drafted (Step 1, so there is a concrete teardown plan and owner to approve) and before anything is provisioned (Step 3).** Ask: *"Measurement needs an isolated Render environment — separate database, separate cache namespace, synthetic identities, analytics/alerts disabled, named teardown owner, dated cost snapshot. Approve provisioning and its teardown plan?"* Do not provision anything first. *(R6-8: the F-R8 fold put the ask at "Step 0", before the runbook that names the teardown owner and cost snapshot the question asks to approve existed.)*
>
> **MP-1 MOVED HERE — it fires before the first authoritative run, NOT before M5.2 (MP-R6).** Round 1 placed MP-1 immediately before the topology runs while M3.4 already executed the restart probe, the three-hour soak and the burst. That let the **main load evidence be observed before the SLO thresholds, aggregation rules, headroom limits and repetition pass rule were ratified** — exactly the post-hoc gate movement M-R5 was written to prohibit, reintroduced by task ordering.
>
> **The line, stated explicitly.** Harness code, unit tests, environment provisioning and **exploratory shakedown runs** may precede MP-1, provided every such run is **labelled non-authoritative and excluded from the decision dataset**. The ratified MP-1 artifact must exist **before the first authoritative representative, all-JADE, burst, restart or topology run**. Record the answer, UTC date and decider in `docs/CHANGELOG-implementation.md` before execution.

### Task M3.1: Isolated environment + cohort provisioning

**Files:**
- Create: `scripts/measurement/provision-env.sh`
- Create: `scripts/measurement/seed-cohort.mjs`
- Create: `docs/ops/measurement-environment.md` (pinned config + teardown runbook)

- [ ] **Step 1.** Draft the pinned set and teardown runbook in `docs/ops/measurement-environment.md` **before** asking or provisioning: application SHA, dataset version, region, exact compute plan IDs, instance count, environment variables, database plan, load-generator location/capacity, **named teardown owner**, teardown procedure, and the dated price snapshot. This is the artifact MP-2 approves.
- [ ] **Step 2 — ask MP-2 and record it (F-R8, re-ordered R6-8).** MP-2 existed only as blockquote prose, so an agent walking the checkbox list would provision without ever asking. Ask MP-2 **verbatim**, citing Step 1's runbook; write the answer, UTC timestamp, decider and referenced artifacts to `docs/CHANGELOG-implementation.md` **before Step 3**. A checkpoint answered anywhere else is not answered.
- [ ] **Step 3.** `provision-env.sh` creates the isolated service + database. Analytics disabled via `POSTHOG_API_KEY` unset and `SENTRY_DSN` unset — assert both are absent after boot rather than assuming.
- [ ] **Step 4.** `seed-cohort.mjs` registers **50 distinct synthetic users** through `POST /auth/register` (never one shared account — auth/session cost is part of the load). **MP-R5: registering accounts is not sufficient.** The API solves an **existing persisted scenario** (`POST /scenarios/:id/solve`), so provisioning must also **create and save the scenario/input fixtures per user through the real `/api` contracts** and retain their scenario IDs for submission. A cohort of 50 users with no scenarios cannot submit anything.
- [ ] **Step 5.** Record scenario IDs in the run manifest. **Never commit cookies or credentials**; session material lives only in ignored, permission-restricted temporary storage.
- [ ] **Step 6.** Verify isolation **without touching production** (review recommendation): assert distinct Render environment/service/database identifiers, then perform a **sentinel write/read confined to the measurement database**. Do **not** fetch or copy production user identities merely to prove no overlap — that would import the very data the isolation exists to avoid.
- [ ] **Step 7. Commit** — `git commit -m "[M3.1] isolated measurement environment + 50-session synthetic cohort"` *(F-R18: this task had two "Step 5".)*

### Task M3.2: Cache population preparation and verification

**Files:** Create `scripts/measurement/prepare-cache.mjs`

Populations per the spec's table — **prepared and verified, never assumed**:

- [ ] **Step 1.** Exact-hit population (20%): solve each input once, then **assert a `result_cache` row exists** for its hash.
- [ ] **Step 2.** Near-identical population (60%): generate from the four named edit families (`demand`, `capacity`, `force`, `distance`); assert each produces a **distinct** hash from its parent.
- [ ] **Step 3.** Distinct population (20%): cold-unique keys; assert **no** cache row exists for any.
- [ ] **Step 4.** Cold-identical burst set: 50 copies of one input; assert **zero** prior cache rows for that hash.
- [ ] **Step 4b. All-JADE cold-input generator (R3-R5) — the profile had no input source.** The all-JADE profile needs **2 500 verified cold misses/hour × 3 hours = 7 500 distinct JADE inputs whose hashes are absent from the cache**, per authoritative run. No task created them, and nothing stopped a previous repetition from having warmed them — the second repetition would have measured cache hits while reporting a cold-miss guarantee. Generate 7 500 distinct JADE inputs from the declared edit families with a recorded generator seed; **assert zero `result_cache` rows for all 7 500 before the run starts**; and between authoritative repetitions either use a **fresh cache namespace** or delete exactly those hashes, verifying absence again. A failed absence assertion aborts the run — it is never a footnote.
- [ ] **Step 5.** Emit `cache-population-manifest.json` recording every hash and its intended class, so the run can be audited afterwards.
- [ ] **Step 6. Commit** — `git commit -m "[M3.2] cache population preparation with verified hit/miss classes"`

### Task M3.3: Open-loop driver + versioned run manifest

**Files:** Create `scripts/measurement/load-driver.mjs`, `scripts/measurement/run-manifest.schema.json`

> **MP-R5 — nothing bound the schedule to the audited cache populations.** M3.2 prepared a verified 20/60/20 manifest and M3.3 consumed only an arrival trace, so no task assigned *which* case each scheduled event submits. The driver also never said how events distribute across the 50 students, whether one student may hold several jobs, or where the UI-faithful profile lives.

**Versioned run manifest (new, required before any run).** Schema fields: `profile_id, schema_version, seed, users[], case_assignment[] (event → case_id + cache_class), outstanding_job_policy, warmup_window_sec, measurement_window_sec, duration_sec, repetition_number, app_sha, plan_ids`. Every authoritative run is reproducible from this file alone.

**Required profiles — four, run separately (MP-R5):**

| Profile | Contract |
|---|---|
| Representative sustained | 20/60/20 populations, open-loop 0.694/s, 3 h |
| UI-faithful sustained | One job in flight per student, matching real client behaviour |
| Cold-identical burst | 50 requests, one hash, synchronized, verified zero prior cache rows |
| **All-JADE sustained** | **2 500 verified cold misses/hour** — the guarantee profile round 1 omitted entirely |

- [ ] **Step 1.** Consume the trace (M2.2) **and the run manifest**, submitting **on schedule, independent of response time** — a fixed timer wheel, never `await` before the next submission. A closed-loop driver invalidates the run (M-R3).
- [ ] **Step 1b.** Distribute the aggregate trace across **exactly 50 users** by a declared rule, and **verify each user received the intended share** — an unbalanced cohort measures something other than 50 students.
- [ ] **Step 2.** Poll each job at the real **800 ms** cadence.
- [ ] **Step 3.** Record per submission: intended offset, actual offset, enqueue latency, queue-wait, end-to-end, terminal status, HTTP status.
- [ ] **Step 4.** Retry/429 accounting, declared before the run: a `429` is recorded as **rejected**, is **not** retried, and **counts in offered load but not in successful accounting**.
- [ ] **Step 5.** Emit `intended_rate` and `achieved_rate`. **For the OPEN-LOOP profiles only** (representative sustained, cold-identical burst, all-JADE sustained), **fail the run** if achieved < 99% of intended — a shortfall invalidates rather than passes.
  **UI-faithful is exempt, because it is closed-loop by definition (F-R12).** One job in flight per student means a scheduled event for a busy student *cannot* be submitted on time; achieved < intended is the expected outcome, so the 99% rule as previously written would have failed **every** UI-faithful run. Declared collision action: **drop the event and record `deferred_by_policy`**, reported beside the achieved rate and **excluded from both cost denominators**. Step 1's "a closed-loop driver invalidates the run" likewise scopes to the open-loop profiles.
- [ ] **Step 6. Commit** — `git commit -m "[M3.3] open-loop load driver with intended-vs-achieved rate enforcement"`

### Task M3.3a: Measure API overhead for simulator input (exploratory)

`api_overhead_sec` is measured evidence, not a convenient constant. This task may run before MP-1 only as an explicitly **non-authoritative shakedown**, excluded from every pass/fail dataset.

**Files:** Create `scripts/measurement/measure-api-overhead.mjs`; output `docs/superpowers/metrics/api-overhead.csv`.

- [ ] **Step 1.** Against the isolated environment and M3.2 cache manifest, run a short low-concurrency sample for each cache class (`hit`, `near_miss`, `cold_miss`). Record request/enqueue/serialization overhead outside solver-slot occupancy, keyed by `app_sha + profile_id + cache_class`, with sample count and CI.
- [ ] **Step 2.** Emit `app_sha,profile_id,cache_class,n,mean_api_overhead_sec,ci_low,ci_high,run_id`; reject a missing class, duplicate key, non-positive sample count, or negative duration. Label the artifact `exploratory_non_authoritative=true`.
- [ ] **Step 3.** Add a loader used by `build_event_samples()`; selection must match the run's application SHA and profile. No zero/default fallback is allowed.
- [ ] **Step 4.** Do **not** publish a final queue prediction yet. The final event samples require both this API-overhead artifact and M2.1b's target-plan `wall_scale_factor`; after calibration, rebuild the samples and run `simulate(workers=instances × slots)`.
- [ ] **Step 5. Commit** — `git commit -m "[M3.3a] measured API-overhead input for queue simulation"`.

### Task M3.3b: Ratify the SLO gate — ask MP-1 (F-R8)

MP-1 also existed only as prose, and **nothing assembled the table it ratifies**. Both gaps close here, before any authoritative run.

- [ ] **Step 1.** Draft the MP-1 table: every item spec §2 requires ratified — cache-hit / fast-miss / JADE free-choice end-to-end thresholds, queue-wait p95, enqueue p95, maximum solve deadline, timeout/no-incumbent rate, rejection and failure rates, zero-stuck-jobs-on-restart, minimum CPU and memory headroom, percentile aggregation scope, inclusion/exclusion rules, and the repetition pass rule — starting from spec §2's carried-forward proposals.
- [ ] **Step 2.** Ask MP-1 **verbatim**; record answer, UTC timestamp and decider in `docs/CHANGELOG-implementation.md`.
- [ ] **Step 3.** Commit the ratified gate as the predeclared artifact. **No authoritative representative, all-JADE, burst, restart or topology run may start before this commit exists.**
- [ ] Commit: `[M3.3b] ratified SLO gate (MP-1)`.

### Task M3.4a: Observability source map + instrumentation (MP-R7)

> **MP-R7 — round 1 named metrics with no emitter.** Event-loop lag, CPU throttling, active Python/CBC process count, pool checked-out/waiting, internal queue depth, admissions-past-limit and load-generator saturation are **process-internal values the API and Render do not currently expose**. A collector script cannot reconstruct them after the fact, and the global `unknown` rule would have left the promised "exact bottleneck" conclusion formally unsupported while looking complete.

**Mandatory core (L-R5 — this is the whole list, and it is sufficient to tell whether the binding constraint is solver CPU/memory, API responsiveness, queue admission or Postgres):** offered/achieved rate · enqueue, queue-wait and end-to-end latency · rejection/failure/timeout · queue depth · active solve count · instance CPU · **aggregate instance RSS** / OOM / restarts · event-loop lag · database pool wait · query latency · lock delay.

**Explicitly optional, and never a blocker (L-R5):** **CPU-throttled time is not a new instrumentation project** — Render's service metrics expose CPU time/limit and memory but no direct throttled-time metric. Collect it only if cgroup data is already cheaply available; otherwise record it **unavailable** and do **not** block the capacity verdict when the core CPU/throughput evidence is complete. Network errors and three-hour storage growth are **supporting diagnostics**, not independent pass/fail gates, unless an exploratory run shows them material.

**Files (L-R3 — named):** `artifacts/api-server/src/lib/measurementTelemetry.ts` (default-off, isolated-env only), its `__tests__` sibling, and `scripts/measurement/collect-telemetry.mjs`.

- [ ] **Step 1. Source map, one row per metric:** emitting component · query/log/endpoint · unit · sampling cadence · clock · labels · retention · join key (`run_id`). A metric with no named source is not collected and not claimed.
- [ ] **Step 2. Application instrumentation — default-off, isolated-environment-only, core list only:** event-loop lag, pool checked-out/waiting, queue depth and admissions-past-limit, active solve count. Tests assert **no production secrets and no user payloads are ever emitted**.
- [ ] **Step 3. Platform sources named:** Render metrics/export for instance CPU, memory, throttling, OOM, restarts; Postgres for CPU/memory/connections/query latency/locks/storage growth.
- [ ] **Step 4. Time synchronisation** across load generator, application and database sufficient to correlate a latency interval with its resource condition — otherwise the bottleneck claim is a coincidence of timestamps.
- [ ] **Step 5. Missing mandatory telemetry INVALIDATES a bottleneck verdict** — it does not silently write `unknown` and continue. The `unknown` rule governs reporting a value, never claiming a conclusion without one.
- [ ] **Step 6. Commit** — `git commit -m "[M3.4a] observability source map + isolated-environment instrumentation"`

### Task M3.4b: Telemetry collection, restart probe, soak

**Files:** Create `docs/superpowers/metrics/load-run.csv`. *(F-R18: `collect-telemetry.mjs` is created by **M3.4a** and only consumed here — it was previously listed as "Create" in both tasks.)*

- [ ] **Step 1.** Collect the full set defined by M3.4a's source map, joined on `run_id`.
- [ ] **Step 2.** RSS: one declared method, capturing **both** per-child peak and aggregate instance RSS.
**Whose runs these are (F-R13).** Because MP-1 now precedes this task, its runs are authoritative by the preamble's own definition — so they must be attributed or they duplicate M5.2. **These are the vertical comparator's authoritative representative + burst runs**, cited in M5.2's matrix first row. **The restart probe here is a harness shakedown, explicitly labelled non-authoritative and excluded from the decision dataset** — the authoritative restart/recovery probe is M5.2's *selected-candidate* run, per the matrix. Without this, the plan runs a three-hour soak that either duplicates M5.2 or is silently discarded.

- [ ] **Step 2b — calibrate and predict the vertical comparator BEFORE Steps 3–4 observe it (R6-4).** Execute M2.1b Steps 1–6 for the vertical comparator's pinned plan against the isolated API service. Load the row with `load_calibration()`, record `size_calibrated_plan()`'s `(instances, slots, cores)` and `simulate(workers = instances × slots)` on event samples rebuilt with M3.3a's overhead and this row's `wall_scale_factor`, and write the prediction into the run manifest. M5.2's prediction-before-observation rule binds these runs too: with M2.1b scheduled wholly in Phase 5, this candidate's authoritative soak would have been observed here while its prediction was written afterwards, in Phase 5, with the result already known. **One `app_sha` per candidate:** this candidate's calibration row, prediction and authoritative runs all use the SHA pinned in M3.1 Step 1, and M5.2 loads that row by that SHA — a later M5.1 seam commit does not invalidate it, because the seam is default-preserving and this candidate keeps API dispatch enabled.
- [ ] **Step 3.** Restart probe (**shakedown, non-authoritative**): redeploy mid-load, assert **zero permanently-stuck jobs** afterwards.
- [ ] **Step 4.** Three-hour soak at the sustained profile; the 50-request burst runs **separately**.
- [ ] **Step 5.** Assert the load generator itself was not saturated — otherwise the run measures the driver, not the system.
- [ ] **Step 6. Commit** — `git commit -m "[M3.4b] telemetry collection, restart probe, three-hour soak"`

---

## Phase 4 — Experiments

### Task M4.1: MIP-start-from-cache decision record
- [ ] Seed CBC with a prior/near-identical solve's open set across all four near-dup families. **Confirm PuLP warm-start actually takes effect** (assert the solver log shows the start accepted — do not assume the API call worked).
- [ ] Report: tail collapse yes/no, near-dup speedup, per family.
- [ ] Write `docs/superpowers/specs/2026-09-XX-mipstart-decision.md`. Commit.

### Task M4.2: Warm/persistent worker decision record
- [ ] Measure per-solve overhead removed (spawn + PuLP import + dataset load, ~0.365 s observed).
- [ ] State explicitly that this is material for ~1 s models and **not** for the tail.
- [ ] Write the decision record. Commit.

### Task M4.3: Experiment comparability (review recommendation)

*(R6-9: this task sat after M5.3, so an agent walking top-down would run M4.1/M4.2 before reading the constraint that governs them. Moved; content unchanged.)*

- [ ] M4.1 and M4.2 use the **same `case_id`s, raw-row schema, repetition counts and objective-validity rules** as the main benchmark, so their decision records are comparable evidence rather than anecdotes. An experiment measured on a different corpus cannot be read against the baseline.

---

## Phase 5 — Topology, cost, gates

> **MP-3 fires between M5.1's two halves — one ordering statement, and this is it (R3-R5).** The previous wording said "MP-3 fires before M5.1" while M5.1 itself said the seam is built and tested first; both could not be true. **Canonical sequence:** implement + test the dispatcher seam (no external infrastructure created) → prepare the exact image/command/config/teardown artifact → **ask and record MP-3** → provision the disposable worker. Ask, in the spec's exact wording: *"The worker prototype consumes A's durable queue: \<named image/command, queue seam, plan IDs, dispatcher-mode configuration, provisioning owner, teardown procedure\>. Authorize it as disposable, non-production scaffolding?"*
> **MP-1 already fired in Phase 3** (moved there per MP-R6) and must already be recorded before any run here.

### Task M5.1: Disposable worker prototype + dispatcher-mode seam

> **MP-R8 — without this, two of the three topology candidates measure the wrong thing.** Option A deliberately ships a **recurring dispatcher inside the API** (A2). A prototype worker consuming the same durable `solve_jobs` queue therefore **races the API for the same jobs**: some solves run on API compute, silently contaminating the dedicated-worker and horizontal-fleet throughput, resource and cost attribution. The numbers would look plausible and be wrong.

> **Ordering corrected (L-R3).** MP-3 fired *before* M5.1, yet the MP-3 request must name the dispatcher-mode configuration that M5.1 implements — the authorization could not be written before the thing it authorizes existed. **The seam is built and tested first; it creates no external worker.** Sequence: implement + test the seam → prepare the exact image/command/configuration/teardown artifact → **ask and record MP-3** → provision the disposable worker → calibrate on the worker plan.

**Files (L-R3 — named, not "the API"):** `artifacts/api-server/src/solver/jobRunner.ts` (claim guard), `artifacts/api-server/src/config/featureFlags.ts` (mode resolution), `artifacts/api-server/src/config/__tests__/featureFlags.test.ts`, `artifacts/api-server/src/solver/__tests__/dispatcherMode.test.ts`. One commit for the seam, a separate commit for the prototype.

- [ ] **Step 1. Execution-mode seam, default-preserving — built BEFORE MP-3.** For dedicated-worker and fleet measurements the API is **enqueue/poll-only and cannot claim**; the named worker command is the **sole claimant**. The vertical tune-in-place comparator keeps API dispatch **enabled** — that is the whole point of that candidate.
- [ ] **Step 2. Fail closed and observable.** The mode is resolved at startup, logged, and recorded in the run manifest. A **pre-run assertion proves the API's active-solver count stays zero** for worker-only candidates; a non-zero count aborts the run rather than footnoting it.
- [ ] **Step 3. MP-3 request contents.** Exact image SHA, command, queue namespace, plan IDs, **dispatcher-mode configuration**, owner, and teardown/restoration steps — all present *before* asking for authorization, not after.
- [ ] **Step 3b — ask MP-3 and record it (F-R8).** Ask **verbatim**; write answer, UTC timestamp, decider and the request artifact reference to `docs/CHANGELOG-implementation.md`. **No external worker infrastructure is created before this record exists.**
- [ ] **Step 4. Prove isolation between candidates:** every topology uses an isolated queue/database, and no candidate's run overlaps another candidate's jobs.
- [ ] **Not committed as production infra.** `render.yaml` is unchanged; the prototype is created and torn down out-of-band.

### Task M5.2: Topology runs
- [ ] **Execute M2.1b now for each shortlisted worker plan** (the vertical comparator's calibration, prediction and authoritative representative + burst runs were completed at M3.4b Step 2b — cite those run IDs in the matrix's first row, loading its row by the SHA recorded there). Load the exact calibration row, produce final candidate counts with `size_calibrated_plan()`, rebuild target-scaled event samples using M3.3a API overhead, and record the analytic prediction at `workers = instances × slots` before observing the authoritative run. A missing/mismatched calibration aborts the candidate.
- [ ] Run the same corpus + burst against: high-core vertical (≤ **12 CPU**, `12c-96g` ceiling), one dedicated worker, horizontal fleet (≤ **100 instances**, uniform plan).
- [ ] **Never validate autoscaling in a preview environment** — previews run at the autoscaling minimum. Manual fixed-instance comparisons in previews are valid when explicitly configured.
- [ ] Compare on end-to-end SLO, safe CPU/RSS headroom, restart behaviour, scale-window billing, idle cost, operational complexity.

**Minimum decision matrix (L-R4) — not a Cartesian product.** Round 1 defined four profiles in M3.3 and never said which topology runs which, so a candidate could have inherited an unexecuted profile by inference.

| Scope | Profiles executed |
|---|---|
| **Every candidate topology** | Representative sustained **+** synchronized cold-identical burst |
| **Top one or two candidates** | **+** sustained all-JADE cold-miss guarantee |
| **Selected candidate only** | **+** UI-faithful profile **+** restart/recovery probe |

Repeat only the runs used for the **final** pass/fail decision, per the MP-1 repetition rule; exploratory and calibration runs stay excluded from the decision dataset. **The final report cites run IDs for every required cell of this matrix** — an empty cell is a missing verdict, never an inferred pass.

### Task M5.3: Cost model
- [ ] Report **both** denominators: cost per successful **submitted job** (cache hits in — budgeting) and per successful **CBC execution** (cache hits out — topology comparison). Marginal burst-worker cost and cache-hit mix beside both. Rejected/failed/timed-out in neither.
- [ ] Dated all-in model: workspace fee, always-on API, idle/base worker, burst workers, Postgres, scheduler, storage/backups, bandwidth, and the measurement infrastructure itself. Sensitivity to **cache-hit rate** and **free-choice frequency** (the M-R9 input knob; the capacity-side sensitivity is M2.1's alternate-weight call).

### Task M5.4: Gate verdicts and decision document
- [ ] **Capacity gate:** does the measured topology meet the ratified latency, rejection, headroom and cost limits?
- [ ] **Reliability/isolation gate:** durability, restart recovery, process containment, API availability, safe ownership.
- [ ] The final report records: **intended vs achieved arrival rate**, raw rows, uncertainty, bottleneck evidence, per-gate verdicts, selected topology + worker count, capacity calculation, distribution/trace input, predicted queue behaviour, observed confirmation, the JADE `gap=0` re-measure beside both prior claims (M1.5 Step 5b), the free-choice-frequency sensitivity (M2.1, M5.3), and the dated cost model.
- [ ] **Name the evidence artifact per profile (review recommendation).** The verdict cites the run IDs for **both** the representative profile **and** the guaranteed all-JADE cold-miss profile. A topology cannot pass on one and inherit the other by inference.
- [ ] **MP-4 fires:** *"Capacity gate: \<verdict\>. Reliability/isolation gate: \<verdict\>. What is built?"*
- [ ] **Record MP-4 before teardown:** write the exact answer, UTC timestamp, decider, selected topology/configuration, and cited run/report IDs to `docs/CHANGELOG-implementation.md`. A spoken answer or an answer stored only in the final report does not close the checkpoint.
- [ ] **Teardown** the isolated environment and the prototype; the named owner confirms.

---

## Self-review against the spec

| Spec section | Covered by |
|---|---|
| §1.1 microbenchmark, stratified corpus, ≥200/cell, determinism separation | M1.1–M1.5 |
| §1.2 open-loop load, cache populations, telemetry, RSS, restart, soak | M3.1–M3.4 |
| §1.3 experiments | M4.1, M4.2 |
| §1.4 topology comparison + platform constraints | M5.1, M5.2 |
| §1.4.1 capacity sizing from mean CPU demand | M2.1–M2.3; M2.1b executed at M3.4b Step 2b (vertical comparator) and M5.2 (worker plans), each before its candidate's authoritative run |
| §1.5 isolated environment | M3.1 |
| §2 SLO ratification | **M3.3b** — MP-1 ratified before M3.4b's first authoritative run (F-R8; this row previously asserted the pre-MP-R6 "before M5.2" ordering, so the document held both) |
| §3 two gates | M5.4 |
| §4 cost model, two denominators | M5.3 |
| §5 deliverables | M1.5, M3.4, M4.x, M5.3, M5.4 |
| MP-1…MP-4 | M3.3b, M3.1 Step 2, M5.1 Step 3b, M5.4 record step |

**Type consistency:** `Cell.key` (M1.1) is the join key through `Observation.cell_key` (M1.2), `aggregate()`'s dict keys (M1.4), and `weighted_mean_service_demand`'s lookup (M2.1). **`Case.case_id` (M1.1) is the second join key** — carried on every `Observation` (M1.2), used to pair objective deltas against `gap=0` (M1.4), and the thing `run_determinism` holds fixed while `run_campaign` varies (M1.3). `Observation.kind` and `resource_complete` are defined in M1.2 and consumed in M1.3–M1.5.

---

## Review disposition — approval validation (2026-09-23)

All 9 findings accepted, plus all 5 execution recommendations. Verbatim review text: committed at `b65f0f9`.

| Finding | Disposition | Landed in |
|---|---|---|
| MP-R1 campaign rows were repeats of one input | Accepted; `Cell` now holds **distinct `Case`s**, 200 means 200 distinct `case_id`s, warm-ups run **before** randomization | M1.1, M1.2, M1.3 |
| MP-R2 primitive excluded CBC CPU, could not produce per-observation RSS | Accepted; **process-tree** CPU (user+sys), child-reported tree peak RSS with no high-water subtraction, benchmark-only unrounded timing seam, overhead recorded separately | M1.2 |
| MP-R3 capacity averaged gaps and replayed unweighted | Accepted; **per-gap** capacity with `gap=0` mandatory, fail-closed on missing cells, **stratified** replay, measured parallel efficiency via a new concurrency sweep, impossible test corrected, `max_workers` derived | M2.1, M2.1b, M2.3 |
| MP-R4 statistics missed the uncertainty and objective contract | Accepted; full `CellStats` schema with CIs on every estimate, paired objective deltas by `case_id`, `corpus_frequency()` implemented and tested, declared outlier policy, unusable cells explicit | M1.4 |
| MP-R5 workload matrix and per-user behaviour incomplete | Accepted; versioned **run manifest**, four named profiles incl. the omitted all-JADE guarantee, 50-user distribution verified, **scenario provisioning** added | M3.1, M3.3 |
| MP-R6 MP-1 fired after the authoritative run | Accepted; **MP-1 moved to Phase 3**, before the first authoritative run; exploratory shakedowns allowed only if labelled non-authoritative | Phase 3 preamble |
| MP-R7 telemetry had no emitting source | Accepted; new **observability source map** task plus default-off isolated-environment instrumentation; missing mandatory telemetry **invalidates** a verdict | M3.4a |
| MP-R8 worker/fleet runs contaminated by A's API dispatcher | Accepted; **execution-mode seam** with fail-closed startup and a pre-run zero-active-solver assertion | M5.1 |
| MP-R9 canonical approval record absent | Accepted; `docs/CHANGELOG-implementation.md` **restored to this branch** and the decision record written | P5, changelog |

**Recommendations, all folded:** sentinel-based isolation proof without touching production identities (M3.1) · full manifest validation (M1.1) · `tempfile.mktemp()` removed (M1.2) · experiment comparability (M4.3) · per-profile evidence artifacts (M5.4).

## Review disposition — round 2, lean scope (2026-09-23)

All 5 findings accepted; every scope reduction applied. Verbatim review text: committed at `7b763c0`. **MP-R9 is closed and is not reopened.**

| Finding | Disposition | Landed in |
|---|---|---|
| L-R1 M1 code blocks still showed rejected round-1 code | Accepted; manifest loader, `Observation`, runner, stats and CSV headers all rewritten to one coherent interface | M1.1–M1.5 |
| L-R2 M2 algorithms stale; candidate test still false | Accepted; per-gap fail-closed sizing, stratified replay, `CandidateResult(workers, result, passes)`, `instances × slots`, test asserts a **property** not a digit | M2.1, M2.3 |
| L-R3 calibration and checkpoint order unrunnable | Accepted; Phase 2 yields uncalibrated distributions, calibration moves after MP-1/MP-2 at a geometric 1/2/4/8 set, dispatcher seam built **before** MP-3, files named | M2.1b, M5.1, M3.4a |
| L-R4 case join and run matrix implicit | Accepted; `(model_id, regime, edit_family, case_id)` key excluding gap; minimum decision matrix with per-cell run IDs | M1.1, M1.2, M5.2 |
| L-R5 telemetry beyond the decision's needs | Accepted; mandatory core named, throttling/network/storage demoted to optional diagnostics that never block a verdict | M3.4a |

**Scope reductions applied (work removed, not added):** no `on_phase` production hooks · no aggregate-tree-RSS sampler · CIs only on the four decision metrics · sequential stopping with a 200 **cap** rather than a 200 **quota** · geometric calibration set · no topology×profile Cartesian product · no mandatory cgroup throttling telemetry. **Parent-spec consequence applied:** the measurement spec's §1.1 build-vs-`prob.solve()` split requirement is explicitly withdrawn there.

## Review disposition — round 3 (2026-09-23)

All 5 findings accepted. No scope added; one structural simplification. Verbatim review text: committed at the round-3 record commit.

| Finding | Disposition | Landed in |
|---|---|---|
| R3-R1 snippets still do not compose | Accepted; **root cause fixed, not just the symptoms** — one **Canonical API** section is now the sole definition of every signature/schema; drifted tests rewritten; `mean`/`relative_half_width` defined; child timeout, nonzero-exit and corrupt-pickle handling added; pass counts derived from the actual blocks | Canonical API, M1.1–M1.4, M2.1 |
| R3-R2 formula returns cores, not slots | Accepted — **the most important finding of the round**; `required_cores` restored with explicit units, `map_to_instances` added as the only place cores and slots meet, memory cap modelled | Canonical API, M2.1 |
| R3-R3 schedule not randomized, gaps unpaired | Accepted; one **globally interleaved** schedule, a **shared case cohort per stratum** reused across gaps, stopping rule extended to protect paired coverage and tail evidence | M1.3 |
| R3-R4 no service-time or cache contract | Accepted; `EventSample` with **`solver_wall_sec`** (occupancy, not CPU), `api_overhead_sec`, `consumes_solver_slot`, `cache_class` | Canonical API, M2.3 |
| R3-R5 calibration/MP-3/all-JADE unrunnable | Accepted; single MP-3 ordering statement, M2.1b promoted to a real task with runner and consumer, all-JADE cold-input generator with pre-run absence assertion and inter-repetition cleanup | Phase 5 preamble, M2.1b, M3.2 |

**Non-blockers respected — nothing added:** no phase hooks, no local aggregate-RSS sampler, no cgroup throttling, no every-integer sweep, no 200-case quota, no topology×profile Cartesian product. MP-R9 stays closed.

## Review disposition — round 4, independent model pass (2026-09-23)

All 20 findings accepted. No scope added. Verbatim review: `../specs/2026-09-23-measurement-plan-fable-review.md`, committed at `68d77a7` before this fold.

| Finding | Disposition |
|---|---|
| F-R1 `Observation` missing `gap`; three disagreeing constructors | Accepted — **CRITICAL and non-obvious**: the positional constructors shifted every field by one, tagging a timeout row `kind="timeout"`, which `aggregate()` **drops**. Field added, all constructors keyword-form |
| F-R2 tests pass bare floats where `EventSample` required; R3-R4's promised test absent | Accepted; `_ev()` helper, all strata converted, and the cache-hit test actually written |
| F-R3 `aggregate()` calls undefined `_mean` | Accepted; single name `mean` |
| F-R4 `failure_rate == 0.1` fails — yields `0.09999999999999998` | Accepted; formula changed to `(n-ok)/n` **and** `pytest.approx` |
| F-R5 M1.3 imports a module M1.4 creates | Accepted; **M1.4 executes before M1.3** — fourth task-ordering circularity |
| F-R6 stop rule stops cells independently, thinning paired deltas | Accepted; readiness computed per **stratum**, all gaps stop together; phantom "upper tail" criterion deleted |
| F-R7 `objective_deltas`/`corpus_frequency` declared-but-absent **again**; stale schema; no delta CSV columns | Accepted; steps + tests written, stale prose deleted, four `objective_delta_*` columns added |
| F-R8 MP-1/MP-2 have no step that asks them; self-review row contradicts the preamble | Accepted; **M3.1 Step 2** (MP-2 — was "Step 0", re-ordered in round 6), **M3.3b** (MP-1 + drafts its table), **M5.1 Step 3b** (MP-3); self-review row corrected |
| F-R9 M2.1b sits in Phase 2 while running Render calibration | Accepted; marked Phase-5-executing, calibration targets named, `--service` added |
| F-R10 `cores_per_slot` underived; η counted twice | Accepted; formula fixed, and the **exactly-one-carries-η** rule stated |
| F-R11 `max_instances` bounds slots; no link from `(instances, slots)` to `workers` | Accepted; renamed `max_workers`, and `workers = instances × slots` stated |
| F-R12 99% rule fails every UI-faithful run | Accepted; scoped to open-loop profiles, collision action declared |
| F-R13 M3.4b's authoritative runs unattributed | Accepted; assigned to the vertical comparator, restart probe marked shakedown |
| F-R14 `Cell.key` uses `str(gap)`; `[0]` yields `\|0` not `\|0.0` | Accepted; `float(g)` + loader normalisation |
| F-R15 timeout kills the child, not CBC | Accepted; `os.setsid()` + `killpg` |
| F-R16 ±1.1σ band — coin-flip on first run | Accepted; 10 000 events |
| F-R17 four tests named, two asserted | Accepted |
| F-R18 stale counts and contradictory instructions | Accepted; counts recomputed from the blocks, duplicate-field instruction and duplicate Step 5 removed, file ownership de-duplicated |
| F-R19 `validate()` prose ≠ code; `chens` needs `timeLimitSec` | Accepted — **verified `solve.py:1341` reads it unconditionally**; full validation implemented |
| F-R20 spec coverage: JADE re-measure unreported; MP-3 text divergent | Accepted; deliverable added, spec's MP-3 question reconciled |

## Review disposition — round 5, final executable-contract pass (2026-09-23)

All 7 findings accepted and folded into the executable plan; no optional platform work was added.

| Finding | Disposition |
|---|---|
| R5-1 M1.1 test fixtures omitted required `modelType` and live model-input validation | Accepted; fixtures now compose and validation derives required inputs from each solver manifest |
| R5-2 failed attempts were removed from service demand, while timeout zeros masqueraded as measurements | Accepted; complete failed attempts count toward CPU/wall demand; censored timeout/corrupt-output rows fail the cell closed via `resource_complete` |
| R5-3 sibling gaps still retained different case sets at the stopping boundary | Accepted; scheduling is atomic per `(stratum, case)` group and readiness is evaluated only after all sibling gaps run |
| R5-4 one delta per `case_key` could not represent three relaxed gaps | Accepted; objective values/exclusions are keyed by non-zero-gap `cell_key`, with signed raw paired deltas |
| R5-5 local CPU/wall measurements were treated as portable to Render and the CSV consumer was implicit | Accepted; calibration now emits target-plan CPU demand and wall scale; explicit loader and sizing orchestrator fail closed on identity/value mismatches |
| R5-6 sequential-stop observation counts were labelled corpus frequency | Accepted; declared generator weight and realised observation allocation are separate fields |
| R5-7 simulator API overhead had no evidence source and MP-4 had no durable record step | Accepted; exploratory M3.3a produces keyed overhead evidence, final simulation waits for target calibration, and MP-4 is recorded before teardown |

## Review disposition — round 6, independent fix-in-place pass (2026-09-23)

Every M1/M2 code block was extracted and executed (`32 passed` before the edits, `33` after; a throwaway `simulate.py` written to the Step 3a/3b contract passes all 7 `test_simulate.py` tests). No scope added; two promises deleted rather than implemented.

| Finding | Disposition |
|---|---|
| R6-1 `measure.py` timeout path could raise `ProcessLookupError` if the deadline landed before the child's `os.setsid()`; `waitpid`'s encoded status was reported as an exit code | Fixed; `killpg` falls back to `kill`, `os.waitstatus_to_exitcode` used |
| R6-2 M1.5 declared `write_raw(observations, path)` / `write_aggregates(stats, manifest, path)` which cannot fill the `run_id`/`observation_share` columns they must write; a `timestamp` column had no source; Step 5b targeted a "benchmark report" that no task defines | Fixed; `report.py` signatures added to the Canonical API, `timestamp` column **deleted** (row order already carries sequence), Step 5b routed to the M5.4 final report |
| R6-3 calibrated path applied η **zero** times, not once: `target_mean_cpu_sec` was taken at concurrency 1 while `cores_per_slot` only captures utilisation loss, so per-job CPU inflation under contention was in neither — under-provisioning by the inflation factor with `parallel_efficiency=1.0` | Fixed; every calibrated quantity is measured at the knee `N`, η demoted to a knee-finding diagnostic, raw sweep CSV given the columns the derivation consumes |
| R6-4 the vertical comparator's authoritative runs (M3.4b) were observed before its calibration and prediction (M2.1b "executes in Phase 5"), contradicting M5.2's prediction-before-observation rule | Fixed; M3.4b Step 2b calibrates and predicts the vertical comparator first; M2.1b executes per plan when its service exists; one `app_sha` per candidate stated |
| R6-5 F-R17 remainder: the warm-up test asserted counts, not order; nothing asserted campaign `case_id` distinctness | Fixed; both properties asserted, M1.3 count `7 passed` |
| R6-6 M2.3 Steps 3a/3b carried two partly different `build_event_samples` contracts; `utilization`, `end_to_end`, `observed_stratum_mix` and the sweep seed were undefined although tests assert on them | Fixed; one contract in 3a, definitions pinned in 3b, `seed: int = 0` on `candidate_worker_counts` |
| R6-7 spec §1.1 requires free-choice frequency as a knob in the **capacity** sensitivity; plan had it only in M5.3 cost | Fixed with no machinery: alternate-weight `Manifest` through `weighted_mean_service_demand`, reported in M5.4 |
| R6-8 M3.1 asked MP-2 at "Step 0", before the runbook naming the teardown owner and cost snapshot the question approves existed | Fixed; draft runbook → ask → provision; preamble and self-review row updated |
| R6-9 M4.3 (constraint on M4.1/M4.2) sat after M5.3; M3.4b commit tag; MP-3 question order differed from the spec's | Fixed; moved, `[M3.4b]`, spec wording used |
| R6-10 spec ≠ plan on two settled scope reductions: spec §1.1 still demanded uncertainty on p50/RSS/frequency and §1.2 still listed throttling/network/storage growth as captured | **Spec corrected** (revision notes in §1.1 and §1.2) to the L-R5 decisions this plan already records; the plan is unchanged |

## Author responses (kept for later review)

- **MP-R1 — accepted; I rebuilt in code the exact conflation the spec was written to prevent.** M-R4 made the spec say, in plain words, that repeating one scenario measures runtime noise and not regime frequency — and then my `Cell` carried a single `inputs: dict` that M1.3 executed 200 times. Every "campaign" row in a cell would have been the same scenario, so the capacity model would have rested on 200 repetitions of one case per cell, with `kind="campaign"` doing the work of making it look otherwise. The warm-up defect is the same carelessness one layer down: appending warm-up and measured entries to one list and then shuffling means a "warm-up" can execute after measured rows, which is not a warm-up at all.
- **MP-R2 — accepted, three separate errors, and the CPU one is the worst.** `time.process_time()` measures the Python process; **PuLP runs CBC as an external subprocess**, so the dominant solver CPU was simply absent from the number feeding M2.1. Every derived worker count would have been too low — the failure mode that looks like good news. The RSS defect is worse than wrong, it was **inert**: `ru_maxrss` is a high-water mark that cannot be differenced, and `max(after - before, after)` reduces to `after`, so my "normalisation" silently reported the largest RSS any earlier observation had ever caused. On the timing split I had the evidence and did not use it: `solve.py:214` is `round(run_time, 2)`, and the CLAUDE.md gotcha about the `e2e_accuracy` timing bug exists **because** that rounding bites at small magnitudes — then I built `build_sec = wall - runTimeSec` on top of it for models that solve in under 0.2 s.
- **MP-R3 — accepted; and one item is a flat error in my own test.** Treating `gap` as a workload dimension and averaging across it is the substantive fault: gap is a **configuration alternative**, and averaging relaxed-gap speed into the mandatory `gap=0` baseline understates capacity. `if cs is None: continue` is the same shape — less evidence silently producing a smaller, friendlier number. But the test is the plain embarrassment: with every service time at 2.0 s, end-to-end is ≥ 2.0 s **by construction**, so no worker count can put p95 under a 1.0 s SLO, and I asserted three workers would. It would have failed on first run; it should never have been written.
- **MP-R4 — accepted.** I declared `corpus_frequency()` in an Interfaces block and never implemented or tested it — a placeholder wearing an interface's clothes, which is precisely the failure mode the A plan's own audit rules name. The empty-`walls` crash is the other kind: an all-failure cell is exactly when you most need a clear "unusable" signal, and instead it raises `IndexError` from a list index.
- **MP-R5 — accepted, and the provisioning gap would have stopped the run dead.** The API solves an **existing persisted scenario**, so 50 registered users with no scenarios cannot submit anything at all. Separately, nothing bound scheduled events to the audited 20/60/20 manifest — M3.2 built a verified population and M3.3 never consumed it, so the cache mix would have been aspirational. The omitted **all-JADE sustained** profile is the guarantee the whole exercise exists to test.
- **MP-R6 — accepted; a gate defeated by ordering rather than by argument.** I placed MP-1 before M5.2 while M3.4 already ran the soak, the burst and the restart probe. The SLO thresholds would therefore have been ratified **after** the main evidence was visible — the post-hoc gate movement M-R5 was written to forbid, reintroduced through task sequence. The fix is a line, not a paragraph: exploratory runs may precede MP-1 if labelled non-authoritative and excluded from the decision dataset; nothing authoritative may.
- **MP-R7 — accepted.** I listed the metrics the spec demanded without asking what emits them. Event-loop lag, pool counts and admissions-past-limit are process-internal and not currently exposed, and no collector can recover them after the fact. The sharp consequence is the one I would have missed: under the `unknown` rule the report would have looked complete while the "exact bottleneck" conclusion had no support. `unknown` is honest about a **value**; it is not a licence to keep a **claim**.
- **MP-R8 — accepted, and it is a genuine experimental-design fault.** A ships a recurring dispatcher **inside the API**. Adding a prototype worker on the same queue means both claim the same jobs, so dedicated-worker and fleet numbers silently include work done on API compute — plausible-looking figures attributing throughput, RSS and cost to the wrong machine. Fixing it requires an execution-mode seam that fails closed and is asserted before the run, not a note in the report.
- **MP-R9 — accepted; the audit trail pointed at a file that did not exist.** Three documents instruct agents to record checkpoint answers in `docs/CHANGELOG-implementation.md`. On this branch that file was **absent** — it reached `main` via `ch4-fixes` after `scnd-scaling` was cut. So the A plan asserted AP-4 was granted while the designated independent record was missing, leaving the plan as both the request and its own evidence. Restored from `main` and the real decisions written with dates, scopes and decider; no approval was re-asked, because each one was genuinely made.

### Round 2 — lean scope (2026-09-23)

- **L-R1 and L-R2 — accepted, and together they are the round-5 failure repeating.** I wrote each correction as an explanatory blockquote and left the executable block beneath it showing the rejected round-1 code. So M1.1's test called `load_manifest(..., min_cases_per_cell=200)` against an implementation taking only `path`; M1.2 declared `Case`/`cpu_tree_sec` while its tests built the old `Cell` and asserted old fields; M1.3 still shuffled warm-ups in with measured rows; M1.4 still had p95-only stats and the empty-`walls` crash; M1.5's headers omitted `case_key`, making the paired re-analysis the plan advertises impossible from its own artifact. This is exactly the class round 5 named — **claimed-but-unfinished propagation** — and I had even written the rule to grep for old wording before committing. I ran that grep, found the stale blocks, fixed **one** of them (M1.2's implementation), and shipped the rest. Finding a problem and fixing part of it is worse than missing it, because the fold's prose then asserts completion.
- **L-R2's test catch — wrong twice on the same three lines.** Round 1 was *impossible* (a 1.0 s SLO under a 2.0 s service time). My correction made it merely *false*: at 1 arrival/s with deterministic 2 s service, offered work is exactly 2 server-seconds per second, so **two** workers give zero wait and 2.0 s end-to-end — the smallest passer is 2, not 3. Both errors share one cause: I asserted a **number** I had reasoned about loosely instead of the **property** I actually wanted. The test now asserts the property (all counts returned ascending, first passer identified) and the digit falls out of it. The same block also contradicted its own prose — prose said "returns all explored counts", the test indexed `cands[0]` as the first passer.
- **L-R3 — accepted; the third circular-ordering defect in this programme.** M2.1b needed real Render runs while sitting inside a phase labelled *pure computation, no infrastructure*, ahead of the very checkpoints that authorize infrastructure — so Phase 2 promised an artifact its own position forbade. M5.1 had the mirror image: MP-3 fired before the task that builds the thing MP-3 must describe. A-R31 was a circular gate matrix, M-R7 a circular programme sequence, and this is circular task ordering. Same shape, third document. I also deleted the false claim that M1.2's timing seam was "the only production-file touch" — observability and dispatcher mode both touch application code, so the sentence was wrong when written.
- **L-R4 — accepted.** `case_id` was unique only *within* a cell while objective deltas pair the same case *across* gaps, so the join would have silently mismatched cases between strata. Key is now `(model_id, regime, edit_family, case_id)`, deliberately excluding gap, carried on every raw row. The run matrix is the same omission one level up: four profiles defined, no statement of which topology executes which, leaving a candidate free to inherit an unexecuted profile by inference.
- **L-R5 and the scope reductions — accepted gratefully, and they correct real overreach on my part.** Dropping the `on_phase` hooks, the aggregate-tree-RSS sampler, CIs on every descriptive field, every-integer sweeps, the topology×profile Cartesian product and mandatory throttling telemetry removes work I added because the previous review's findings were valid, not because the *decision* needed it. That is the failure mode of folding review comments mechanically: each individual addition defensible, the aggregate disproportionate to a sizing question. The review's framing is the right one — **the objective is trustworthy sizing, not a benchmarking framework**. I applied the parent-spec consequence rather than leaving it implied: the measurement spec's §1.1 build/solve-split requirement is now explicitly withdrawn in the spec itself.

### Round 3 (2026-09-23)

- **R3-R1 — third consecutive round, same defect, so I stopped treating it as a care problem.** Each fold I edited a signature in the Interfaces bullet, the test snippet and the implementation snippet as three independent acts, and they drifted. `aggregate` ended up **declared** `(observations, manifest)`, **tested** `(rows, min_cases=…)` and **implemented** `(observations)` inside one task. Editing more carefully has now failed three times; the structure was wrong. **One Canonical API section is now the only definition**, task bullets point at it, and implementation snippets survive only where the logic is genuinely subtle (`measure.py`'s fork/rusage handling). A second hand-maintained copy is exactly what broke. Also fixed the real robustness gaps behind the drift: the child could exit `0` after a failed `pickle.dump`, `pickle.load` could escape to the caller, and a hung solve had no deadline — a campaign could stall forever on one case.
- **R3-R2 — accepted, and it is the finding that mattered most.** Round 2 told me topology is `instances × slots`. I responded by **renaming** `required_cores` to `required_solver_slots` — treating a units error as a naming preference. The formula `λ·E[S_cpu] / (η·(1−h))` has units of **cores**; a rename cannot convert it. A slot may draw less than, equal to or more than one effective core at the measured concurrency point, and **memory can cap slots before CPU does** — which the plan modelled nowhere. The plan's headline output could have been wrong while every intermediate number looked arithmetically fine. Three quantities are now distinct, and `map_to_instances` is the single calibrated bridge, with a test asserting cores ≠ slots and another asserting memory binds first.
- **R3-R3 — accepted, both halves, and the second half is subtler than the first.** My loop drained one cell at a time while the declared policy said globally randomized, so thermal state or background drift could align with a model/gap cell and be read as that cell's property. The pairing defect is worse: each gap shuffled and stopped **independently**, so `gap=0` and the relaxed gaps could retain different case subsets — `case_key` would be correct and the paired objective delta would still quietly thin out or bias, which is the only evidence the gap experiment has. Now one shared cohort per stratum, reused across gaps. I also accepted the narrower point that a tight CI on **mean CPU** says nothing about **p95** or the **paired delta** — different estimators, different convergence.
- **R3-R4 — accepted; I never specified which number the simulator consumes.** A queue slot is held for **wall time**; `cpu_tree_sec` is the capacity input and is a different, smaller quantity. The plan said "raw `Observation` samples" and left the choice to the implementer, where picking the wrong field silently changes the predicted queue and the worker count. Separately I asserted cache hits "consume no slot but retain API cost" while the input type `{stratum: (samples, weight)}` had no field for cache class, API cost or slot consumption — so the representative 20/60/20 profile was **not replayable as written**. `EventSample` makes both executable.
- **R3-R5 — accepted; the MP-3 item is the partial-fix failure again.** Last round I corrected M5.1's ordering and left the Phase 5 preamble asserting the opposite, so the document contained both orderings simultaneously. The all-JADE gap is the one with teeth: the profile needs **7 500 distinct cold JADE hashes per three-hour run**, no task created them, and nothing stopped a previous repetition from warming them — repetition two would have measured cache hits while reporting a cold-miss guarantee, and the number would have looked *better*. Generator, pre-run absence assertion and inter-repetition cleanup added.

### Round 4 — independent model pass (2026-09-23)

- **F-R1 is the finding I would never have caught by reading.** The `Observation` dataclass omitted `gap` while the Canonical API declared it, and my two positional constructors passed `cell.gap` **as if the field existed**. Against the snippet's own dataclass that does not raise — it shifts every field by one, so a timeout row lands with `ok=None`, `error=False` and **`kind="timeout"`**. `aggregate()` drops every row whose `kind != "campaign"`. A hung solve — the exact tail the capacity model most needs — would have vanished from `failure_rate`, `n_obs` and `p95_wall` **without an error anywhere**. I had added those constructors in the round-3 fold *to improve robustness*, and in doing so built a silent data-loss path. That is the measurement-specific failure class this plan's own notes name: plausible code producing wrong numbers.
- **F-R4 is the CLAUDE.md float gotcha, and I wrote it into a test after quoting the rule.** `1 - 9/10` is `0.09999999999999998`. The repo's own changelog records this exact class from the `e2e_accuracy` timing bug, and my round-2 response cited it when discussing `runTimeSec` rounding. Then I asserted `== 0.1`.
- **F-R5 — fourth task-ordering circularity in this programme.** `run_campaign` imports `benchmark.stats` at function-body top; `stats.py` is created by the *next* task. Every call would raise `ModuleNotFoundError`, and M1.3's commit would land a red suite. A-R31, M-R7, L-R3, now this. The shape is always the same: two things each written as if the other already existed.
- **F-R6 — the fix I shipped addressed scheduling, not retention.** R3-R3 made me share a case cohort across gaps, which fixes which cases are *scheduled*. The stop rule still retired cells independently on CI width, so `gap=0` could retire at 40 retained cases while `gap=0.02` ran to 200 — and the paired objective delta, the gap alternative's only quality evidence, would thin to 40 pairs silently. My own test could not catch it because `min_cases=99 > max_cases=3` meant the stop path never executed. **A test that cannot reach the branch it names is not coverage.**
- **F-R7 — MP-R4's finding, recurring after I marked it fixed, twice.** `objective_deltas` and `corpus_frequency` were declared in an interface block and never implemented; the disposition table said otherwise. The consequence is concrete rather than cosmetic: with no `objective_delta_*` columns in the aggregate CSV, the relaxed-gap alternatives carry no paired quality evidence, and **the gap decision MP-R3 requires cannot be made from the deliverable at all.**
- **F-R8 — every checkpoint I wrote was prose.** MP-1 and MP-2 existed only as blockquotes, so an agent walking the checkbox list would provision infrastructure and run a three-hour soak without ever asking. Nothing even *drafted* the table MP-1 ratifies. And the self-review row still asserted the pre-MP-R6 ordering, so the document again held both orderings — the same partial-propagation failure, in a table I never re-read.
- **F-R19 — verified in the repo, and it is load-bearing.** `solve.py:1341` reads `inp["timeLimitSec"]` unconditionally for Chen's. A case missing that key raises `KeyError` inside the forked child and becomes an `ok=False` row, so an entire stratum reports **100% failure as a measurement result** rather than failing at manifest load with a clear error. My `validate()` prose promised model-specific required-key checks; the code checked none.
- **F-R10/F-R11 — R3-R2's lesson, half-learned.** I separated cores from slots but then bounded the slot sweep with a parameter named `max_instances`, and gave `cores_per_slot` no derivation while `required_cores` already divided by η — so a calibrated `cores_per_slot` would have applied the same contention loss twice, over-provisioning by ~1/η with every intermediate number arithmetically fine. Separating the *names* was not the same as separating the *quantities*.
- **F-R12/F-R13 — two profiles I defined and then never reconciled with the rules around them.** The 99% achieved-rate rule would have failed **every** UI-faithful run, because one-job-in-flight is closed-loop by construction. And M3.4b's soak/burst/restart were authoritative by the preamble's own definition while belonging to no candidate in M5.2's matrix.

**Cross-cutting note, added after round 4.** An independent model found twenty defects in a document three prior rounds had passed over, and the two most dangerous — F-R1's silent field shift and F-R10's double-counted efficiency — were both **introduced by my own previous folds**, as robustness and rigour improvements. The durable lesson is narrower than "review more": **a fold is a change, and changes need the same scrutiny as the thing they fix.** I have been treating corrections as automatically safe because they were responses to valid findings. Concretely, two habits for the next fold: (1) **after adding a constructor, dataclass field or parameter, re-check every other call site of that symbol** — F-R1, F-R3 and F-R11 are all one symbol changed in one place; (2) **when a fix targets a mechanism, ask whether the mechanism has a second half** — F-R6's scheduling-vs-retention and F-R10's naming-vs-units are the same mistake, fixing the visible half and declaring the problem closed.

**Cross-cutting note, added after round 3.** The durable lesson is not any individual finding: **when the same class of defect survives three folds, fix the structure, not the instance.** I twice promised to be more careful about snippet drift and twice shipped drift; only removing the duplicate definitions removed the defect. Second lesson, from R3-R2: **a rename is not a fix.** When a review says a quantity is modelled wrongly, changing its name while leaving its formula is the most dangerous possible response — it silences the reviewer's signal while preserving the error, and the next reader sees a confident label over the wrong number.

**Cross-cutting note, updated after round 2.** Two rules, both earned here. **(1) Fix every instance or state which you did not** — a partial fix under a completion claim is worse than an untouched defect, because the prose vouches for the code. **(2) Assert properties, not digits** — both versions of the candidate-worker test failed because a hand-reasoned number looked right; a property assertion would have failed on the first run and cost nothing. And a scope note: when a review is valid, folding *everything* it implies is not automatically correct — ask what the decision needs, because rigor that cannot change the outcome is cost without evidence.

**Prior note, retained.** Against the taxonomy built across the A-plan rounds, round 1 of this review was dominated by a class those rounds never hit: **plausible code that silently produces wrong numbers.** MP-R1, MP-R2 and MP-R3 all pass review-by-reading and all yield evidence that looks fine and is not — repeated cases counted as independent, CBC's CPU missing from a CPU metric, gap averaged into a baseline. A prose plan can be audited by reading it; a measurement plan cannot, because its errors surface as numbers rather than contradictions. **Standing rule for measurement work specifically: for every reported metric, name what it excludes.** "CPU time" that omits a subprocess, "peak RSS" that is a stale high-water mark, and "200 observations" that are 200 trials of one case are all the same failure — a correct-sounding label over a quantity that does not match it.

---
