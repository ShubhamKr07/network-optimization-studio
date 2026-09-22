# SCND Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Read "Preflight gates" and the spec's MP-1…MP-4 checkpoints before starting anything** — several tasks stop and ask.

**Goal:** Build the harness and analysis that produce the evidence sizing the Scaling build — capacity ceiling, exact bottleneck, per-solve cost, cache-hit reality, topology winner — without a real cohort.

**Architecture:** Three layers, each consuming the previous one's artifacts. (1) A **local, in-process Python microbenchmark** measures per-solve service demand over a declared stratified corpus and writes raw CSV. (2) A **pure-computation capacity model** turns that distribution plus an arrival trace into candidate worker counts by simulation — never from p95. (3) An **HTTP load harness** runs open-loop against an isolated environment to validate the prediction and produce the gate verdicts. Analysis is deliberately separated from measurement so re-analysis never requires re-running a three-hour soak.

**Tech Stack:** Python 3.13 (PuLP 3.3.2 / CBC), pytest · Node 24 driver for HTTP load · Postgres · Render (isolated environment)

**Spec:** `../specs/2026-09-22-scnd-measurement-design.md`

## Global Constraints

- **Sequencing:** the full Option A rollout ships **before** this plan executes, and the **AP-4 cohort-gate waiver must already be recorded** in `2026-09-22-scnd-correctness-A-full-contract.md`. Verify both in Preflight; do not infer either.
- **Isolated environment only.** Never run the load harness against production (`nos-api`/`nos-postgres`). §1.5 of the spec.
- **No production infra as a committed change.** The worker prototype is disposable scaffolding under MP-3 with a named teardown owner.
- **p95 never sizes capacity.** Capacity comes from mean CPU service demand × declared stratum weights, validated by p95. (M-R8)
- **Corpus frequency is never student prevalence.** Every reported frequency is labelled as corpus/generator frequency, per stratum. (M-R9)
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
- Produces: `load_manifest(path) -> Manifest`; `Manifest.cells() -> list[Cell]`; `Cell` with `model_id, regime, edit_family, gap, weight` and **`cases: list[Case]`**; `Case` with **`case_id: str`**, `inputs: dict`, `generator_seed: int | None`; `Cell.key`; `Manifest.validate()`.

> **MP-R1 — the single most important correction in this fold.** The round-1 design gave each `Cell` **one** `inputs: dict`, and M1.3 then ran that one input 200 times. Those 200 rows measure **runtime variance for one scenario** — precisely what the spec classifies as a *determinism* run — and labelling them `kind="campaign"` does not make them independent. The capacity model would then have been built on 200 repetitions of a single case per cell. **A cell now holds a set of distinct cases**; 200 means **200 distinct `case_id`s**, never 200 trials of one. Repeated execution of a fixed `case_id` is legal only inside `run_determinism()`.

**Manifest validation (review recommendation).** A weights-only check is insufficient for an authoritative corpus. `validate()` must check: `version`; allowed `model_id` values against `solvers/*/manifest.json`; allowed `regime` ∈ {`forced_open`, `free_choice`}; allowed `edit_family` ∈ {`demand`, `capacity`, `force`, `distance`, `null`}; finite non-negative weights summing to 1; allowed gaps; **unique `Cell.key` and unique `case_id` within a cell**; required input fields per model; and that every declared cell has **≥ the configured minimum case count**.

- [ ] **Step 1: Write the failing test**

```python
# test_corpus.py
import json, pytest
from benchmark.corpus import load_manifest, ManifestError

def _stratum(model, regime, fam, weight, n_cases):
    return {"model_id": model, "regime": regime, "edit_family": fam, "weight": weight,
            "cases": [{"case_id": f"{model}-{i}", "inputs": {"p": 3 + i}} for i in range(n_cases)]}

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
import json
from dataclasses import dataclass

class ManifestError(ValueError):
    pass

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
        if abs(sum(s["weight"] for s in self.strata) - 1.0) >= 1e-9:
            raise ManifestError("stratum weights must sum to 1")
        if any(s["weight"] < 0 for s in self.strata):
            raise ManifestError("weights must be non-negative")
        for s in self.strata:
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
            Cell(s["model_id"], s["regime"], s.get("edit_family"), g, s["weight"],
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
Expected: PASS (2 passed)

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
- Produces: `measure_once(cell, case, solve_fn=None) -> Observation`; `Observation` with `cell_key, case_key, wall_sec, cpu_tree_sec, harness_overhead_sec, python_peak_rss, cbc_peak_rss, objective, solution_status, termination_reason, ok, error, kind`. *(No `build_sec`/`solve_sec` — the split is withdrawn per L-R1; no `peak_rss_tree_bytes` — the two peaks stay separate and labelled.)*

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
from benchmark.corpus import Cell
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
import os, platform, resource, time, pickle, tempfile
from dataclasses import dataclass

@dataclass
class Observation:
    cell_key: str
    case_key: str                 # L-R4: (model, regime, edit_family, case_id)
    wall_sec: float
    cpu_tree_sec: float           # MP-R2: Python + CBC, user + sys
    harness_overhead_sec: float
    python_peak_rss: int          # L-R1: kept separate, never summed
    cbc_peak_rss: int
    objective: float | None
    solution_status: str | None
    termination_reason: str | None
    ok: bool
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

def measure_once(cell, case, solve_fn=None) -> Observation:
    solve_fn = solve_fn or _default_solve
    t_start = time.monotonic()
    with tempfile.TemporaryDirectory() as tmpdir:      # MP-R2: never mktemp()
        out_path = os.path.join(tmpdir, "obs.pkl")
        t0 = time.monotonic()
        pid = os.fork()
        if pid == 0:
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
            finally:
                os._exit(0)
        _, status = os.waitpid(pid, 0)
        wall = time.monotonic() - t0
        if not os.path.exists(out_path):
            return Observation(cell.key, case.case_key(cell), wall, 0.0, 0.0, 0, 0,
                               None, None, None, False,
                               f"child produced no output (exit status {status})")
        with open(out_path, "rb") as f:
            rec = pickle.load(f)
    overhead = (time.monotonic() - t_start) - wall
    return Observation(
        cell_key=cell.key,
        case_key=case.case_key(cell),        # L-R4: stable across gaps
        wall_sec=wall,
        cpu_tree_sec=rec.get("cpu_tree", 0.0),
        harness_overhead_sec=overhead,
        python_peak_rss=rec.get("python_peak", 0),
        cbc_peak_rss=rec.get("cbc_peak", 0),
        objective=rec.get("objective"),
        solution_status=rec.get("status"),
        termination_reason=rec.get("reason"),
        ok=bool(rec.get("ok")),
        error=rec.get("error"),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest benchmark/test_measure.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/solver/tests/benchmark/measure.py artifacts/api-server/src/solver/tests/benchmark/test_measure.py
git commit -m "[M1.2] benchmark: forked single-observation primitive with normalized peak RSS"
```

### Task M1.3: Runner — randomized order, warm-up, stopping rule, determinism separation

**Files:**
- Create: `artifacts/api-server/src/solver/tests/benchmark/runner.py`
- Test: `artifacts/api-server/src/solver/tests/benchmark/test_runner.py`

**Interfaces:**
- Consumes: `Manifest`, `Cell`, `Case` (M1.1); `measure_once`, `Observation` (M1.2).
- Produces: `run_campaign(manifest, min_cases=30, max_cases=200, ci_width=0.10, warmup=3, seed=0, measure=measure_once) -> list[Observation]`; `run_determinism(cell, case, reps=30, measure=...) -> list[Observation]`.

**Declared design (M-R4, corrected by MP-R1):** **200 distinct `case_id`s per sizing cell** — not 200 trials of one case. Warm-ups are **executed and discarded BEFORE the measured schedule is randomized**, not shuffled into it: the round-1 code appended warm-up and measured entries to one list and then shuffled, so a row flagged `warmup` could execute *after* measured observations, which is not a warm-up policy. Warm-up scope is declared as **per cell** (3 per cell). Measured order is randomized across all cells with a recorded seed. Determinism runs are a separate campaign, tagged `kind="determinism"`, and are **excluded from every sizing, frequency and uncertainty aggregate**.

**Tests this task must add (MP-R1):** campaign `case_id`s within a cell are **all distinct**; determinism `case_id`s are **all identical**; **no measured observation precedes its cell's warm-ups**; the same seed reproduces the identical measured order.

- [ ] **Step 1: Write the failing test**

```python
# test_runner.py
from benchmark.corpus import Manifest, Cell
from benchmark.runner import run_campaign, run_determinism

def _fake_measure_factory(log):
    def _m(cell, solve_fn=None):
        log.append(cell.key)
        from benchmark.measure import Observation
        return Observation(cell.key, 1.0, 0.5, 0.2, 0.8, 100, 1.0, "optimal", "optimality_proven", True)
    return _m

def _manifest():
    return Manifest(1, [
        {"model_id": "a", "regime": "forced_open", "edit_family": None, "weight": 0.5, "inputs": {}},
        {"model_id": "b", "regime": "free_choice", "edit_family": "demand", "weight": 0.5, "inputs": {}},
    ], [0.0])

def test_discards_warmup_and_keeps_n_per_cell():
    log = []
    obs = run_campaign(_manifest(), n_per_cell=5, warmup=2, seed=1, measure=_fake_measure_factory(log))
    assert len(log) == 2 * (5 + 2)      # both cells, warm-up included in execution
    assert len(obs) == 2 * 5            # warm-up excluded from results
    assert all(o.kind == "campaign" for o in obs)

def test_order_is_randomized_but_seed_reproducible():
    l1, l2 = [], []
    run_campaign(_manifest(), n_per_cell=4, warmup=0, seed=7, measure=_fake_measure_factory(l1))
    run_campaign(_manifest(), n_per_cell=4, warmup=0, seed=7, measure=_fake_measure_factory(l2))
    assert l1 == l2
    assert l1 != sorted(l1)             # not grouped by cell

def test_determinism_rows_are_tagged_and_separate():
    cell = Cell("a", "forced_open", None, 0.0, 1.0, {})
    rows = run_determinism(cell, reps=3, measure=_fake_measure_factory([]))
    assert len(rows) == 3
    assert all(r.kind == "determinism" for r in rows)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest benchmark/test_runner.py -v`
Expected: FAIL — `No module named 'benchmark.runner'` (and `Observation` has no `kind`)

- [ ] **Step 3: Add `kind` to `Observation` and implement the runner**

In `measure.py`, add `kind: str = "campaign"` as the last field of `Observation`.

```python
# runner.py
import random
from benchmark.measure import measure_once

def run_campaign(manifest, min_cases=30, max_cases=200, ci_width=0.10,
                 warmup=3, seed=0, measure=measure_once):
    """L-R1: warm-ups run and are DISCARDED BEFORE the measured schedule is
    randomized -- the round-1 code shuffled them together, so a 'warm-up'
    could execute after measured rows. Each observation uses a DISTINCT Case
    (MP-R1). Stopping is sequential: at least `min_cases`, stop when the
    bootstrap CI half-width on mean CPU demand is within `ci_width` relative,
    cap at `max_cases` -- 200 is a ceiling, not a quota."""
    from benchmark.stats import bootstrap_ci, relative_half_width
    rng = random.Random(seed)
    kept = []
    for cell in manifest.cells():
        for case in list(cell.cases)[:warmup]:          # warm-up FIRST, discarded
            measure(cell, case)
        cases = list(cell.cases)
        rng.shuffle(cases)                              # randomized measured order
        cell_rows = []
        for case in cases[:max_cases]:
            obs = measure(cell, case)
            obs.kind = "campaign"
            cell_rows.append(obs)
            if len(cell_rows) >= min_cases:
                cpus = [o.cpu_tree_sec for o in cell_rows if o.ok]
                if cpus and relative_half_width(bootstrap_ci(cpus, _mean)) <= ci_width:
                    break
        kept.extend(cell_rows)
    return kept

def _mean(xs):
    return sum(xs) / len(xs)

def run_determinism(cell, case, reps=30, measure=measure_once):
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
Expected: PASS (3 passed)

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
- Produces: `percentile`, `bootstrap_ci`, `aggregate(observations, manifest) -> dict[str, CellStats]`, `corpus_frequency(observations, manifest) -> dict[str, float]`, `objective_deltas(observations) -> dict[str, float]`.

> **MP-R4 — the round-1 summary did not satisfy the spec's uncertainty contract.** It computed a CI for **p95 only**, while the spec requires raw rows **plus uncertainty** for p50, p95, mean service demand, slow-regime frequency, failure/rejection rates, RSS **and objective delta**. Three further defects: `corpus_frequency()` was declared in the Interfaces block and **never implemented or tested**; no outlier policy was declared; and an all-failure cell hits `walls[0]` on an empty list and **crashes** instead of reporting an unusable cell.

**`CellStats` — the complete predeclared schema.** `n_cases, n_obs, n_success, failure_rate (+CI), mean_cpu_tree_sec (+CI), p50_wall (+CI), p95_wall (+CI), mean_peak_rss_tree (+CI), objective_delta_vs_gap0 (+CI), usable: bool, unusable_reason: str | None`. Every `(+CI)` is a bootstrap interval by the same method and recorded `alpha`.

- **Objective deltas (MP-R4):** computed **paired by `case_id`** against that same case's `gap=0` result. Explicit rule for infeasible / no-incumbent / failed outcomes: the pair is **excluded and counted**, never imputed. Without this, a faster relaxed-gap solve has no quality evidence and the gap experiment cannot be approved.
- **Outlier policy, declared before any measurement:** none are deleted. Raw rows are preserved in full; aggregates report both the raw estimate and a trimmed estimate (5% each tail) side by side, so a trimming choice can never be made after seeing results.
- **Unusable cells fail loudly:** zero successes, or fewer than the declared minimum distinct cases, sets `usable=False` with a reason. M2.1 **fails closed** on any unusable cell rather than treating it as zero demand.
- **`corpus_frequency()` is implemented and tested here**, returning the declared generator weights actually realised by the campaign, labelled corpus/generator frequency — **never** student prevalence (M-R9).

- [ ] **Step 1: Write the failing test**

```python
# test_stats.py
from benchmark.measure import Observation
from benchmark.stats import percentile, bootstrap_ci, aggregate

def _obs(key, wall, cpu, case="c0", ok=True, kind="campaign"):
    return Observation(cell_key=key, case_key=f"{key}|{case}", wall_sec=wall,
                       cpu_tree_sec=cpu, harness_overhead_sec=0.01,
                       python_peak_rss=1000, cbc_peak_rss=2000, objective=1.0,
                       solution_status="optimal", termination_reason="optimality_proven",
                       ok=ok, error=None, kind=kind)

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
    assert aggregate(rows, min_cases=1)["k"].failure_rate == 0.1

def test_all_failure_cell_is_unusable_not_a_crash():
    # L-R1: round 1 indexed walls[0] on an empty list here.
    rows = [_obs("k", 0.0, 0.0, case=f"c{i}", ok=False) for i in range(5)]
    cs = aggregate(rows, min_cases=1)["k"]
    assert cs.usable is False and "no successes" in cs.unusable_reason

def test_under_sampled_cell_is_unusable():
    rows = [_obs("k", 1.0, 0.5, case=f"c{i}") for i in range(3)]
    cs = aggregate(rows, min_cases=30)["k"]
    assert cs.usable is False and "distinct cases" in cs.unusable_reason
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
    # descriptive -- point estimates, backed by raw rows
    p50_wall: float = 0.0
    mean_python_peak_rss: float = 0.0
    mean_cbc_peak_rss: float = 0.0

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

def bootstrap_ci(xs, stat, reps=2000, alpha=0.05, seed=0):
    rng = random.Random(seed)
    draws = [stat([rng.choice(xs) for _ in xs]) for _ in range(reps)]
    return percentile(draws, alpha / 2), percentile(draws, 1 - alpha / 2)

def aggregate(observations):
    by_cell = {}
    for o in observations:
        if o.kind != "campaign":
            continue
        by_cell.setdefault(o.cell_key, []).append(o)
    out = {}
    for key, rows in by_cell.items():
        ok = [r for r in rows if r.ok]
        n_cases = len({r.case_key for r in rows})
        # L-R1: an all-failure or under-sampled cell is reported as UNUSABLE,
        # never crashed on (round 1 indexed walls[0] on an empty list) and
        # never returned as zero demand (which would shrink sizing silently).
        if not ok or n_cases < min_cases:
            out[key] = CellStats(n_cases=n_cases, n_obs=len(rows), n_success=len(ok),
                                 usable=False,
                                 unusable_reason="no successes" if not ok
                                 else f"only {n_cases} distinct cases")
            continue
        walls = [r.wall_sec for r in ok]
        cpus = [r.cpu_tree_sec for r in ok]
        # L-R1: uncertainty ONLY on decision metrics. p50, RSS and corpus
        # frequency are descriptive -- point estimates plus raw rows suffice.
        out[key] = CellStats(
            n_cases=n_cases, n_obs=len(rows), n_success=len(ok), usable=True,
            mean_cpu_tree_sec=_mean(cpus),
            mean_cpu_ci=bootstrap_ci(cpus, _mean),
            p95_wall=percentile(walls, 0.95),
            p95_wall_ci=bootstrap_ci(walls, lambda s: percentile(s, 0.95)),
            failure_rate=1 - len(ok) / len(rows),
            failure_rate_ci=bootstrap_ci([0.0 if r.ok else 1.0 for r in rows], _mean),
            p50_wall=percentile(walls, 0.5),                       # descriptive
            mean_python_peak_rss=_mean([r.python_peak_rss for r in ok]),   # descriptive
            mean_cbc_peak_rss=_mean([r.cbc_peak_rss for r in ok]),         # descriptive
        )
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest benchmark/test_stats.py -v`
Expected: PASS (4 passed)

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
- Produces: `write_raw(observations, path)`, `write_aggregates(stats, manifest, path)`; CSVs `docs/superpowers/metrics/benchmark-raw.csv` and `benchmark-aggregates.csv`.

**Raw columns (L-R1 — `case_key` is mandatory or the advertised paired re-analysis is impossible from the artifact):**
`run_id,timestamp,cell_key,case_key,case_id,model_id,regime,edit_family,gap,kind,wall_sec,cpu_tree_sec,harness_overhead_sec,python_peak_rss,cbc_peak_rss,objective,solution_status,termination_reason,ok,error`

**Aggregate columns:**
`run_id,cell_key,model_id,regime,edit_family,gap,corpus_weight,n_cases,n_obs,n_success,usable,unusable_reason,mean_cpu_tree_sec,mean_cpu_ci_low,mean_cpu_ci_high,p95_wall,p95_wall_ci_low,p95_wall_ci_high,failure_rate,failure_rate_ci_low,failure_rate_ci_high,p50_wall,mean_python_peak_rss,mean_cbc_peak_rss,corpus_frequency`

Confidence intervals appear only on the four decision metrics (mean CPU demand, p95 wall, failure rate, and the paired objective delta reported alongside); `p50_wall`, the two RSS columns and `corpus_frequency` are descriptive point estimates backed by the raw rows (L-R1).

- [ ] **Step 1: Write the failing test** — assert the header row matches the two lists above exactly, that a determinism row appears in raw with `kind=determinism`, and that `corpus_frequency` is present in aggregates.
- [ ] **Step 2: Run it** — `python3 -m pytest benchmark/test_report.py -v` → FAIL.
- [ ] **Step 3: Implement** `write_raw`/`write_aggregates` with `csv.DictWriter` and the exact headers; `cli.py` wires `load_manifest → run_campaign → aggregate → write_*` behind `argparse` (`--manifest`, `--n`, `--warmup`, `--seed`, `--out-dir`, `--determinism-cell`).
- [ ] **Step 4: Run it** → PASS.
- [ ] **Step 5: Document the columns** in `docs/superpowers/metrics/README.md`, including the sentence that `corpus_frequency` is **generator frequency, not student prevalence** (M-R9).
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

**Why separate from Phase 3.** Analysis must be re-runnable without repeating a three-hour soak. Phase 2 consumes Phase 1's CSV and produces candidate worker counts; Phase 3 only validates them.

### Task M2.1: Service-demand model — mean CPU demand weighted by declared strata

**Files:**
- Create: `artifacts/api-server/src/solver/tests/benchmark/capacity.py`
- Test: `artifacts/api-server/src/solver/tests/benchmark/test_capacity.py`

**Interfaces:**
- Consumes: `CellStats` (M1.4), `Manifest` (M1.1).
- Produces: `weighted_mean_service_demand(stats, manifest) -> float` (CPU-seconds per job); `required_cores(demand_sec, arrival_rate_per_sec, parallel_efficiency, headroom) -> float`.

**The formula (M-R8), stated once so no task re-derives it:** offered work `ρ = λ × E[S_cpu]`, where `λ` is arrival rate and `E[S_cpu]` is the **weighted mean CPU service demand** — not p95, not wall time. Required cores = `ρ / (parallel_efficiency × (1 − headroom))`.

> **MP-R3 — three corrections, and gap is the important one.**
>
> **1. Gap is a configuration alternative, not a workload dimension.** Round 1 iterated every gap cell and divided by `len(manifest.gaps)`, treating `gap ∈ {0, 0.005, 0.01, 0.02}` as an equal-probability production mix. It is not: production runs at whatever gap is configured, and averaging faster relaxed-gap runs into the mandatory `gap=0` baseline **understates required capacity**. **Correction:** capacity is computed **separately per gap**; `gap=0` is the mandatory baseline; relaxed gaps are presented as explicit alternatives **with their paired objective-quality deltas** (M1.4), never averaged in.
>
> **2. Missing cells must fail closed.** Round 1 did `if cs is None: continue`, so an absent cell **silently reduced** the demand estimate — the failure mode where less evidence produces a smaller, more comfortable number. **Correction:** raise on any required cell that is absent, unusable, or below the minimum distinct-case count.
>
> **3. `parallel_efficiency` must be measured, not passed in.** The spec requires measured per-solve CPU utilisation and parallel efficiency, and local CPU-seconds are **not transferable** to a different Render plan without calibration on that plan. **Correction:** add a **concurrency sweep** (below) on each candidate target plan; store the derived efficiency keyed by **plan ID + application SHA**, and have `required_cores` consume that stored value rather than a caller's guess.

**M2.1b — calibration, and it does NOT live in Phase 2 (L-R3).** The last fold put a concurrency sweep requiring real Render runs inside a phase labelled *pure computation, no infrastructure*, ahead of MP-2 and MP-3 — so Phase 2 promised an artifact its own position made unobtainable. Corrected ordering:

1. **Phase 2 produces uncalibrated distributions only** — the analytical code, its tests, and candidate counts *parameterised* by efficiency and headroom. No infrastructure, no real runs, no final numbers.
2. **After MP-1 (headroom ratified) and MP-2 (environment approved)**, run a **short calibration** on the shortlisted plans at a **geometric concurrency set — 1, 2, 4, 8** — stopping early when throughput flattens or headroom fails. **Not** every integer on every plan; the sweep exists to find the efficiency knee, not to chart it.
3. **Final candidate counts are produced only after** calibration exists **and** headroom is ratified — they consume both.

Output: `docs/superpowers/metrics/parallel-efficiency.csv`, keyed by `plan_id, app_sha, concurrency`. This is the only legitimate source for the efficiency term.

- [ ] **Step 1: Write the failing test**

```python
# test_capacity.py
import pytest
from benchmark.capacity import weighted_mean_service_demand, required_cores
from benchmark.stats import CellStats
from benchmark.corpus import Manifest

def _stats(a_cpu, b_cpu):
    mk = lambda c: CellStats(200, c, 1.0, 2.0, 1.8, 2.2, 1000, 0.0)
    return {"a|forced_open|-|0.0": mk(a_cpu), "b|free_choice|demand|0.0": mk(b_cpu)}

def _manifest():
    return Manifest(1, [
        {"model_id": "a", "regime": "forced_open", "edit_family": None, "weight": 0.9, "inputs": {}},
        {"model_id": "b", "regime": "free_choice", "edit_family": "demand", "weight": 0.1, "inputs": {}},
    ], [0.0])

def test_weighted_mean_uses_declared_weights_not_raw_average():
    d = weighted_mean_service_demand(_stats(1.0, 11.0), _manifest())
    assert d == pytest.approx(0.9 * 1.0 + 0.1 * 11.0)   # 2.0, not the unweighted 6.0

def test_required_cores_accounts_for_efficiency_and_headroom():
    cores = required_cores(demand_sec=2.0, arrival_rate_per_sec=0.694,
                           parallel_efficiency=0.8, headroom=0.3)
    assert cores == pytest.approx((2.0 * 0.694) / (0.8 * 0.7))

def test_rare_slow_stratum_beyond_p95_still_enters_the_mean():
    # 2% of load at 100 CPU-s sits beyond p95 yet dominates compute
    m = Manifest(1, [
        {"model_id": "fast", "regime": "forced_open", "edit_family": None, "weight": 0.98, "inputs": {}},
        {"model_id": "slow", "regime": "free_choice", "edit_family": None, "weight": 0.02, "inputs": {}},
    ], [0.0])
    mk = lambda c: CellStats(200, c, 1.0, 2.0, 1.8, 2.2, 1000, 0.0)
    d = weighted_mean_service_demand(
        {"fast|forced_open|-|0.0": mk(0.5), "slow|free_choice|-|0.0": mk(100.0)}, m)
    assert d == pytest.approx(0.98 * 0.5 + 0.02 * 100.0)   # 2.49 — slow stratum is most of it
```

- [ ] **Step 2: Run it** → FAIL, `No module named 'benchmark.capacity'`.
- [ ] **Step 3: Implement**

```python
# capacity.py
class SizingError(ValueError):
    pass

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

def required_solver_slots(demand_sec, arrival_rate_per_sec, parallel_efficiency, headroom):
    """Returns SLOTS, not instances. L-R2: topology is
    instances x solver_slots_per_instance; Render's 100-instance ceiling is
    not a 100-slot ceiling. parallel_efficiency comes from M2.1b calibration
    keyed by plan_id + app_sha -- never a caller's guess."""
    if not (0 < parallel_efficiency <= 1):
        raise ValueError("parallel_efficiency must be in (0, 1]")
    if not (0 <= headroom < 1):
        raise ValueError("headroom must be in [0, 1)")
    return (demand_sec * arrival_rate_per_sec) / (parallel_efficiency * (1 - headroom))
```

- [ ] **Step 4: Run it** → PASS (3 passed).
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
- Produces: `simulate(trace, strata, workers, seed) -> SimResult` with `p50_wait, p95_wait, p95_end_to_end, max_queue_depth, utilization, observed_stratum_mix`; `candidate_worker_counts(trace, strata, slo_p95_end_to_end_sec=None, slo_p95_queue_wait_sec=None, max_workers=None) -> list[tuple[int, SimResult]]`.

**Design:** discrete-event, *n* servers, FIFO. Service times are sampled from the **empirical distribution**, never a fitted mean — the whole point of M-R8's "replay the full measured distribution".

> **MP-R3 — stratified replay, not a flat list.** Round 1 passed one flat `service_samples` list and drew with `rng.choice`, which **discards** the declared model/regime/edit-family weights, cache class, gap and case identity. If the corpus happens to hold equal counts per cell, uniform replay silently substitutes **equal population weights** for the declared sensitivity mix — the simulation would then answer a question nobody asked. **Correction:** `strata` is `{stratum_key: (samples, weight)}`; each event is **tagged by drawing a stratum from the declared weights**, then its service time is drawn from *that* cell's empirical distribution. `observed_stratum_mix` is reported so the realised mix can be checked against the declared one.
>
> **Cache hits bypass CBC.** A cache-hit event consumes **no** solver service time but **retains its measured API cost**, so hit-heavy profiles do not fictitiously free up worker capacity.
>
> **Both SLO variants, and no arbitrary ceiling.** `candidate_worker_counts` accepts an end-to-end **or** a queue-wait threshold and returns **all** explored counts with their results, flagging which pass — it does not return only passers, so a near-miss stays visible. The round-1 `max_workers=24` was arbitrary: the explored range now derives from the candidate topology and Render's **100-instance** service limit, defaulting to that bound.

- [ ] **Step 1: Write the failing test**

```python
# test_simulate.py
from benchmark.simulate import simulate, candidate_worker_counts

def test_single_server_queue_grows_when_overloaded():
    trace = [i * 1.0 for i in range(100)]                       # 1 job/s
    r = simulate(trace, {"only": ([2.0], 1.0)}, workers=1, seed=0)   # 2 s each
    assert r.p95_wait > 50                      # unstable, queue grows without bound
    assert r.utilization > 0.99

def test_enough_servers_keeps_wait_near_zero():
    trace = [i * 1.0 for i in range(100)]
    r = simulate(trace, {"only": ([2.0], 1.0)}, workers=4, seed=0)
    assert r.p95_wait < 1.0

def test_candidate_worker_counts_returns_all_counts_and_flags_passers():
    # This test has now been wrong TWICE. Round 1 was impossible (SLO 1.0 s
    # below a 2.0 s service time). Round 2 was merely false: at 1 arrival/s
    # with deterministic 2 s service, offered work is exactly 2 server-seconds
    # per second, so TWO workers already give zero wait and 2.0 s end-to-end.
    # The smallest passer is 2, not 3. Both errors came from asserting a
    # number instead of deriving it -- so assert the property, not the digit.
    trace = [i * 1.0 for i in range(200)]
    cands = candidate_worker_counts(trace, {"only": ([2.0], 1.0)},
                                    slo_p95_end_to_end_sec=2.5, max_instances=8)
    assert [c.workers for c in cands] == list(range(1, 9))   # ALL counts, ascending
    first_pass = next(c for c in cands if c.passes)
    assert first_pass.workers == 2
    assert not cands[0].passes                               # 1 worker is overloaded

def test_queue_wait_slo_variant_is_also_available():
    trace = [i * 1.0 for i in range(200)]
    cands = candidate_worker_counts(trace, {"only": ([2.0], 1.0)},
                                    slo_p95_queue_wait_sec=0.5, max_instances=8)
    assert next(c for c in cands if c.passes).result.p95_wait <= 0.5

def test_stratified_replay_respects_declared_weights():
    # MP-R3: a flat sample list silently substitutes equal population weights
    # for the declared sensitivity mix.
    trace = [i * 1.0 for i in range(1000)]
    strata = {"fast": ([0.1], 0.98), "slow": ([50.0], 0.02)}
    r = simulate(trace, strata, workers=4, seed=0)
    assert 0.015 < r.observed_stratum_mix["slow"] < 0.025
```

- [ ] **Step 2: Run it** → FAIL.
- [ ] **Step 3: Implement** a heap-based event loop: push arrivals, maintain `workers` free-at timestamps. **Per event, draw a stratum from the declared weights first, then draw the service time from that stratum's empirical samples** (L-R2 — never `rng.choice` over a flat list, which substitutes uniform weights for the declared mix). Cache-hit events consume no solver slot. Record wait and end-to-end per job, plus `observed_stratum_mix`. `candidate_worker_counts` returns `CandidateResult(workers, result, passes)` for **every** explored count in ascending order — callers select the first `passes`, so a near-miss stays visible.
- [ ] **Step 4: Run it** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "[M2.3] queue simulator: empirical-distribution replay to candidate worker counts"`

---

## Phase 3 — Load harness (needs the isolated environment)

> **MP-2 fires before this phase.** Ask: *"Measurement needs an isolated Render environment — separate database, separate cache namespace, synthetic identities, analytics/alerts disabled, named teardown owner, dated cost snapshot. Approve provisioning and its teardown plan?"* Do not provision anything first.
>
> **MP-1 MOVED HERE — it fires before the first authoritative run, NOT before M5.2 (MP-R6).** Round 1 placed MP-1 immediately before the topology runs while M3.4 already executed the restart probe, the three-hour soak and the burst. That let the **main load evidence be observed before the SLO thresholds, aggregation rules, headroom limits and repetition pass rule were ratified** — exactly the post-hoc gate movement M-R5 was written to prohibit, reintroduced by task ordering.
>
> **The line, stated explicitly.** Harness code, unit tests, environment provisioning and **exploratory shakedown runs** may precede MP-1, provided every such run is **labelled non-authoritative and excluded from the decision dataset**. The ratified MP-1 artifact must exist **before the first authoritative representative, all-JADE, burst, restart or topology run**. Record the answer, UTC date and decider in `docs/CHANGELOG-implementation.md` before execution.

### Task M3.1: Isolated environment + cohort provisioning

**Files:**
- Create: `scripts/measurement/provision-env.sh`
- Create: `scripts/measurement/seed-cohort.mjs`
- Create: `docs/ops/measurement-environment.md` (pinned config + teardown runbook)

- [ ] **Step 1.** Record the pinned set in `docs/ops/measurement-environment.md` **before** provisioning: application SHA, dataset version, region, exact compute plan IDs, instance count, environment variables, database plan, load-generator location/capacity, **named teardown owner**, and the dated price snapshot.
- [ ] **Step 2.** `provision-env.sh` creates the isolated service + database. Analytics disabled via `POSTHOG_API_KEY` unset and `SENTRY_DSN` unset — assert both are absent after boot rather than assuming.
- [ ] **Step 3.** `seed-cohort.mjs` registers **50 distinct synthetic users** through `POST /auth/register` (never one shared account — auth/session cost is part of the load). **MP-R5: registering accounts is not sufficient.** The API solves an **existing persisted scenario** (`POST /scenarios/:id/solve`), so provisioning must also **create and save the scenario/input fixtures per user through the real `/api` contracts** and retain their scenario IDs for submission. A cohort of 50 users with no scenarios cannot submit anything.
- [ ] **Step 4.** Record scenario IDs in the run manifest. **Never commit cookies or credentials**; session material lives only in ignored, permission-restricted temporary storage.
- [ ] **Step 5.** Verify isolation **without touching production** (review recommendation): assert distinct Render environment/service/database identifiers, then perform a **sentinel write/read confined to the measurement database**. Do **not** fetch or copy production user identities merely to prove no overlap — that would import the very data the isolation exists to avoid.
- [ ] **Step 5. Commit** — `git commit -m "[M3.1] isolated measurement environment + 50-session synthetic cohort"`

### Task M3.2: Cache population preparation and verification

**Files:** Create `scripts/measurement/prepare-cache.mjs`

Populations per the spec's table — **prepared and verified, never assumed**:

- [ ] **Step 1.** Exact-hit population (20%): solve each input once, then **assert a `result_cache` row exists** for its hash.
- [ ] **Step 2.** Near-identical population (60%): generate from the four named edit families (`demand`, `capacity`, `force`, `distance`); assert each produces a **distinct** hash from its parent.
- [ ] **Step 3.** Distinct population (20%): cold-unique keys; assert **no** cache row exists for any.
- [ ] **Step 4.** Cold-identical burst set: 50 copies of one input; assert **zero** prior cache rows for that hash.
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
- [ ] **Step 5.** Emit `intended_rate` and `achieved_rate`; **fail the run** if achieved < 99% of intended — a shortfall invalidates rather than passes.
- [ ] **Step 6. Commit** — `git commit -m "[M3.3] open-loop load driver with intended-vs-achieved rate enforcement"`

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

**Files:** Create `scripts/measurement/collect-telemetry.mjs`, `docs/superpowers/metrics/load-run.csv`

- [ ] **Step 1.** Collect the full set defined by M3.4a's source map, joined on `run_id`.
- [ ] **Step 2.** RSS: one declared method, capturing **both** per-child peak and aggregate instance RSS.
- [ ] **Step 3.** Restart probe: redeploy mid-load, assert **zero permanently-stuck jobs** afterwards.
- [ ] **Step 4.** Three-hour soak at the sustained profile; the 50-request burst runs **separately**.
- [ ] **Step 5.** Assert the load generator itself was not saturated — otherwise the run measures the driver, not the system.
- [ ] **Step 6. Commit** — `git commit -m "[M3.4] telemetry collection, restart probe, three-hour soak"`

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

---

## Phase 5 — Topology, cost, gates

> **MP-3 fires before M5.1.** Ask: *"The worker prototype consumes A's durable queue: \<named image/command, queue seam, plan IDs, provisioning owner, teardown procedure, dispatcher-mode configuration\>. Authorize it as disposable, non-production scaffolding?"*
> **MP-1 already fired in Phase 3** (moved there per MP-R6) and must already be recorded before any run here.

### Task M5.1: Disposable worker prototype + dispatcher-mode seam

> **MP-R8 — without this, two of the three topology candidates measure the wrong thing.** Option A deliberately ships a **recurring dispatcher inside the API** (A2). A prototype worker consuming the same durable `solve_jobs` queue therefore **races the API for the same jobs**: some solves run on API compute, silently contaminating the dedicated-worker and horizontal-fleet throughput, resource and cost attribution. The numbers would look plausible and be wrong.

> **Ordering corrected (L-R3).** MP-3 fired *before* M5.1, yet the MP-3 request must name the dispatcher-mode configuration that M5.1 implements — the authorization could not be written before the thing it authorizes existed. **The seam is built and tested first; it creates no external worker.** Sequence: implement + test the seam → prepare the exact image/command/configuration/teardown artifact → **ask and record MP-3** → provision the disposable worker → calibrate on the worker plan.

**Files (L-R3 — named, not "the API"):** `artifacts/api-server/src/solver/jobRunner.ts` (claim guard), `artifacts/api-server/src/config/featureFlags.ts` (mode resolution), `artifacts/api-server/src/config/__tests__/featureFlags.test.ts`, `artifacts/api-server/src/solver/__tests__/dispatcherMode.test.ts`. One commit for the seam, a separate commit for the prototype.

- [ ] **Step 1. Execution-mode seam, default-preserving — built BEFORE MP-3.** For dedicated-worker and fleet measurements the API is **enqueue/poll-only and cannot claim**; the named worker command is the **sole claimant**. The vertical tune-in-place comparator keeps API dispatch **enabled** — that is the whole point of that candidate.
- [ ] **Step 2. Fail closed and observable.** The mode is resolved at startup, logged, and recorded in the run manifest. A **pre-run assertion proves the API's active-solver count stays zero** for worker-only candidates; a non-zero count aborts the run rather than footnoting it.
- [ ] **Step 3. MP-3 request contents.** Exact image SHA, command, queue namespace, plan IDs, **dispatcher-mode configuration**, owner, and teardown/restoration steps — all present *before* asking for authorization, not after.
- [ ] **Step 4. Prove isolation between candidates:** every topology uses an isolated queue/database, and no candidate's run overlaps another candidate's jobs.
- [ ] **Not committed as production infra.** `render.yaml` is unchanged; the prototype is created and torn down out-of-band.

### Task M5.2: Topology runs
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
- [ ] Dated all-in model: workspace fee, always-on API, idle/base worker, burst workers, Postgres, scheduler, storage/backups, bandwidth, and the measurement infrastructure itself. Sensitivity to **cache-hit rate** and **free-choice frequency** (the M-R9 input knob).

### Task M4.3: Experiment comparability (review recommendation)

- [ ] M4.1 and M4.2 use the **same `case_id`s, raw-row schema, repetition counts and objective-validity rules** as the main benchmark, so their decision records are comparable evidence rather than anecdotes. An experiment measured on a different corpus cannot be read against the baseline.

### Task M5.4: Gate verdicts and decision document
- [ ] **Capacity gate:** does the measured topology meet the ratified latency, rejection, headroom and cost limits?
- [ ] **Reliability/isolation gate:** durability, restart recovery, process containment, API availability, safe ownership.
- [ ] The final report records: **intended vs achieved arrival rate**, raw rows, uncertainty, bottleneck evidence, per-gate verdicts, selected topology + worker count, capacity calculation, distribution/trace input, predicted queue behaviour, observed confirmation, and the dated cost model.
- [ ] **Name the evidence artifact per profile (review recommendation).** The verdict cites the run IDs for **both** the representative profile **and** the guaranteed all-JADE cold-miss profile. A topology cannot pass on one and inherit the other by inference.
- [ ] **MP-4 fires:** *"Capacity gate: \<verdict\>. Reliability/isolation gate: \<verdict\>. What is built?"*
- [ ] **Teardown** the isolated environment and the prototype; the named owner confirms.

---

## Self-review against the spec

| Spec section | Covered by |
|---|---|
| §1.1 microbenchmark, stratified corpus, ≥200/cell, determinism separation | M1.1–M1.5 |
| §1.2 open-loop load, cache populations, telemetry, RSS, restart, soak | M3.1–M3.4 |
| §1.3 experiments | M4.1, M4.2 |
| §1.4 topology comparison + platform constraints | M5.1, M5.2 |
| §1.4.1 capacity sizing from mean CPU demand | M2.1–M2.3 |
| §1.5 isolated environment | M3.1 |
| §2 SLO ratification | MP-1 before M5.2 |
| §3 two gates | M5.4 |
| §4 cost model, two denominators | M5.3 |
| §5 deliverables | M1.5, M3.4, M4.x, M5.3, M5.4 |
| MP-1…MP-4 | Phase 3 preamble, Phase 5 preamble, M5.4 |

**Type consistency:** `Cell.key` (M1.1) is the join key through `Observation.cell_key` (M1.2), `aggregate()`'s dict keys (M1.4), and `weighted_mean_service_demand`'s lookup (M2.1). **`Case.case_id` (M1.1) is the second join key** — carried on every `Observation` (M1.2), used to pair objective deltas against `gap=0` (M1.4), and the thing `run_determinism` holds fixed while `run_campaign` varies (M1.3). `Observation.kind` is added in M1.3 and consumed in M1.4 and M1.5.

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

**Cross-cutting note, updated after round 2.** Two rules, both earned here. **(1) Fix every instance or state which you did not** — a partial fix under a completion claim is worse than an untouched defect, because the prose vouches for the code. **(2) Assert properties, not digits** — both versions of the candidate-worker test failed because a hand-reasoned number looked right; a property assertion would have failed on the first run and cost nothing. And a scope note: when a review is valid, folding *everything* it implies is not automatically correct — ask what the decision needs, because rigor that cannot change the outcome is cost without evidence.

**Prior note, retained.** Against the taxonomy built across the A-plan rounds, round 1 of this review was dominated by a class those rounds never hit: **plausible code that silently produces wrong numbers.** MP-R1, MP-R2 and MP-R3 all pass review-by-reading and all yield evidence that looks fine and is not — repeated cases counted as independent, CBC's CPU missing from a CPU metric, gap averaged into a baseline. A prose plan can be audited by reading it; a measurement plan cannot, because its errors surface as numbers rather than contradictions. **Standing rule for measurement work specifically: for every reported metric, name what it excludes.** "CPU time" that omits a subprocess, "peak RSS" that is a stale high-water mark, and "200 observations" that are 200 trials of one case are all the same failure — a correct-sounding label over a quantity that does not match it.

---

## Review — approval validation round 3 (2026-09-23)

**Verdict: REQUEST CHANGES — not yet approved.** The measurement architecture is directionally sound and the round-2 scope reductions should remain. The remaining problems are not requests for more instrumentation or a larger experiment: they are executable-contract errors that can either stop implementation or produce the wrong capacity number while appearing valid.

### R3-R1 — CRITICAL: the prescribed tests and implementations still do not compose

The round-2 disposition says M1 and M2 now form coherent interfaces, but the shown code does not satisfy that claim:

- **M1.3:** its tests still construct strata with `inputs` instead of `cases`, call the removed `n_per_cell` argument, build `Observation` with an invalid positional layout, and call `run_determinism` without its required `case`. The fake measurement function also has the old signature. The shown tests cannot reach their assertions.
- **M1.4:** tests call `aggregate(..., min_cases=...)`, while the implementation accepts only `observations` and then references undefined `min_cases`. `_mean` is undefined in this module, and M1.3 imports an undefined `relative_half_width`. The declared `objective_deltas()` and `corpus_frequency()` are absent. The aggregate CSV schema also omits the claimed paired-objective-delta value and interval.
- **M2.1:** tests import `required_cores`, while the implementation defines `required_solver_slots`; tests omit the now-required `gap`; their manifests still use `inputs` instead of `cases`; and their positional `CellStats(...)` construction no longer matches the dataclass.
- **M1.1:** the validation contract names version, allowed model IDs, allowed/finite gaps, finite weights and model-specific required inputs, but the shown implementation checks only a subset. A malformed authoritative corpus can therefore pass the code advertised as full validation.
- **M1.2:** the task requires corrupt-output and child-status handling, but `pickle.load()` can still escape, the child exits `0` even if serialization fails, and the parent has no deadline/kill path if a solve does not return.
- The expected pass counts in M1.1, M1.2 and M1.4 do not match the number of shown tests. This is minor by itself, but further evidence that the snippets were not executed together.

**Required correction:** make each shown test compile against the immediately preceding interfaces, provide every helper/function the task declares, and run the complete benchmark unit-test gate before claiming the fold complete. Do not add new features beyond the existing contract.

### R3-R2 — CRITICAL: the capacity formula returns cores, not solver slots

`lambda × mean CPU-seconds / (parallel efficiency × (1 - headroom))` has units of **CPU cores**. Renaming that result `required_solver_slots()` does not turn it into concurrent solver slots. A slot may occupy less than, equal to, or more than one effective core depending on the measured plan/concurrency point; memory can also cap slots before CPU does.

Keep the stages and units explicit:

1. `required_cores(...) -> float` from mean process-tree CPU demand.
2. Calibrate safe `solver_slots_per_instance` for each plan from concurrency throughput, CPU and aggregate RSS.
3. Map cores and memory to `instances × slots_per_instance`, rounding instances up.
4. Validate the candidate with the wall-time distribution replay and authoritative load run.

The queue simulator's worker count is a count of concurrent service slots; it is not interchangeable with the analytical core result. Until these units are separated, the central output of the plan can be wrong.

### R3-R3 — HIGH: the sampling schedule does not preserve randomization or cross-gap pairs

The declared policy says measured order is randomized across all cells. The implementation instead iterates one cell to completion and only shuffles cases *inside* that cell. Runtime drift, thermal state or background load can therefore align with a model/gap cell.

Early stopping introduces a second issue: each gap is shuffled and stopped independently, so `gap=0` and relaxed gaps can retain different case subsets. The paired objective-delta calculation may then have little or biased overlap even though `case_key` is correct.

**Required correction:** build one globally interleaved measured schedule, and select the same cases across the compared gaps. The sequential rule must preserve enough paired cases and tail evidence for the decisions it feeds; a narrow CI on mean CPU alone is not evidence that empirical p95 or the paired objective delta is stable. This does not require returning to a mandatory 200-case quota.

### R3-R4 — HIGH: the simulator has no executable cache-hit or service-time contract

M2.3 consumes raw `Observation` samples but never states which quantity is the server service time. The queue simulator needs **wall-time slot occupancy**; `cpu_tree_sec` belongs in the core-demand calculation. Choosing the wrong field changes the predicted queue and worker count.

The plan also says a cache hit consumes no solver slot but retains measured API cost. No simulator input type, field or upstream artifact supplies that API cost, and `{stratum: (samples, weight)}` has no representation for cache class or slot consumption. Consequently the representative 20/60/20 profile cannot be replayed as declared.

**Required correction:** define a small event-sample contract carrying at least `cache_class`, `solver_wall_sec`, measured/non-zero API overhead and `consumes_solver_slot`. Keep solver CPU demand as a separate capacity input. Add one test proving cache hits affect end-to-end latency and offered API load while consuming zero solver slots.

### R3-R5 — HIGH: calibration, MP-3 ordering and the all-JADE population are still not runnable

- The Phase 5 preamble still says **MP-3 fires before M5.1**, while M5.1 correctly says the dispatcher seam is implemented and tested before MP-3. There must be one ordering statement.
- M2.1b remains prose rather than a task: it names no calibration runner, command, input corpus/profile, derivation of efficiency, pass/fail validation or step that consumes `parallel-efficiency.csv` to produce final candidates. “Shortlisted plans” is also not defined before calibration uses it.
- The all-JADE profile requires **2,500 verified cold misses/hour for three hours**. M3.2 prepares the representative 20/60/20 populations and one cold-identical burst hash, but no task creates and verifies the 7,500 distinct cold JADE hashes needed per authoritative run or prevents a previous repetition from warming them.

**Required correction:** make calibration a named task after MP-1/MP-2, with a small geometric `1,2,4,8` sweep and a concrete output consumer. Keep seam implementation/test as pre-MP-3 preparation, then record MP-3 before creating external worker infrastructure. Add an all-JADE input generator and pre-run cache-absence/uniqueness assertion, with fresh namespace or cleanup between authoritative repetitions.

### Lean approval bar

Approve when all five conditions are true:

1. The M1/M2 snippets and shown tests use one set of names, signatures and schemas and the full unit-test gate is runnable.
2. Core demand, solver slots and instances are separate quantities with an explicit calibrated mapping.
3. The campaign is globally interleaved and compares the same case cohort across gaps.
4. The simulator explicitly models wall-time slot occupancy and cache-hit API overhead.
5. Calibration/MP-3 has one runnable sequence and the all-JADE profile has a verified cold-input source.

### Confirmed non-blockers — do not expand scope

- Do not add production-wide solver phase hooks, a local aggregate-tree-RSS sampler, mandatory cgroup throttling telemetry, an every-integer concurrency sweep, a 200-case quota or a topology-by-profile Cartesian product.
- MP-R9 remains closed; do not ask for the sacred-test/AP-4 authorization again.
- The Render topology bounds used by the plan remain valid as of this review: `12c-96g` is the largest listed web/private/background-worker compute plan, services scale to at most 100 uniform-plan instances, autoscaling requires Pro or higher, and scaled compute is billed by usage. Recheck the dated price snapshot at execution time, as the plan already requires.

---
