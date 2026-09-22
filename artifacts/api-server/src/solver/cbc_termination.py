"""CBC termination-evidence parser + concurrency-safe capture wrapper.

P0R.1 go/no-go spike deliverable. See
docs/superpowers/specs/2026-09-21-scnd-solver-result-contract-design.md
Section 3 (P0R.1) for the contract this gathers evidence for.

--------------------------------------------------------------------------
Why this module exists (the core unknown this spike resolves)
--------------------------------------------------------------------------
PuLP 3.3.2's ``COIN_CMD.solve_CBC()`` (pulp/apis/coin_api.py) creates its own
temp file names, runs CBC, parses the ``.sol`` file for variable values,
calls ``self.delete_tmp_files(...)`` to remove its mps/lp/sol/mst temp files,
and *only then* returns control to ``prob.solve()``. The caller normally
never sees the raw CBC log or ``.sol`` header text at all -- and by the time
``prob.solve()`` returns, the evidence is gone from disk.

Confirmed against the *actual installed* pulp==3.3.2 source (not assumed):
  - ``LpSolver_CMD.create_tmp_files()`` (pulp/apis/core.py) already names
    every temp file with a fresh ``uuid4().hex`` prefix whenever
    ``keepFiles=False`` (this app's production setting) -- so file-name
    COLLISION under concurrency was never actually the risk with the
    default ``keepFiles=False`` PuLP already uses; the real risk this module
    closes is (a) the files being deleted before any caller can read them,
    and (b) proving isolation/cleanup is airtight regardless.
  - ``COIN_CMD.solve_CBC()`` accepts a ``logPath`` kwarg that redirects
    CBC's full stdout/stderr log to a file *regardless of ``msg``* -- this
    is how we get the real CBC log at all (solve.py currently calls
    ``PULP_CBC_CMD(..., msg=False)`` with no ``logPath``, so today's
    production code discards this evidence into ``/dev/null``).
  - ``delete_tmp_files(*args)`` is called with the four temp paths
    (``tmpMps, tmpLp, tmpSol, tmpMst``) *after* CBC has already run and the
    ``.sol`` file has been read for variable values, but *before* those
    files are removed -- this is the one hook available to capture the raw
    ``.sol`` header text before it disappears, and it is the exact
    mechanism this module's ``CapturingCBCSolver`` overrides.

Primary approach (approved, see spec Q8): a custom ``PULP_CBC_CMD`` subclass
that (a) pins every solve's temp files into a caller-created, per-solve
unique temp directory, (b) exposes the unique CBC log + ``.sol`` paths,
(c) captures the ``.sol`` content in the ``delete_tmp_files`` hook -- i.e.
BEFORE PuLP's own deletion -- and (d) always cleans the directory up via
``try/finally`` regardless of success, a parser exception, a simulated
timeout, or a simulated kill. See ``solve_with_capture`` below.

--------------------------------------------------------------------------
Why CBC's log (not PuLP's own LpStatus / get_status()) is authoritative
--------------------------------------------------------------------------
``COIN_CMD.get_status()`` (pulp/apis/coin_api.py) maps the ``.sol`` file's
first line by its *first whitespace token* only: "Optimal" / "Infeasible" /
"Integer" / "Unbounded" / "Stopped" -> one of 5 ``LpStatus`` values. Verified
directly against real CBC output from this app's own datasets and a
synthetic hard MIP (~40 solves run during this spike; fixtures for 8 of them
committed under tests/fixtures/cbc/):

  - A **gap-limited** stop (P-median-brazil P=5 cap=20M gap=0.05, the exact
    scenario the design spec's Section 1 cites) produces a ``.sol`` header
    ``"Optimal (within gap tolerance) - objective value 27022899653.8..."``
    and a log line ``"Result - Optimal solution found (within gap
    tolerance)"``. ``get_status()``'s first-token split makes this
    indistinguishable from a genuinely *proven* optimum (both first-token
    "Optimal" -> ``LpStatusOptimal``) -- this is precisely the "hardcoded
    status=optimal" defect the design spec's Section 1 describes, confirmed
    directly against real CBC evidence, not inferred.
  - A **time-limited stop WITH an incumbent** produces a ``.sol`` header
    ``"Stopped on time - objective value 96479.00000000"`` (first token
    "Stopped", but tokens[4] == "objective" -> ``get_status()`` explicitly
    special-cases this and *also* reports ``LpStatusOptimal`` + solution
    status "IntegerFeasible" -- so PuLP itself silently promotes a
    time-limited *feasible* result to "Optimal", the exact bug flagged by
    the design spec ("COIN_CMD.get_status() can map 'Stopped ... objective'
    to LpStatusOptimal").
  - A **time-limited stop WITH NO incumbent** produces the *same* first
    token ("Stopped") but a header text that says
    ``"Stopped on time (no integer solution - continuous used) - objective
    value ..."`` -- the numeric value after "objective value" here is the
    **LP relaxation value**, not a real incumbent, and ``get_status()``
    would *still* promote this to ``LpStatusOptimal`` by the same
    tokens[4]=="objective" rule. This module treats the presence of the
    literal substring ``"(no integer solution"`` in the ``.sol`` header as
    the authoritative "no real incumbent exists" signal and refuses to
    report the LP-relaxation number as ``solverIncumbentObjective``.
  - A **node-limited** stop's ``.sol`` header says ``"Stopped on
    iterations ..."`` -- textually IDENTICAL in shape to a time-limited
    stop's "no incumbent" case's generic "Stopped" family, and CBC's own
    ``.sol`` file gives **no way to distinguish "stopped on node limit" from
    "stopped on time limit"** at all -- only the LOG's ``"Result - Stopped
    on node limit"`` vs. ``"Result - Stopped on time limit"`` line
    disambiguates this. The ``.sol`` file alone is provably insufficient;
    reading the real CBC log is not optional.
  - **Never classify by wall clock.** In this spike's own exploration, a
    ``timeLimitSec=0.2`` request on one instance sometimes finished with a
    *proven* optimum in 0.14s wall time and sometimes hit the limit with no
    incumbent at 0.21s wall time depending on exactly where the limit fell
    relative to CBC's internal work -- the *outcome* is determined by CBC's
    own internal state, not by comparing elapsed time to the requested
    limit from the caller's side.

--------------------------------------------------------------------------
Explicitly OUT of scope for this module (separate, paired Node task)
--------------------------------------------------------------------------
Process-group ownership, detached spawn, PGID kill, and the no-orphan proof
on the production OS belong to ``jobRunner.ts`` (Node). This module's own
"kill" cleanup proof is therefore *simulated at the Python level* (a raised
exception mid-``prob.solve()``, standing in for "the child was killed out
from under us") per the task brief's explicit "(simulated) timeout / kill"
language -- it proves ``solve_with_capture``'s ``try/finally`` cleans up
regardless of *why* the solve didn't finish normally, without claiming to
have verified real OS-level orphan-process behavior (that is the Node task's
job, using this module's captured evidence once Node owns the process).
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import uuid
from typing import Optional

import pulp
from pulp import PULP_CBC_CMD

# ---------------------------------------------------------------------------
# Version guard. This module's capture mechanism (forcing tmpDir, hooking
# delete_tmp_files, relying on logPath bypassing msg=False) was verified
# against this exact pulp release. A version bump could change
# COIN_CMD.solve_CBC()'s internals without warning; fail loud, not silent.
# ---------------------------------------------------------------------------
_VALIDATED_PULP_VERSION = "3.3.2"


def _require_validated_pulp() -> None:
    """Fail closed (§34.3.1): the capture wrapper hooks COIN_CMD's temp-file/
    delete_tmp_files internals, verified against this exact pulp release; a
    version bump can silently change them, so RAISE (not warn) before
    capturing any evidence. Guards only the CAPTURE path — the pure text
    classifier (classify_cbc_termination) is PuLP-independent and stays
    usable (fixture tests) under any pulp version."""
    if pulp.__version__ != _VALIDATED_PULP_VERSION:  # pragma: no cover - env-dependent
        raise RuntimeError(
            f"cbc_termination capture wrapper verified against "
            f"pulp=={_VALIDATED_PULP_VERSION}; running under pulp=={pulp.__version__}. "
            "Re-verify COIN_CMD.solve_CBC()'s temp-file contract before trusting "
            "captured evidence."
        )

EPS = 1e-10

SOLUTION_STATUSES = frozenset({"optimal", "feasible", "infeasible", "unbounded", "no_solution"})
TERMINATION_REASONS = frozenset({
    # §34.3.4: `interrupted` is NOT a parser output — a killed process leaves
    # no CBC evidence, so interruption is classified by Node (failure branch),
    # never here. `unknown` is retained for the legacy read path only.
    "optimality_proven", "gap_limit", "time_limit", "node_limit",
    "infeasible", "unbounded", "unknown",
})


class CBCParseError(Exception):
    """Raised when CBC's log/.sol evidence cannot be classified into a known
    (solutionStatus, terminationReason) pair, or when two independent
    signals (the log's 'Result -' line vs. the .sol header) disagree.
    Never silently guessed -- the caller must decide how to degrade
    (e.g. the production integration's own internal_error / unknown path)."""


# ---------------------------------------------------------------------------
# Regex evidence extraction. Every pattern below is grounded in real,
# committed fixtures under tests/fixtures/cbc/ -- see that directory's
# README.md for the exact real solve each fixture came from.
# ---------------------------------------------------------------------------
_RESULT_LINE_RE = re.compile(r"^Result - (?P<msg>.+?)\s*$", re.MULTILINE)
_INFEASIBLE_LOG_RE = re.compile(r"^Problem is infeasible\b", re.MULTILINE)
_OBJECTIVE_VALUE_RE = re.compile(r"^Objective value:\s*([-+0-9.eE]+)", re.MULTILINE)
# CBC prints "Lower bound:" for a minimize-sense model and "Upper bound:"
# for a maximize-sense one (confirmed: our synthetic knapsack fixtures are
# LpMaximize and print "Upper bound:"; every real app model is LpMinimize
# and prints "Lower bound:") -- match either.
_BOUND_LINE_RE = re.compile(r"^(?:Lower|Upper) bound:\s*([-+0-9.eE]+)", re.MULTILINE)
_NO_FEASIBLE_RE = re.compile(r"^No feasible solution found", re.MULTILINE)
_SOL_OBJECTIVE_RE = re.compile(r"objective value\s+([-+0-9.eE]+)\s*$")


def _to_float(raw: Optional[str]) -> Optional[float]:
    return float(raw) if raw is not None else None


def _first_match(pattern: "re.Pattern[str]", text: str) -> Optional[float]:
    m = pattern.search(text)
    return _to_float(m.group(1)) if m else None


def _sol_objective(sol_first_line: str) -> Optional[float]:
    m = _SOL_OBJECTIVE_RE.search(sol_first_line)
    return _to_float(m.group(1)) if m else None


def _evidence(objective: Optional[float], bound: Optional[float]) -> dict:
    achieved_gap = None
    if objective is not None and bound is not None:
        achieved_gap = round(abs(objective - bound) / max(abs(objective), EPS), 6)
    return {
        "achievedGap": achieved_gap,
        "solverIncumbentObjective": objective,
        "solverBestBound": bound,
    }


def _result(solution_status: str, termination_reason: str,
            objective: Optional[float], bound: Optional[float]):
    assert solution_status in SOLUTION_STATUSES
    assert termination_reason in TERMINATION_REASONS
    return solution_status, termination_reason, _evidence(objective, bound)


def _classify_stopped(reason: str, log_text: str, log_objective: Optional[float],
                       log_bound: Optional[float], sol_first_line: str):
    no_feasible = bool(_NO_FEASIBLE_RE.search(log_text))
    sol_no_incumbent = "(no integer solution" in sol_first_line
    has_incumbent = not (no_feasible or sol_no_incumbent)
    if has_incumbent:
        incumbent = log_objective if log_objective is not None else _sol_objective(sol_first_line)
        if incumbent is None:
            raise CBCParseError(
                f"{reason}: an incumbent was expected (no 'No feasible solution "
                "found' / no '(no integer solution' marker) but no objective "
                "value could be found in the log or .sol header")
        return _result("feasible", reason, incumbent, log_bound)
    return _result("no_solution", reason, None, log_bound)


def classify_cbc_termination(log_text: str, sol_text: Optional[str]):
    """Pure classification over already-read log/.sol text. Split out from
    the path-based ``parse_cbc_termination`` so parser unit tests can run
    against committed fixture text with no filesystem/live-solve dependency
    (P0R.2's "no live solving in the unit tests" requirement)."""
    if not log_text or not log_text.strip():
        raise CBCParseError("empty CBC log")

    sol_first_line = (sol_text or "").splitlines()[0] if sol_text else ""
    sol_tokens = sol_first_line.split()
    sol_token0 = sol_tokens[0] if sol_tokens else None

    result_matches = list(_RESULT_LINE_RE.finditer(log_text))
    result_msg = result_matches[-1].group("msg") if result_matches else None

    # CBC has (at least) two distinct log shapes for infeasibility,
    # confirmed against two real solves: (1) MIP-presolve infeasibility
    # prints a standalone "Problem is infeasible - N seconds" line with NO
    # "Result -" line at all (see fixtures/cbc/infeasible.*, a JADE
    # forced-open-exceeds-P solve); (2) a pure LP-relaxation infeasibility
    # (no integer variables, caught by CBC's own presolve/dual-simplex
    # analysis) prints "Result - Linear relaxation infeasible" instead, with
    # no standalone "Problem is infeasible" line anywhere (see
    # fixtures/cbc/infeasible_lp_relaxation.*). Both are real, both must be
    # recognized -- checking only one silently misclassifies the other.
    is_infeasible_standalone_log = bool(_INFEASIBLE_LOG_RE.search(log_text))
    is_infeasible_result_line = result_msg is not None and "infeasible" in result_msg.lower()
    is_infeasible_log = is_infeasible_standalone_log or is_infeasible_result_line
    is_infeasible_sol = sol_token0 == "Infeasible"
    if is_infeasible_log or is_infeasible_sol:
        if sol_text is not None and is_infeasible_log != is_infeasible_sol:
            raise CBCParseError(
                f"infeasibility signal mismatch: log says infeasible={is_infeasible_log}, "
                f".sol first token={sol_token0!r}")
        return _result("infeasible", "infeasible", None, None)

    is_unbounded_sol = sol_token0 == "Unbounded"
    is_unbounded_log = result_msg is not None and "unbounded" in result_msg.lower()
    if is_unbounded_sol or is_unbounded_log:
        # Same cross-source agreement guard as the infeasible branch above
        # (§34.2.10): when both the log and the .sol are present they must
        # AGREE -- an optimal-log/unbounded-.sol (or vice-versa) is
        # contradictory evidence, not an unbounded result. Do not accept
        # `unbounded` on a single source's say-so when the other disagrees.
        if sol_text is not None and is_unbounded_sol != is_unbounded_log:
            raise CBCParseError(
                f"unboundedness signal mismatch: log says unbounded={is_unbounded_log}, "
                f".sol first token={sol_token0!r}")
        return _result("unbounded", "unbounded", None, None)

    if result_msg is None:
        raise CBCParseError(
            "no 'Result -' line found in the CBC log, and no infeasible/"
            "unbounded marker either -- log may be truncated/malformed "
            "(e.g. the process was killed before CBC finished writing it)")

    log_objective = _first_match(_OBJECTIVE_VALUE_RE, log_text)
    log_bound = _first_match(_BOUND_LINE_RE, log_text)

    if result_msg.startswith("Optimal solution found"):
        within_gap_log = "(within gap tolerance)" in result_msg
        within_gap_sol = "(within gap tolerance)" in sol_first_line
        if sol_text is not None and within_gap_log != within_gap_sol:
            raise CBCParseError(
                f"gap-tolerance signal mismatch: log={within_gap_log} .sol={within_gap_sol}")
        incumbent = log_objective if log_objective is not None else _sol_objective(sol_first_line)
        if incumbent is None:
            raise CBCParseError("'Optimal solution found' but no objective value found")
        if within_gap_log:
            if log_bound is None:
                raise CBCParseError(
                    "gap_limit result is missing its bound line -- required by "
                    "the target contract's invariant matrix (Sec 2.4: "
                    "'solverBestBound + achievedGap required')")
            return _result("feasible", "gap_limit", incumbent, log_bound)
        # A genuinely proven optimum: confirmed across every proven-optimal
        # fixture that CBC prints NO separate "Lower/Upper bound:" line in
        # this case (only "Objective value:" + "Enumerated nodes:" etc) --
        # we do not synthesize bound == incumbent; it stays null unless CBC
        # itself printed one (matches the target contract's "present when
        # available" wording for this row, not "always required").
        return _result("optimal", "optimality_proven", incumbent, log_bound)

    if result_msg.startswith("Stopped on time limit"):
        return _classify_stopped("time_limit", log_text, log_objective, log_bound, sol_first_line)

    if result_msg.startswith("Stopped on node limit"):
        return _classify_stopped("node_limit", log_text, log_objective, log_bound, sol_first_line)

    raise CBCParseError(f"unrecognized CBC 'Result -' message: {result_msg!r}")


def parse_cbc_termination(log_path: str, sol_path: Optional[str]):
    """parse_cbc_termination(log_path, sol_path) ->
        (solutionStatus, terminationReason,
         {achievedGap, solverIncumbentObjective, solverBestBound})

    Reads the real CBC log at ``log_path`` (required) and the captured
    ``.sol`` header at ``sol_path`` (optional -- absent/unreadable is
    tolerated, e.g. an infeasible/unbounded solve where CBC's .sol carries
    no useful incumbent info anyway) and classifies the outcome from CBC's
    own terminal records. Raises ``CBCParseError`` on malformed/ambiguous/
    contradictory evidence rather than guessing.
    """
    with open(log_path, "r", errors="replace") as f:
        log_text = f.read()
    sol_text = None
    if sol_path and os.path.exists(sol_path):
        with open(sol_path, "r", errors="replace") as f:
            sol_text = f.read()
    return classify_cbc_termination(log_text, sol_text)


# ---------------------------------------------------------------------------
# Concurrency-safe capture wrapper (the go/no-go primary approach).
# ---------------------------------------------------------------------------

def _repo_root() -> Optional[str]:
    """Walk up from this file to find pnpm-workspace.yaml, mirroring this
    codebase's established findRepoRoot() pattern (see data/dataset.ts) --
    used only for the "no artifacts written into the repo tree" guard."""
    here = os.path.dirname(os.path.abspath(__file__))
    while True:
        if os.path.exists(os.path.join(here, "pnpm-workspace.yaml")):
            return here
        parent = os.path.dirname(here)
        if parent == here:
            return None
        here = parent


_REPO_ROOT = _repo_root()


def _assert_outside_repo(path: str) -> None:
    if _REPO_ROOT is None:
        return
    resolved = os.path.realpath(path)
    repo = os.path.realpath(_REPO_ROOT)
    if resolved == repo or resolved.startswith(repo + os.sep):
        raise RuntimeError(
            f"refusing to create solver temp artifacts inside the repo tree: "
            f"{resolved!r} is under {repo!r}")


class CapturingCBCSolver(PULP_CBC_CMD):
    """PULP_CBC_CMD subclass that pins a solve's temp files into a
    caller-provided, per-solve-unique work_dir and captures the CBC log +
    .sol content before PuLP's own COIN_CMD.solve_CBC() deletes them.

    File names within work_dir are ALWAYS generated by this class via a
    fresh uuid4().hex -- never derived from caller-supplied input -- which
    is what makes this path-traversal-safe by construction rather than by
    sanitizing an untrusted string.
    """

    def __init__(self, *, work_dir: str, **kwargs):
        _require_validated_pulp()
        self.work_dir = work_dir
        file_uid = uuid.uuid4().hex
        self.log_path = os.path.join(work_dir, f"{file_uid}.log")
        self.sol_path = os.path.join(work_dir, f"{file_uid}.sol")
        self.sol_text: Optional[str] = None
        kwargs.setdefault("keepFiles", False)
        kwargs["logPath"] = self.log_path
        super().__init__(**kwargs)
        # Force PuLP's own (already uuid-unique) mps/lp/sol/mst temp files
        # into this same isolated directory -- not required for name
        # collision-safety under keepFiles=False (already uuid4-random, see
        # this module's docstring), but required so ONE shutil.rmtree
        # cleans up everything and nothing escapes into a shared/system tmp
        # scope shared with unrelated concurrent solves.
        self.tmpDir = work_dir

    def delete_tmp_files(self, *args):
        # COIN_CMD.solve_CBC() calls this AFTER it has already parsed the
        # .sol file for variable values but BEFORE deleting it -- the one
        # hook available to capture the raw .sol header before it's gone.
        for path in args:
            if path.endswith("-pulp.sol"):
                try:
                    with open(path, "r", errors="replace") as f:
                        self.sol_text = f.read()
                except OSError:
                    self.sol_text = None
        # Persist our own copy at a stable path this instance owns, so it
        # survives PuLP deleting its own original file two lines below.
        with open(self.sol_path, "w") as f:
            f.write(self.sol_text or "")
        super().delete_tmp_files(*args)


class CBCCaptureResult:
    """Return value of solve_with_capture()."""

    __slots__ = (
        "solutionStatus", "terminationReason", "achievedGap",
        "solverIncumbentObjective", "solverBestBound", "lpStatus",
    )

    def __init__(self, *, solutionStatus, terminationReason, achievedGap,
                 solverIncumbentObjective, solverBestBound, lpStatus):
        self.solutionStatus = solutionStatus
        self.terminationReason = terminationReason
        self.achievedGap = achievedGap
        self.solverIncumbentObjective = solverIncumbentObjective
        self.solverBestBound = solverBestBound
        self.lpStatus = lpStatus

    def __repr__(self):  # pragma: no cover - debugging convenience only
        return (
            f"CBCCaptureResult(solutionStatus={self.solutionStatus!r}, "
            f"terminationReason={self.terminationReason!r}, "
            f"achievedGap={self.achievedGap!r}, "
            f"solverIncumbentObjective={self.solverIncumbentObjective!r}, "
            f"solverBestBound={self.solverBestBound!r})"
        )


def solve_with_capture(prob, *, gapRel=None, timeLimit=None, maxNodes=None,
                        msg=False, base_tmp_dir=None, problem_uid=None,
                        on_workdir_created=None, **extra_solver_kwargs):
    """Solve ``prob`` via a fresh, isolated, per-solve-unique temp directory,
    capture CBC's real log + .sol evidence, classify it, and ALWAYS clean up
    (success, parser error, or an exception raised mid-solve simulating a
    kill/timeout) before returning.

    ``problem_uid``, if given, is used ONLY to make ``prob.name`` more
    readable in the CBC log for tracing -- it never touches any filesystem
    path (see CapturingCBCSolver's docstring: file names are always our own
    fresh uuid). A malicious/traversal-laden problem_uid is therefore inert.

    ``on_workdir_created``, if given, is called with the work_dir path
    immediately after creation, purely for test observability (e.g.
    asserting two concurrent calls got distinct directories, or that a
    directory is fully gone after cleanup) -- it has no effect on solving.
    """
    base_tmp_dir = base_tmp_dir or tempfile.gettempdir()
    work_dir = tempfile.mkdtemp(prefix="nos-cbc-", dir=base_tmp_dir)
    _assert_outside_repo(work_dir)
    if on_workdir_created is not None:
        on_workdir_created(work_dir)

    original_name = prob.name
    suffix = problem_uid if problem_uid is not None else uuid.uuid4().hex
    # Best-effort readability only -- LP problem names must be a restricted
    # character set for CBC's own MPS writer, so we don't trust arbitrary
    # caller input here either; a bad name degrades to the unmodified
    # original rather than corrupting the solve.
    safe_suffix = re.sub(r"[^A-Za-z0-9_]", "_", str(suffix))[:64]
    prob.name = f"{original_name}_{safe_suffix}"

    solver = CapturingCBCSolver(
        work_dir=work_dir, gapRel=gapRel, timeLimit=timeLimit,
        maxNodes=maxNodes, msg=msg, keepFiles=False, **extra_solver_kwargs,
    )
    try:
        prob.solve(solver)
        solution_status, termination_reason, evidence = parse_cbc_termination(
            solver.log_path, solver.sol_path)
        return CBCCaptureResult(
            solutionStatus=solution_status,
            terminationReason=termination_reason,
            lpStatus=pulp.LpStatus[prob.status],
            **evidence,
        )
    finally:
        prob.name = original_name
        shutil.rmtree(work_dir, ignore_errors=True)
