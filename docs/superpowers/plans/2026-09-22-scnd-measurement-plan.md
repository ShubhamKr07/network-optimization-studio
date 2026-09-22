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
- Produces: `load_manifest(path: str) -> Manifest`; `Manifest.cells() -> list[Cell]`; `Cell` with fields `model_id: str`, `regime: str`, `edit_family: str | None`, `gap: float`, `weight: float`, `inputs: dict`; `Manifest.weights_sum_to_one() -> bool`.

- [ ] **Step 1: Write the failing test**

```python
# test_corpus.py
import json, pytest
from benchmark.corpus import load_manifest, ManifestError

def test_cells_are_model_regime_editfamily_gap(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "version": 1,
        "strata": [
            {"model_id": "two-echelon-jade-us", "regime": "free_choice",
             "edit_family": "demand", "weight": 0.5,
             "inputs": {"modelType": "two_echelon_jade", "p": 3}},
            {"model_id": "p-median-us", "regime": "forced_open",
             "edit_family": None, "weight": 0.5,
             "inputs": {"modelType": "p_median", "p": 5}},
        ],
        "gaps": [0, 0.005],
    }))
    m = load_manifest(str(p))
    cells = m.cells()
    assert len(cells) == 4                      # 2 strata x 2 gaps
    assert {c.gap for c in cells} == {0, 0.005}
    assert m.weights_sum_to_one()

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
class Cell:
    model_id: str
    regime: str
    edit_family: str | None
    gap: float
    weight: float
    inputs: dict

    @property
    def key(self) -> str:
        return f"{self.model_id}|{self.regime}|{self.edit_family or '-'}|{self.gap}"

@dataclass(frozen=True)
class Manifest:
    version: int
    strata: list
    gaps: list

    def weights_sum_to_one(self) -> bool:
        return abs(sum(s["weight"] for s in self.strata) - 1.0) < 1e-9

    def cells(self) -> list:
        return [
            Cell(s["model_id"], s["regime"], s.get("edit_family"),
                 g, s["weight"], s.get("inputs", {}))
            for s in self.strata for g in self.gaps
        ]

def load_manifest(path: str) -> Manifest:
    raw = json.loads(open(path).read())
    m = Manifest(raw["version"], raw["strata"], raw["gaps"])
    if not m.weights_sum_to_one():
        raise ManifestError("stratum weights must sum to 1")
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
- Consumes: `Cell` from M1.1.
- Produces: `measure_once(cell: Cell, solve_fn=None) -> Observation`; `Observation` with `cell_key, wall_sec, cpu_sec, build_sec, solve_sec, peak_rss_bytes, objective, solution_status, termination_reason, ok, error`.

**Why fork per observation.** `resource.getrusage(RUSAGE_SELF).ru_maxrss` is a monotonic high-water mark for the process — after one large solve every later observation would report that same peak. Each observation therefore runs in a forked child and the parent reads `RUSAGE_CHILDREN` **deltas**. Also: `ru_maxrss` is **kilobytes on Linux, bytes on macOS**; normalise or the numbers are off by 1024×.

**Build-vs-solve split without touching production code.** `solve.py` already returns `runTimeSec` measured around the solve call. Derive `build_sec = wall_sec - solve_sec` rather than instrumenting `solve.py` — this plan changes no production solver file.

- [ ] **Step 1: Write the failing test**

```python
# test_measure.py
from benchmark.corpus import Cell
from benchmark.measure import measure_once, normalize_maxrss

def _fake_solve(inp):
    return {"runTimeSec": 0.25, "objective": 1234.0,
            "solutionStatus": "optimal", "terminationReason": "optimality_proven"}

def test_measure_once_splits_build_and_solve():
    cell = Cell("p-median-us", "forced_open", None, 0.0, 1.0, {"modelType": "p_median"})
    obs = measure_once(cell, solve_fn=_fake_solve)
    assert obs.ok is True
    assert obs.solve_sec == 0.25
    assert obs.build_sec == obs.wall_sec - 0.25
    assert obs.build_sec >= 0
    assert obs.peak_rss_bytes > 0
    assert obs.cell_key == cell.key

def test_measure_once_records_failure_without_raising():
    def boom(inp): raise RuntimeError("cbc exploded")
    cell = Cell("p-median-us", "forced_open", None, 0.0, 1.0, {})
    obs = measure_once(cell, solve_fn=boom)
    assert obs.ok is False
    assert "cbc exploded" in obs.error
    assert obs.objective is None

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
    wall_sec: float
    cpu_sec: float
    build_sec: float
    solve_sec: float
    peak_rss_bytes: int
    objective: float | None
    solution_status: str | None
    termination_reason: str | None
    ok: bool
    error: str | None = None

def normalize_maxrss(value: int, system: str | None = None) -> int:
    system = system or platform.system()
    return value * 1024 if system == "Linux" else value

def _default_solve(inp):
    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
    import solve as solve_mod
    return solve_mod.solve(inp)

def measure_once(cell, solve_fn=None) -> Observation:
    solve_fn = solve_fn or _default_solve
    before = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    out_path = tempfile.mktemp(suffix=".pkl")
    t0 = time.perf_counter()
    pid = os.fork()
    if pid == 0:
        rec = {}
        try:
            c0 = time.process_time()
            env = solve_fn({**cell.inputs, "gap": cell.gap})
            rec = {"ok": True, "cpu": time.process_time() - c0,
                   "solve": float(env.get("runTimeSec") or 0.0),
                   "objective": env.get("objective"),
                   "status": env.get("solutionStatus"),
                   "reason": env.get("terminationReason")}
        except Exception as e:
            rec = {"ok": False, "error": str(e)}
        with open(out_path, "wb") as f:
            pickle.dump(rec, f)
        os._exit(0)
    os.waitpid(pid, 0)
    wall = time.perf_counter() - t0
    after = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    peak = normalize_maxrss(max(after - before, after))
    with open(out_path, "rb") as f:
        rec = pickle.load(f)
    os.unlink(out_path)
    if not rec.get("ok"):
        return Observation(cell.key, wall, 0.0, 0.0, 0.0, peak,
                           None, None, None, False, rec.get("error"))
    return Observation(cell.key, wall, rec["cpu"], wall - rec["solve"],
                       rec["solve"], peak, rec["objective"],
                       rec["status"], rec["reason"], True)
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
- Consumes: `Manifest`, `Cell` (M1.1); `measure_once`, `Observation` (M1.2).
- Produces: `run_campaign(manifest, n_per_cell=200, warmup=3, seed=0, measure=measure_once) -> list[Observation]`; `run_determinism(cell, reps=30, measure=...) -> list[Observation]` — rows tagged `kind="determinism"` and **excluded from frequency and sizing aggregates**.

**Declared design (M-R4):** fixed **n = 200 independent observations per cell**; **3 warm-up observations per cell, discarded**; **randomized run order across all cells** with a recorded seed; **determinism runs are a separate campaign** and never counted as independent evidence of regime frequency.

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

def run_campaign(manifest, n_per_cell=200, warmup=3, seed=0, measure=measure_once):
    rng = random.Random(seed)
    schedule = []
    for cell in manifest.cells():
        for i in range(warmup + n_per_cell):
            schedule.append((cell, i < warmup))
    rng.shuffle(schedule)
    kept = []
    for cell, is_warmup in schedule:
        obs = measure(cell)
        if not is_warmup:
            obs.kind = "campaign"
            kept.append(obs)
    return kept

def run_determinism(cell, reps=30, measure=measure_once):
    rows = []
    for _ in range(reps):
        obs = measure(cell)
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
- Consumes: `Observation` (M1.2).
- Produces: `percentile(xs, q) -> float`; `bootstrap_ci(xs, stat, reps=2000, alpha=0.05, seed=0) -> tuple[float, float]`; `aggregate(observations) -> dict[str, CellStats]`; `CellStats` with `n, mean_cpu_sec, p50_wall, p95_wall, p95_ci_low, p95_ci_high, mean_peak_rss, failure_rate`; `corpus_frequency(observations, manifest) -> dict[str, float]` — **labelled corpus frequency, never prevalence.**

- [ ] **Step 1: Write the failing test**

```python
# test_stats.py
from benchmark.measure import Observation
from benchmark.stats import percentile, bootstrap_ci, aggregate

def _obs(key, wall, cpu, ok=True, kind="campaign"):
    return Observation(key, wall, cpu, 0.1, wall - 0.1, 1000, 1.0,
                       "optimal", "optimality_proven", ok, None, kind)

def test_percentile_linear_interpolation():
    assert percentile([1, 2, 3, 4], 0.5) == 2.5
    assert percentile([1], 0.95) == 1

def test_bootstrap_ci_brackets_the_point_estimate():
    xs = [1.0] * 50 + [9.0] * 50
    lo, hi = bootstrap_ci(xs, lambda s: percentile(s, 0.95), reps=500, seed=3)
    assert lo <= percentile(xs, 0.95) <= hi

def test_aggregate_excludes_determinism_rows():
    rows = [_obs("k", 1.0, 0.5) for _ in range(10)]
    rows += [_obs("k", 99.0, 99.0, kind="determinism") for _ in range(10)]
    stats = aggregate(rows)
    assert stats["k"].n == 10
    assert stats["k"].p95_wall < 2.0          # determinism outliers not included

def test_aggregate_reports_failure_rate():
    rows = [_obs("k", 1.0, 0.5) for _ in range(9)] + [_obs("k", 0.0, 0.0, ok=False)]
    assert aggregate(rows)["k"].failure_rate == 0.1
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
    n: int
    mean_cpu_sec: float
    p50_wall: float
    p95_wall: float
    p95_ci_low: float
    p95_ci_high: float
    mean_peak_rss: float
    failure_rate: float

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
        walls = [r.wall_sec for r in ok]
        lo, hi = bootstrap_ci(walls, lambda s: percentile(s, 0.95)) if len(walls) > 1 else (walls[0], walls[0])
        out[key] = CellStats(
            n=len(rows),
            mean_cpu_sec=sum(r.cpu_sec for r in ok) / len(ok) if ok else 0.0,
            p50_wall=percentile(walls, 0.5),
            p95_wall=percentile(walls, 0.95),
            p95_ci_low=lo, p95_ci_high=hi,
            mean_peak_rss=sum(r.peak_rss_bytes for r in ok) / len(ok) if ok else 0.0,
            failure_rate=1 - len(ok) / len(rows),
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

**Raw columns:** `run_id,timestamp,cell_key,model_id,regime,edit_family,gap,kind,wall_sec,cpu_sec,build_sec,solve_sec,peak_rss_bytes,objective,solution_status,termination_reason,ok,error`
**Aggregate columns:** `run_id,cell_key,model_id,regime,edit_family,gap,corpus_weight,n,mean_cpu_sec,p50_wall,p95_wall,p95_ci_low,p95_ci_high,mean_peak_rss,failure_rate,corpus_frequency`

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
def weighted_mean_service_demand(stats, manifest):
    total = 0.0
    for cell in manifest.cells():
        cs = stats.get(cell.key)
        if cs is None:
            continue
        total += cell.weight * cs.mean_cpu_sec / len(manifest.gaps)
    return total

def required_cores(demand_sec, arrival_rate_per_sec, parallel_efficiency, headroom):
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
- Consumes: raw `Observation` wall/CPU samples (M1.2), `open_loop_trace` (M2.2).
- Produces: `simulate(trace, service_samples, workers, seed) -> SimResult` with `p50_wait, p95_wait, p95_end_to_end, max_queue_depth, utilization`; `candidate_worker_counts(trace, service_samples, slo_p95_sec, max_workers=24) -> list[tuple[int, SimResult]]`.

**Design:** discrete-event, *n* servers, FIFO. Service times are **sampled from the empirical distribution** (M1's raw rows), never from a fitted mean — that is the whole point of M-R8's "replay the full measured distribution".

- [ ] **Step 1: Write the failing test**

```python
# test_simulate.py
from benchmark.simulate import simulate, candidate_worker_counts

def test_single_server_queue_grows_when_overloaded():
    trace = [i * 1.0 for i in range(100)]      # 1 job/s
    r = simulate(trace, service_samples=[2.0], workers=1, seed=0)   # 2 s each
    assert r.p95_wait > 50                      # unstable, queue grows without bound
    assert r.utilization > 0.99

def test_enough_servers_keeps_wait_near_zero():
    trace = [i * 1.0 for i in range(100)]
    r = simulate(trace, service_samples=[2.0], workers=4, seed=0)
    assert r.p95_wait < 1.0

def test_candidate_worker_counts_returns_smallest_meeting_slo():
    trace = [i * 1.0 for i in range(200)]
    cands = candidate_worker_counts(trace, [2.0], slo_p95_sec=1.0, max_workers=8)
    assert cands[0][0] == 3                     # smallest n with p95 end-to-end under SLO
```

- [ ] **Step 2: Run it** → FAIL.
- [ ] **Step 3: Implement** a heap-based event loop: push arrivals, maintain `workers` free-at timestamps, service time drawn via `rng.choice(service_samples)`; record wait and end-to-end per job.
- [ ] **Step 4: Run it** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "[M2.3] queue simulator: empirical-distribution replay to candidate worker counts"`

---

## Phase 3 — Load harness (needs the isolated environment)

> **MP-2 fires before this phase.** Ask: *"Measurement needs an isolated Render environment — separate database, separate cache namespace, synthetic identities, analytics/alerts disabled, named teardown owner, dated cost snapshot. Approve provisioning and its teardown plan?"* Do not provision anything first.

### Task M3.1: Isolated environment + cohort provisioning

**Files:**
- Create: `scripts/measurement/provision-env.sh`
- Create: `scripts/measurement/seed-cohort.mjs`
- Create: `docs/ops/measurement-environment.md` (pinned config + teardown runbook)

- [ ] **Step 1.** Record the pinned set in `docs/ops/measurement-environment.md` **before** provisioning: application SHA, dataset version, region, exact compute plan IDs, instance count, environment variables, database plan, load-generator location/capacity, **named teardown owner**, and the dated price snapshot.
- [ ] **Step 2.** `provision-env.sh` creates the isolated service + database. Analytics disabled via `POSTHOG_API_KEY` unset and `SENTRY_DSN` unset — assert both are absent after boot rather than assuming.
- [ ] **Step 3.** `seed-cohort.mjs` registers **50 distinct synthetic users** through `POST /auth/register` (never one shared account — auth/session cost is part of the load) and stores their session cookies. Assert 50 distinct `user_id`s exist.
- [ ] **Step 4.** Verify isolation with a negative test: the isolated DB contains **zero** rows whose `user_id` matches any production identity.
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

### Task M3.3: Open-loop driver

**Files:** Create `scripts/measurement/load-driver.mjs`

- [ ] **Step 1.** Consume a trace from M2.2 (as JSON) and submit **on schedule, independent of response time** — a fixed timer wheel, never `await` before the next submission. This is the M-R3 requirement; a closed-loop driver invalidates the run.
- [ ] **Step 2.** Poll each job at the real **800 ms** cadence.
- [ ] **Step 3.** Record per submission: intended offset, actual offset, enqueue latency, queue-wait, end-to-end, terminal status, HTTP status.
- [ ] **Step 4.** Retry/429 accounting, declared before the run: a `429` is recorded as **rejected**, is **not** retried, and **counts in offered load but not in successful accounting**.
- [ ] **Step 5.** Emit `intended_rate` and `achieved_rate`; **fail the run** if achieved < 99% of intended — a shortfall invalidates rather than passes.
- [ ] **Step 6. Commit** — `git commit -m "[M3.3] open-loop load driver with intended-vs-achieved rate enforcement"`

### Task M3.4: Telemetry collection, restart probe, soak

**Files:** Create `scripts/measurement/collect-telemetry.mjs`, `docs/superpowers/metrics/load-run.csv`

- [ ] **Step 1.** Collect the full M-R6 set: enqueue latency, queue-wait, end-to-end p50/p95, 429 rate, failure rate, CPU/RSS/OOM, max in-memory queue depth + admissions-past-limit, **event-loop lag, CPU throttling, active Python/CBC process count, pool checked-out/waiting, query latency, lock waits, DB CPU/memory/storage growth, network errors, instance restarts, load-generator saturation**.
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

> **MP-3 fires before M5.1.** Ask: *"The worker prototype consumes A's durable queue: \<named image/command, queue seam, plan IDs, provisioning owner, teardown procedure\>. Authorize it as disposable, non-production scaffolding?"*
> **MP-1 fires before M5.2.** The SLO gate must be ratified **before** the authoritative run, never after seeing results.

### Task M5.1: Disposable worker prototype
- [ ] Build a worker consuming A's durable `solve_jobs` queue via A2's claim protocol. Named image/command, plan IDs, provisioning owner, teardown procedure — all recorded before creation.
- [ ] **Not committed as production infra.** `render.yaml` is unchanged; the prototype is created and torn down out-of-band.

### Task M5.2: Topology runs
- [ ] Run the same corpus + burst against: high-core vertical (≤ **12 CPU**, `12c-96g` ceiling), one dedicated worker, horizontal fleet (≤ **100 instances**, uniform plan).
- [ ] **Never validate autoscaling in a preview environment** — previews run at the autoscaling minimum. Manual fixed-instance comparisons in previews are valid when explicitly configured.
- [ ] Compare on end-to-end SLO, safe CPU/RSS headroom, restart behaviour, scale-window billing, idle cost, operational complexity.

### Task M5.3: Cost model
- [ ] Report **both** denominators: cost per successful **submitted job** (cache hits in — budgeting) and per successful **CBC execution** (cache hits out — topology comparison). Marginal burst-worker cost and cache-hit mix beside both. Rejected/failed/timed-out in neither.
- [ ] Dated all-in model: workspace fee, always-on API, idle/base worker, burst workers, Postgres, scheduler, storage/backups, bandwidth, and the measurement infrastructure itself. Sensitivity to **cache-hit rate** and **free-choice frequency** (the M-R9 input knob).

### Task M5.4: Gate verdicts and decision document
- [ ] **Capacity gate:** does the measured topology meet the ratified latency, rejection, headroom and cost limits?
- [ ] **Reliability/isolation gate:** durability, restart recovery, process containment, API availability, safe ownership.
- [ ] The final report records: **intended vs achieved arrival rate**, raw rows, uncertainty, bottleneck evidence, per-gate verdicts, selected topology + worker count, capacity calculation, distribution/trace input, predicted queue behaviour, observed confirmation, and the dated cost model.
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

**Type consistency:** `Cell.key` (M1.1) is the join key through `Observation.cell_key` (M1.2), `aggregate()`'s dict keys (M1.4), and `weighted_mean_service_demand`'s lookup (M2.1). `Observation.kind` is added in M1.3 and consumed in M1.4 and M1.5.

---

## Review — approval validation (2026-09-23)

**Verdict: REQUEST CHANGES — not approved for execution.** The three-layer architecture is sound: local microbenchmark → pure capacity analysis → isolated HTTP validation is the right separation, and keeping raw evidence independent of later analysis is particularly good. The plan also correctly preserves the design's open-loop requirement, two cost denominators, isolated-environment rule, and separation of p95 SLO validation from mean-service-demand sizing. The current Render facts used by M5.2 remain valid as of this review: service plans top out at 12 CPU, a service can scale to 100 uniform-plan instances, autoscaling requires Pro or higher, scaled compute is prorated by the second, and a preview environment uses the autoscaling minimum rather than exercising the policy.

The findings below are approval-blocking because the current tasks would either produce non-independent evidence, under-measure CBC resource demand, mis-size capacity, or run the authoritative experiment before its gate is fixed. They require targeted corrections, not an architectural rewrite.

### MP-R1 — CRITICAL: the campaign's 200 observations are repeated executions of one input, not independent observations

M1.1 gives each `Cell` one `inputs: dict`. M1.3 then schedules that same cell `warmup + n_per_cell` times. Therefore the nominal 200 campaign rows quantify runtime variation for one scenario — the exact evidence the spec classifies as a determinism run — rather than variation across 200 independent scenario inputs in the sizing cell. Labelling those repetitions `kind="campaign"` does not make them independent.

The warm-up implementation has a second ordering defect: warm-up and measured entries are added to one schedule and then shuffled together, so a row marked as warm-up can execute after measured observations. That is not a warm-up policy.

**Required correction:**

- Change a stratum/cell to reference a declared set of distinct corpus cases or a deterministic case generator, with a stable `case_id` and generator seed recorded in every raw row.
- Require at least 200 distinct case observations per sizing cell, or implement the spec's predeclared sequential stopping rule. Do not count repeated trials of one case toward this total.
- Keep repeated executions of a fixed `case_id` only in `run_determinism()`.
- Execute and discard warm-ups before randomizing the measured schedule. State whether warm-up is per model/cell, per process image, or global.
- Add tests proving campaign case IDs are distinct, determinism case IDs are identical, and no measured observation precedes its required warm-up.

### MP-R2 — CRITICAL: the measurement primitive excludes CBC CPU and cannot produce per-observation RSS

`time.process_time()` in the forked Python child measures CPU consumed by that Python process. PuLP launches CBC as an external subprocess, so the dominant solver CPU is excluded from `cpu_sec`; the mean CPU service demand used by M2.1 would consequently be too small.

`RUSAGE_CHILDREN.ru_maxrss` in the parent is a historical maximum, not a cumulative counter that can be differenced. After a large child has run, later observations can inherit its high-water mark. The proposed `max(after - before, after)` always effectively selects `after` for non-negative values, so it does not repair this. It also does not measure the simultaneous aggregate RSS of the Python+CBC process tree.

Finally, `build_sec = wall_sec - runTimeSec` is not the required build-versus-`prob.solve()` split. Production `runTimeSec` is rounded to two decimals, while `wall_sec` also includes fork, import, temporary-file, pickle and IPC overhead; the subtraction can be imprecise, negative for very short solves, and materially misleading for the approximately one-second models.

**Required correction:**

- Measure CPU for the complete Python+CBC process tree, including user and system time. The child can report process-tree resource data, or the harness can use an explicit process/cgroup monitor; Python `process_time()` alone is insufficient.
- Measure per-process-tree peak RSS and, separately during load tests, aggregate instance RSS. Do not subtract `ru_maxrss` high-water marks.
- Add a benchmark-only timing seam that records unrounded monotonic timestamps immediately around model construction and CBC execution. It may be an optional callback/adapter, but it must not alter solver mathematics.
- Record harness/bootstrap overhead separately instead of naming it build time.
- Cover a CBC-spawning test double or controlled real smoke fixture that proves child CPU and memory are captured, while keeping the default unit-test gate free of full real solves.

### MP-R3 — CRITICAL: the capacity model averages configuration alternatives and replays an unweighted workload

`weighted_mean_service_demand()` iterates every gap cell and divides by `len(manifest.gaps)`. That treats `gap ∈ {0, 0.005, 0.01, 0.02}` as an equal-probability production mix. Gap is an experimental/configuration alternative, not a workload-frequency dimension. Averaging faster relaxed-gap runs into the mandatory `gap=0` baseline can understate required capacity. The function also silently skips a missing cell, reducing the estimate instead of invalidating it.

M2.3 accepts one flat `service_samples` list and draws with `rng.choice`. A flat sample loses the declared model/regime/edit-family weights, cache class, gap, and case identity. If the stratified corpus contains equal counts per cell, uniform replay silently substitutes equal population weights for the declared sensitivity mix.

The proposed M2.3 acceptance test is impossible as written: when every service time is two seconds, no worker count can produce end-to-end p95 below a one-second SLO. The test expects three workers to do so.

The formula also accepts `parallel_efficiency` as an unexplained caller value, although the design explicitly requires measured per-solve CPU utilization and parallel efficiency. Local CPU seconds are not directly transferable to a different Render plan or architecture without target-plan calibration.

**Required correction:**

- Compute capacity separately per gap; `gap=0` is the mandatory baseline. Present relaxed gaps as explicit alternatives with their objective-quality effects, never as an averaged workload.
- Fail closed when any required sizing cell is absent, has insufficient independent observations, or has unusable resource data.
- Replay tagged events drawn from declared workload-profile weights, then draw service time from the matching cell's empirical distribution. Cache hits must bypass CBC service while retaining their measured API cost.
- Add a controlled concurrency sweep on each candidate target plan to measure CPU utilization, wall-time degradation, RSS and parallel efficiency at 1…N concurrent solves. Store the derived efficiency with the plan ID and application SHA.
- Correct the impossible test by either validating queue-wait p95 below one second or choosing an end-to-end SLO greater than the two-second service time. Define whether `candidate_worker_counts()` returns all candidates or only passing candidates.
- Remove the arbitrary `max_workers=24` ceiling or derive the explored range from the candidate topology and Render's 100-instance service limit.

### MP-R4 — HIGH: the statistical outputs do not satisfy the spec's uncertainty and objective-quality contract

M1.4 calculates a confidence interval only for p95. The design requires raw rows plus uncertainty for p50, p95, mean service demand, slow-regime frequency, failure/rejection rates, RSS and objective delta. `CellStats` has no objective-delta field, no uncertainty for the other estimates, and no success count. The plan declares `corpus_frequency()` as an interface but the proposed implementation does not define it or test it. It also never declares the required outlier policy.

The gap experiment cannot be approved without objective deltas relative to the same case at `gap=0`; otherwise a faster relaxed solve has no paired quality evidence. An all-failure cell also causes the proposed aggregation branch to index `walls[0]` and crash rather than emitting an explicit unusable-cell result.

**Required correction:**

- Add the complete predeclared summary schema and uncertainty method for every metric required by the design.
- Compute paired objective deltas by `case_id` against that case's `gap=0` result, with an explicit rule for infeasible/no-incumbent/failed outcomes.
- Implement and test `corpus_frequency()` while labelling it generator/corpus frequency, never student prevalence.
- Declare the outlier policy before measurements. Preserve raw rows; do not silently delete tail observations.
- Represent zero-success and insufficient-sample cells explicitly and make them fail sizing rather than returning zero demand or crashing.

### MP-R5 — HIGH: the authoritative workload matrix and per-user behavior are incomplete

M3.2 prepares cache populations, but M3.3 consumes only an arrival trace; no task binds each scheduled event to the audited 20/60/20 population manifest. The driver also does not define how events are assigned across the 50 authenticated students, whether one student can have multiple jobs outstanding, or the required UI-faithful one-at-a-time profile.

The plan omits the declared warm-up and measurement windows, repetition count, and pass rule across repetitions. It prepares a cold-identical set but never explicitly schedules its separate 50-request run. It also omits the sustained all-JADE, 2,500 cold-miss/hour profile required to validate the guarantee. Registering 50 accounts is insufficient by itself: the current API solves an existing persisted scenario, so cohort provisioning must also create and save the scenario/input fixtures and retain their IDs for submission.

**Required correction:**

- Define a versioned run-manifest schema covering profile ID, seed, users, case/cache-class assignment, intended offsets, outstanding-job policy, warm-up, measurement window, duration and repetition number.
- Implement at least these separate profiles: representative 20/60/20 sustained load; UI-faithful one-in-flight sustained load; 50-request synchronized cold-identical burst; and sustained all-JADE 2,500 verified cold misses/hour.
- State how the aggregate trace is distributed across exactly 50 users and verify each user receives the intended rate/share.
- Seed valid per-user scenarios and saved inputs through the real `/api` contracts; record scenario IDs without committing cookies or credentials. Store session material only in ignored, permission-restricted temporary storage.
- Apply the MP-1 aggregation and repetition pass rule to the results; one exploratory run cannot become the authoritative verdict retroactively.

### MP-R6 — HIGH: MP-1 fires after M3.4 already performs the authoritative run

M3.4 instructs execution of the restart probe, three-hour sustained soak and separate burst. MP-1 is placed later, immediately before M5.2. That permits the main load evidence to be observed before the SLO thresholds, aggregation rules, headroom limits and repetition pass rule are ratified — exactly the post-hoc gate movement M-R5 prohibited.

**Required correction:** separate harness implementation from experiment execution. Code, unit tests, environment provisioning and exploratory shakedowns may precede MP-1 if clearly labelled non-authoritative and excluded from the decision dataset. The ratified MP-1 artifact must exist before the first authoritative representative, all-JADE, burst, restart or topology run. Record the answer, date and decider before execution.

### MP-R7 — HIGH: the telemetry collector has no source for several metrics needed to identify the bottleneck

M3.4 names event-loop lag, CPU throttling, active Python/CBC process count, pool checked-out/waiting counts, internal queue depth, admissions-past-limit and load-generator saturation, but lists only a new external `collect-telemetry.mjs`. Those process-internal values are not currently exposed by the API or Render metrics. A collector cannot reconstruct them after the fact, and the global `unknown` rule would leave the promised exact-bottleneck conclusion unsupported.

**Required correction:**

- Add an observability source map: for every metric, name the emitting component, query/log/endpoint, unit, sampling cadence, clock, labels, retention and join key/run ID.
- Add the required default-off, isolated-environment-only application instrumentation for event-loop, pool, queue/admission and process-tree metrics, with tests that production secrets and user payloads are never emitted.
- Define the Render metric/export source for instance CPU, memory, throttling, OOM and restarts, and the Postgres source for CPU/memory/connections/query latency/locks/storage.
- Time-synchronize the load generator, application and database evidence sufficiently to correlate a latency interval with its resource condition.
- Make missing mandatory telemetry invalidate a bottleneck verdict rather than silently writing `unknown` and continuing.

### MP-R8 — HIGH: the dedicated-worker and fleet comparisons are contaminated by A's API dispatcher

Option A deliberately ships a recurring dispatcher in the API. M5.1 adds another consumer of the same durable `solve_jobs` queue but defines no way to stop API instances from claiming jobs. In the dedicated-worker and horizontal-fleet candidates, the API and prototype can therefore race for the same queue; some solves will run on API compute, contaminating throughput, resource and cost attribution.

**Required correction:**

- Add a default-preserving execution-mode seam: for dedicated-worker/fleet measurements the API is enqueue/poll-only and cannot claim, while the named worker command is the sole claimant. The vertical tune-in-place comparator keeps API dispatch enabled.
- Make the mode fail closed and observable at startup. The run manifest must record it, and a pre-run assertion must prove API active-solver count remains zero for worker-only candidates.
- Include the exact image SHA, command, queue namespace, plan IDs, dispatcher-mode configuration, owner and teardown/restoration steps in the MP-3 request before asking for authorization.
- Prove every topology uses an isolated queue/database and that no candidate overlaps another candidate's jobs.

### MP-R9 — BLOCKING PREREQUISITE: the approval/audit artifact required by the plan is absent

P4 and the parent spec require checkpoint answers and preflight verification to be recorded in `docs/CHANGELOG-implementation.md`, with approval answers carrying a date and decider. That file does not exist in this worktree. The A plan asserts that AP-4 was granted, but the designated independent record is still absent.

This does **not** require asking AP-4 again if the product owner actually made the recorded choice. It requires creating/restoring the canonical audit artifact and recording the real decision, date and decider there. If no explicit decision can be evidenced, AP-4 must return to pending. The A plan or this plan cannot act as both the approval request and the independent evidence that it was approved.

Every MP-1…MP-4 task must include an explicit post-answer step that writes the exact scoped answer, UTC timestamp, decider and referenced artifact/run IDs to the same canonical record before proceeding.

### Additional execution recommendations

- M3.1's isolation proof should verify distinct Render environment/service/database identifiers and perform a sentinel write/read confined to the measurement database. Do not fetch or copy production user identities merely to prove no IDs overlap.
- The manifest loader should validate version, allowed model/regime/edit-family values, finite non-negative weights, allowed gaps, unique cell/case keys, required input fields and exact coverage. A weights-only check is insufficient for an authoritative corpus.
- `tempfile.mktemp()` should not be used. Use a safely created private temporary directory/file, handle child exit and missing/corrupt output explicitly, and always clean up in `finally`.
- The MIP-start and persistent-worker experiments need the same case IDs, raw-row schema, repetitions and objective-validity rules as the main benchmark so their decision records are comparable rather than anecdotal.
- M5.4 must name the evidence artifact for both the representative profile and the guaranteed all-JADE cold-miss profile. A topology cannot pass on one and inherit the other by inference.

### Approval exit criteria

This plan becomes approval-ready when MP-R1…MP-R8 are folded into executable tasks and tests, and MP-R9's canonical approval record exists. The next review should verify the corrected contracts rather than reopen the already-settled architecture, Render platform limits, two cost denominators, or p95-versus-mean sizing decision.
