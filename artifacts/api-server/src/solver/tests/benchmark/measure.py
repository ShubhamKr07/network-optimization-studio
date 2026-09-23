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
