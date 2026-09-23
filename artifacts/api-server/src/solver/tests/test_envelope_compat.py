"""A8 (SCND Correctness) -- unit tests for _envelope_compat.py's
flatten_envelope(), the TEST-ONLY shim other standalone Python scripts under
this directory (e2e_accuracy.py, test_solve.py, etc.) use to flatten
solve.py's real envelope shape back to the pre-G2.1 flat shape for easier
assertions. This is NOT one of A8's real production result consumers
(routes/solveHistory.ts, routes/scenarios.ts's export paths) -- these tests
exist purely to prove the shim itself doesn't silently discard evidence,
per the task's own DoD.

No subprocess/CBC dependency -- pure dict-in/dict-out unit tests against
hand-built fixtures shaped exactly like solve.py's real `_envelope()`
output (see solve.py's own `_envelope` docstring for the authoritative
field list)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _envelope_compat import flatten_envelope  # noqa: E402


def _envelope(**overrides) -> dict:
    """A minimal, valid solve.py-shaped success envelope -- every field
    _envelope() in solve.py actually emits, with sane defaults a caller can
    override per test."""
    base = {
        "status": "optimal",
        "solutionStatus": "optimal",
        "terminationReason": "optimality_proven",
        "achievedGap": 0.0,
        "solverIncumbentObjective": 1000.0,
        "solverBestBound": 1000.0,
        "objective": 1000.0,
        "runTimeSec": 0.42,
        "quality": "Proven optimal",
        "edges": [{"fromId": "A", "toId": "B", "flow": 1, "distance": 2}],
        "metrics": {
            "utilizationByNode": [{"warehouseId": "A", "city": "X", "utilization": 50}],
            "bandCoverage": [{"band": 200, "percent": 100}],
            "weightedAvgDistance": 42.5,
        },
        "details": {
            "openWarehouseIds": ["A"],
            "assignments": [{"customerId": "B", "warehouseId": "A", "distanceMi": 2}],
        },
        "solverUsed": "CBC (PuLP)",
        "infeasibilityReason": None,
    }
    base.update(overrides)
    return base


def test_already_flat_dict_passes_through_unchanged():
    """A dict with no `edges` key (the pre-envelope subprocess-failure
    shape) is returned byte-identical -- flatten_envelope() never touches
    it."""
    flat = {"status": "error", "_err": "boom"}
    assert flatten_envelope(flat) is flat


def test_all_five_b2_evidence_fields_pass_through_verbatim():
    """solutionStatus/terminationReason/achievedGap/solverIncumbentObjective/
    solverBestBound -- the fields DEC-2026-09-21-01's corrected
    e2e_accuracy.py assertions read directly (see e2e_accuracy.py's
    _evidence_check) -- must survive flattening exactly."""
    env = _envelope(
        solutionStatus="feasible", terminationReason="gap_limit",
        achievedGap=0.03, solverIncumbentObjective=987.0, solverBestBound=958.0,
    )
    out = flatten_envelope(env)
    assert out["solutionStatus"] == "feasible"
    assert out["terminationReason"] == "gap_limit"
    assert out["achievedGap"] == 0.03
    assert out["solverIncumbentObjective"] == 987.0
    assert out["solverBestBound"] == 958.0


def test_quality_is_no_longer_silently_dropped():
    """A real pre-existing gap this task closes: `quality` is on every
    solve.py envelope but was never copied through before."""
    env = _envelope(quality="Feasible — stopped at gap limit")
    out = flatten_envelope(env)
    assert out["quality"] == "Feasible — stopped at gap limit"


def test_edges_metrics_details_are_consumed_not_duplicated_raw():
    """The three structural keys are folded into derived legacy fields
    (openWarehouseIds/assignments/weightedAvgDistanceMi/bandCoverage/
    utilization), never passed through raw under their own name -- the
    forward-compat passthrough loop explicitly excludes them."""
    out = flatten_envelope(_envelope())
    assert "edges" not in out
    assert "metrics" not in out
    assert "details" not in out
    assert out["openWarehouseIds"] == ["A"]
    assert out["assignments"] == [{"customerId": "B", "warehouseId": "A", "distanceMi": 2}]
    assert out["weightedAvgDistanceMi"] == 42.5
    assert out["bandCoverage"] == [{"band": 200, "percent": 100}]
    assert out["utilization"] == [{"warehouseId": "A", "city": "X", "utilization": 50}]


def test_a_future_unknown_top_level_evidence_field_survives_unrenamed():
    """The forward-compat guarantee this task adds: a hypothetical FUTURE
    top-level field solve.py's envelope might one day carry (e.g. a later
    §2.12 configuredGap/configuredTimeLimitSec pair) is not silently
    dropped just because this shim's hand-picked field list was never
    updated for it -- it survives under its own name."""
    env = _envelope(configuredGap=0.02, configuredTimeLimitSec=120)
    out = flatten_envelope(env)
    assert out["configuredGap"] == 0.02
    assert out["configuredTimeLimitSec"] == 120


def test_forward_compat_passthrough_never_overrides_an_explicit_rename():
    """The passthrough loop uses setdefault -- it must never clobber a key
    the curated block above already explicitly derived/renamed, even if
    that exact name were somehow also present at the top level of the raw
    envelope."""
    env = _envelope()
    env["weightedAvgDistanceMi"] = 999999  # would never really be top-level, but prove precedence
    out = flatten_envelope(env)
    # The curated derivation (from metrics.weightedAvgDistance) wins, not
    # the raw top-level value.
    assert out["weightedAvgDistanceMi"] == 42.5
