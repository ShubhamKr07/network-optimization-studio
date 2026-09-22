"""Tests for cbc_termination.py (P0R.1 go/no-go spike).

Two families:
  1. TestClassifyFromFixtures -- deterministic, fixture-only, NO live
     solving (P0R.2's requirement: "no live solving in the unit tests").
     Maps each committed fixture under fixtures/cbc/ to its expected
     (solutionStatus, terminationReason) + evidence metadata.
  2. TestSolveWithCaptureConcurrencyGoNoGo -- the actual go/no-go
     acceptance bar from the spike task brief: real CBC solves proving
     concurrency-safety, cleanup (success / parser-error / simulated
     timeout / simulated kill), path-traversal-safety, and no repo-tree
     artifacts. These DO invoke real CBC (small/fast models only).

Malformed/contradictory synthetic fixtures (category 2 of P0R.2's four
fixture categories) live inline in TestClassifyMalformed -- hand-authored,
not captured from a real solve, since their entire point is to exercise the
parser's error handling on evidence CBC would never actually produce.
"""
import os
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from cbc_termination import (  # noqa: E402
    CBCParseError,
    classify_cbc_termination,
    parse_cbc_termination,
    solve_with_capture,
    _assert_outside_repo,
    _REPO_ROOT,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "cbc"


def _read_fixture(name: str):
    log_text = (FIXTURES_DIR / f"{name}.log").read_text()
    sol_path = FIXTURES_DIR / f"{name}.sol"
    sol_text = sol_path.read_text() if sol_path.exists() else None
    return log_text, sol_text


# ---------------------------------------------------------------------------
# 1. Fixture-based classification (no live solving)
# ---------------------------------------------------------------------------

FIXTURE_EXPECTATIONS = [
    # name, solutionStatus, terminationReason, expect_objective_not_none,
    # expect_bound_not_none
    ("optimal_optimality_proven", "optimal", "optimality_proven", True, False),
    # B2: a pure-LP solve (zero integer/binary variables -- e.g.
    # transport-coal with singleSource=False) never prints a "Result -"
    # trailer at all; CBC's Clp layer reports "Optimal - objective value X"
    # directly. See _LP_ONLY_OPTIMAL_RE's docstring in cbc_termination.py.
    ("optimal_lp_only", "optimal", "optimality_proven", True, False),
    ("feasible_gap_limit", "feasible", "gap_limit", True, True),
    ("infeasible", "infeasible", "infeasible", False, False),
    ("infeasible_lp_relaxation", "infeasible", "infeasible", False, False),
    # B2: a real MIP whose LP relaxation is feasible but whose full
    # branch-and-bound search proves no integer-feasible solution exists --
    # .sol first token is "Integer", not "Infeasible" (PuLP's own
    # COIN_CMD.get_status() already treats them identically). Found via a
    # real transport-coal single-source solve.
    ("infeasible_integer", "infeasible", "infeasible", False, False),
    ("no_solution_time_limit", "no_solution", "time_limit", False, True),
    ("feasible_time_limit", "feasible", "time_limit", True, True),
    ("feasible_node_limit", "feasible", "node_limit", True, True),
    ("no_solution_node_limit", "no_solution", "node_limit", False, True),
    ("unbounded", "unbounded", "unbounded", False, False),
]


class TestClassifyFromFixtures:
    @pytest.mark.parametrize(
        "name,expected_status,expected_reason,expect_obj,expect_bound",
        FIXTURE_EXPECTATIONS,
    )
    def test_fixture_classification(self, name, expected_status, expected_reason,
                                     expect_obj, expect_bound):
        log_text, sol_text = _read_fixture(name)
        status, reason, evidence = classify_cbc_termination(log_text, sol_text)
        assert status == expected_status
        assert reason == expected_reason
        assert (evidence["solverIncumbentObjective"] is not None) == expect_obj
        assert (evidence["solverBestBound"] is not None) == expect_bound
        if not expect_obj or not expect_bound:
            assert evidence["achievedGap"] is None
        else:
            assert evidence["achievedGap"] is not None
            assert evidence["achievedGap"] >= 0

    def test_fixtures_readable_via_real_paths(self):
        # parse_cbc_termination's documented signature is path-based --
        # exercise that entry point too, not just the text-based helper.
        for name, expected_status, expected_reason, _, _ in FIXTURE_EXPECTATIONS:
            log_path = FIXTURES_DIR / f"{name}.log"
            sol_path = FIXTURES_DIR / f"{name}.sol"
            status, reason, _evidence = parse_cbc_termination(str(log_path), str(sol_path))
            assert status == expected_status
            assert reason == expected_reason

    def test_gap_limit_achieved_gap_matches_hand_computation(self):
        # feasible_gap_limit: incumbent=27022899653.80000687,
        # bound=26971509401.152 (real committed fixture values).
        log_text, sol_text = _read_fixture("feasible_gap_limit")
        _status, _reason, evidence = classify_cbc_termination(log_text, sol_text)
        inc = evidence["solverIncumbentObjective"]
        bound = evidence["solverBestBound"]
        expected = round(abs(inc - bound) / max(abs(inc), 1e-10), 6)
        assert evidence["achievedGap"] == expected
        assert 0 < evidence["achievedGap"] < 0.05  # real gap tighter than the requested 5%

    def test_no_solution_never_reports_lp_relaxation_as_incumbent(self):
        # The core false-proof-adjacent bug this module exists to avoid:
        # the .sol "objective value" on a no-incumbent stop is CBC's LP
        # relaxation fallback, not a real incumbent -- must never surface
        # as solverIncumbentObjective.
        for name in ("no_solution_time_limit", "no_solution_node_limit"):
            log_text, sol_text = _read_fixture(name)
            assert "(no integer solution" in sol_text
            _status, _reason, evidence = classify_cbc_termination(log_text, sol_text)
            assert evidence["solverIncumbentObjective"] is None
            assert evidence["achievedGap"] is None
            # the bound is still real evidence and should be preserved
            assert evidence["solverBestBound"] is not None

    def test_proven_optimal_does_not_synthesize_a_bound(self):
        log_text, sol_text = _read_fixture("optimal_optimality_proven")
        _status, _reason, evidence = classify_cbc_termination(log_text, sol_text)
        # CBC prints no separate bound line for a clean proof -- must stay
        # null, not silently set to == incumbent.
        assert evidence["solverBestBound"] is None
        assert evidence["achievedGap"] is None

    def test_sol_file_alone_cannot_distinguish_time_vs_node_limit(self):
        # Direct proof of the module's central evidentiary claim: the two
        # fixtures' .sol first lines share the exact same "Stopped on
        # iterations"/"Stopped on time" family shape and neither literally
        # says "node" or "time" in a way that would let a .sol-only parser
        # (like PuLP's own get_status()) tell them apart -- only the LOG's
        # "Result -" line does.
        _log_time, sol_time = _read_fixture("no_solution_time_limit")
        _log_node, sol_node = _read_fixture("no_solution_node_limit")
        assert "time" in sol_time.splitlines()[0].lower()
        assert "iterations" in sol_node.splitlines()[0].lower()
        assert "node" not in sol_node.splitlines()[0].lower()
        assert "node" not in sol_time.splitlines()[0].lower()


# ---------------------------------------------------------------------------
# 2. Synthetic malformed/contradictory fixtures (parser error handling)
# ---------------------------------------------------------------------------

class TestClassifyMalformed:
    def test_empty_log_raises(self):
        with pytest.raises(CBCParseError):
            classify_cbc_termination("", None)

    def test_whitespace_only_log_raises(self):
        with pytest.raises(CBCParseError):
            classify_cbc_termination("   \n\n  ", None)

    def test_no_result_line_no_infeasible_no_unbounded_raises(self):
        garbled = "Welcome to the CBC MILP Solver\nSomething went wrong\n"
        with pytest.raises(CBCParseError):
            classify_cbc_termination(garbled, None)

    def test_unrecognized_result_message_raises(self):
        log = "Result - Something CBC never actually prints\n"
        with pytest.raises(CBCParseError):
            classify_cbc_termination(log, None)

    def test_contradictory_infeasible_log_vs_optimal_sol_raises(self):
        log = "Problem is infeasible - 0.01 seconds\n"
        sol = "Optimal - objective value 123.0\n"
        with pytest.raises(CBCParseError):
            classify_cbc_termination(log, sol)

    def test_contradictory_unbounded_sol_vs_optimal_log_raises(self):
        # §34.2.10: .sol says Unbounded but the log proved an optimum -> the
        # sources disagree, so this is contradictory evidence, NOT unbounded.
        log = (
            "Result - Optimal solution found\n\n"
            "Objective value:                100.0\n"
        )
        sol = "Unbounded - objective value 0\n"
        with pytest.raises(CBCParseError):
            classify_cbc_termination(log, sol)

    def test_contradictory_unbounded_log_vs_optimal_sol_raises(self):
        # §34.2.10: the mirror case -- log says unbounded, .sol says optimal.
        log = "Result - Problem is unbounded\n"
        sol = "Optimal - objective value 42.0\n"
        with pytest.raises(CBCParseError):
            classify_cbc_termination(log, sol)

    def test_contradictory_gap_tolerance_signal_raises(self):
        log = (
            "Result - Optimal solution found (within gap tolerance)\n\n"
            "Objective value:                100.0\n"
            "Lower bound:                    99.0\n"
        )
        sol = "Optimal - objective value 100.0\n"  # missing "(within gap tolerance)"
        with pytest.raises(CBCParseError):
            classify_cbc_termination(log, sol)

    def test_integer_sol_token_vs_optimal_log_still_raises(self):
        # B2 widened is_infeasible_sol to accept "Integer" alongside
        # "Infeasible" -- confirm that widening didn't also silently accept
        # a genuine mismatch (an "Integer" .sol token contradicting a
        # provably-optimal log is still contradictory evidence).
        log = (
            "Result - Optimal solution found\n\n"
            "Objective value:                100.0\n"
        )
        sol = "Integer infeasible - objective value 100.0\n"
        with pytest.raises(CBCParseError):
            classify_cbc_termination(log, sol)

    def test_gap_limit_missing_bound_line_raises(self):
        log = (
            "Result - Optimal solution found (within gap tolerance)\n\n"
            "Objective value:                100.0\n"
        )
        with pytest.raises(CBCParseError):
            classify_cbc_termination(log, None)

    def test_stopped_with_no_no_feasible_marker_but_no_objective_raises(self):
        # Contrived: claims an incumbent exists (no "No feasible solution
        # found" line, no ".sol (no integer solution" marker) but truly
        # provides no objective value anywhere -- must not fabricate one.
        log = "Result - Stopped on time limit\n\nEnumerated nodes: 0\n"
        with pytest.raises(CBCParseError):
            classify_cbc_termination(log, None)


# ---------------------------------------------------------------------------
# 3. solve_with_capture: the real go/no-go acceptance bar. Live CBC solves,
#    kept small/fast for test-suite speed.
# ---------------------------------------------------------------------------

def _small_optimal_problem(name: str):
    from pulp import LpProblem, LpMinimize, LpVariable, lpSum
    prob = LpProblem(name, LpMinimize)
    xs = [LpVariable(f"x{i}", cat="Binary") for i in range(8)]
    prob += lpSum(xs)
    prob += lpSum(xs) >= 3
    return prob


class TestSolveWithCaptureGoNoGo:
    def test_basic_success_classifies_and_cleans_up(self):
        workdirs = []
        prob = _small_optimal_problem("BasicSuccess")
        result = solve_with_capture(prob, gapRel=0.0, timeLimit=30,
                                     on_workdir_created=workdirs.append)
        assert result.solutionStatus == "optimal"
        assert result.terminationReason == "optimality_proven"
        assert len(workdirs) == 1
        assert not os.path.exists(workdirs[0]), "work_dir must be removed after a successful solve"

    def test_no_artifacts_written_into_repo_tree(self):
        workdirs = []
        prob = _small_optimal_problem("NoRepoArtifacts")
        solve_with_capture(prob, gapRel=0.0, timeLimit=30,
                            on_workdir_created=workdirs.append)
        assert _REPO_ROOT is not None, "expected to find pnpm-workspace.yaml walking up from this repo"
        resolved = os.path.realpath(workdirs[0])
        assert not resolved.startswith(os.path.realpath(_REPO_ROOT) + os.sep)

    def test_assert_outside_repo_rejects_a_path_inside_the_repo(self):
        assert _REPO_ROOT is not None
        with pytest.raises(RuntimeError):
            _assert_outside_repo(os.path.join(_REPO_ROOT, "artifacts", "api-server"))

    def test_two_concurrent_same_problem_name_solves_do_not_collide(self):
        """The literal go/no-go bar: two concurrent solves of the SAME
        model with the SAME problem name must not collide."""
        workdirs = []
        results = {}
        errors = {}
        lock = threading.Lock()

        def _record_workdir(path):
            with lock:
                workdirs.append(path)

        def _run(tag):
            try:
                prob = _small_optimal_problem("SameName")  # deliberately identical
                r = solve_with_capture(prob, gapRel=0.0, timeLimit=30,
                                        on_workdir_created=_record_workdir)
                with lock:
                    results[tag] = r
            except Exception as e:  # noqa: BLE001 - test wants to see any failure
                with lock:
                    errors[tag] = e

        threads = [threading.Thread(target=_run, args=(i,)) for i in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        assert not errors, f"concurrent same-name solves raised: {errors}"
        assert len(results) == 2
        assert results[0].solutionStatus == "optimal"
        assert results[1].solutionStatus == "optimal"
        assert len(workdirs) == 2
        assert workdirs[0] != workdirs[1], "concurrent solves must get distinct temp dirs"
        for wd in workdirs:
            assert not os.path.exists(wd), "every concurrent solve's temp dir must be cleaned up"

    def test_cleanup_on_parser_error(self, monkeypatch):
        import cbc_termination as mod
        workdirs = []

        def _boom(log_path, sol_path):
            raise CBCParseError("synthetic parser failure for this test")

        monkeypatch.setattr(mod, "parse_cbc_termination", _boom)
        prob = _small_optimal_problem("ParserErrorCleanup")
        with pytest.raises(CBCParseError):
            mod.solve_with_capture(prob, gapRel=0.0, timeLimit=30,
                                    on_workdir_created=workdirs.append)
        assert len(workdirs) == 1
        assert not os.path.exists(workdirs[0]), \
            "work_dir must still be removed even when the parser itself raises"

    def test_cleanup_on_simulated_timeout(self, monkeypatch):
        """Simulated at the Python level per the task brief's explicit
        "(simulated) timeout / kill" language -- proves solve_with_capture's
        try/finally cleans up regardless of WHY prob.solve() didn't return
        normally. Real OS-level process-group timeout/kill ownership is the
        separate, paired Node task (jobRunner.ts) -- not re-verified here."""
        import cbc_termination as mod
        workdirs = []

        def _fake_solve(self, solver=None, **kwargs):
            raise TimeoutError("simulated outer-deadline timeout mid-solve")

        from pulp import LpProblem
        monkeypatch.setattr(LpProblem, "solve", _fake_solve)
        prob = _small_optimal_problem("SimulatedTimeoutCleanup")
        with pytest.raises(TimeoutError):
            mod.solve_with_capture(prob, gapRel=0.0, timeLimit=30,
                                    on_workdir_created=workdirs.append)
        assert len(workdirs) == 1
        assert not os.path.exists(workdirs[0])

    def test_cleanup_on_simulated_kill(self, monkeypatch):
        """Simulates a killed CBC child (pulp itself raises PulpSolverError
        when its subprocess exits nonzero -- the real exception class a
        genuine external kill of the cbc binary would surface through
        COIN_CMD.solve_CBC()'s own `if cbc.wait() != 0: raise
        PulpSolverError(...)` path)."""
        import cbc_termination as mod
        from pulp import PulpSolverError, LpProblem
        workdirs = []

        def _fake_solve(self, solver=None, **kwargs):
            raise PulpSolverError("simulated: CBC child process was killed")

        monkeypatch.setattr(LpProblem, "solve", _fake_solve)
        prob = _small_optimal_problem("SimulatedKillCleanup")
        with pytest.raises(PulpSolverError):
            mod.solve_with_capture(prob, gapRel=0.0, timeLimit=30,
                                    on_workdir_created=workdirs.append)
        assert len(workdirs) == 1
        assert not os.path.exists(workdirs[0])

    def test_path_traversal_safe_problem_uid(self):
        """problem_uid is only ever used for prob.name readability, never
        for a filesystem path -- a malicious value must not escape the
        work_dir or otherwise break the solve."""
        workdirs = []
        prob = _small_optimal_problem("PathTraversalGuard")
        malicious = "../../../../etc/passwd"
        result = solve_with_capture(prob, gapRel=0.0, timeLimit=30,
                                     problem_uid=malicious,
                                     on_workdir_created=workdirs.append)
        assert result.solutionStatus == "optimal"
        assert len(workdirs) == 1
        # the work_dir itself must still be a plain mkdtemp()-created path,
        # unaffected by the malicious problem_uid
        assert os.path.basename(workdirs[0]).startswith("nos-cbc-")
        assert not os.path.exists(workdirs[0])

    def test_infeasible_and_unbounded_classify_via_real_solve(self):
        from pulp import LpProblem, LpMinimize, LpMaximize, LpVariable, lpSum
        # infeasible
        prob = LpProblem("RealInfeasible", LpMinimize)
        x = LpVariable("x", lowBound=0, upBound=1)
        prob += x
        prob += x >= 2  # contradicts upBound=1
        result = solve_with_capture(prob, gapRel=0.0, timeLimit=10)
        assert result.solutionStatus == "infeasible"
        assert result.terminationReason == "infeasible"

        # unbounded
        prob2 = LpProblem("RealUnbounded", LpMaximize)
        y = LpVariable("y", lowBound=0)
        prob2 += y
        result2 = solve_with_capture(prob2, timeLimit=10)
        assert result2.solutionStatus == "unbounded"
        assert result2.terminationReason == "unbounded"

    def test_pure_lp_optimal_classifies_via_real_solve(self):
        """B2 regression: a solve with zero integer/binary variables (a pure
        LP, e.g. transport-coal's multi-source case) never prints a
        "Result -" trailer -- CBC's Clp layer reports "Optimal - objective
        value X" directly instead. Before this fix, classify_cbc_termination
        raised CBCParseError on every such solve (real transport-coal
        multi-source solves hit this)."""
        from pulp import LpProblem, LpMinimize, LpVariable, lpSum
        prob = LpProblem("RealPureLPOptimal", LpMinimize)
        # No cat="Binary"/"Integer" anywhere -- a genuine continuous LP.
        xs = [LpVariable(f"x{i}", lowBound=0) for i in range(5)]
        prob += lpSum(xs)
        prob += lpSum(xs) >= 3
        result = solve_with_capture(prob, gapRel=0.0, timeLimit=10)
        assert result.solutionStatus == "optimal"
        assert result.terminationReason == "optimality_proven"
        assert result.solverIncumbentObjective is not None
        assert abs(result.solverIncumbentObjective - 3.0) < 1e-6

    def test_repeated_solves_accumulate_no_processes_or_artifacts(self):
        """Runs several solves back to back and confirms none leaves a
        stray temp directory behind -- a cheap proxy (at the Python/
        filesystem level) for the go/no-go bar's "repeated timeouts
        accumulate no processes/artifacts" requirement. Real OS-level
        process accounting across a forced-kill loop is the Node task's
        no-orphan proof, not reproduced here."""
        workdirs = []
        for i in range(5):
            prob = _small_optimal_problem(f"Repeat{i}")
            solve_with_capture(prob, gapRel=0.0, timeLimit=10,
                                on_workdir_created=workdirs.append)
        assert len(workdirs) == 5
        assert len(set(workdirs)) == 5, "every repeated solve must get its own unique work_dir"
        for wd in workdirs:
            assert not os.path.exists(wd)
