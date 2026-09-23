"""A3 — the real production contract: solve.py writes exactly ONE
newline-terminated JSON SolverProcessMessage on fd 3, the channel
jobRunner.ts's spawn() opens as a fourth stdio pipe. Every other pytest file
in this directory invokes solve.py WITHOUT providing fd 3 (plain
subprocess.run with only stdin/stdout/stderr) — that's solve.py's
documented dev/manual fallback (_write_process_message() prints to stdout
when fd 3 isn't open), which is why none of them needed to change for this
task. This file is the one that actually opens fd 3, mirroring what Node
really does, and proves:
  - fd 3 carries the message (success AND failure).
  - stdout does NOT carry the envelope JSON when fd 3 is available (the
    live bug this task closes: nothing should be left for a naive "read
    stdout" reader to misinterpret as a result).
  - a dataset-load/dispatch-style failure that used to be a status="error"
    envelope on stdout is now a FAILURE message on fd 3, never a success
    envelope.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

SOLVER_PY = Path(__file__).parent.parent / "solve.py"


def run_with_fd3(payload, raw_stdin: str | None = None, timeout: int = 60):
    """Spawns solve.py with a real fd 3 pipe (mirrors jobRunner.ts's
    spawn(..., stdio=['pipe','pipe','pipe','pipe'])) using dup2 in a
    preexec_fn — Python's subprocess module has no per-index stdio mapping
    like Node's, so this is the direct equivalent: duplicate our pipe's
    write end onto fd 3 in the child before exec.

    Returns (fd3_text, stdout_text, stderr_text, returncode).
    """
    r, w = os.pipe()
    # close_fds=False (not pass_fds): CPython's subprocess module runs its
    # "close every fd not in pass_fds" sweep AFTER preexec_fn, so a fd we
    # create *inside* preexec_fn via dup2 (a number never listed in
    # pass_fds, since it doesn't exist yet when Popen() is called) gets
    # closed again immediately before exec — confirmed empirically. Node's
    # real spawn() has no such two-phase ordering hazard (it builds the
    # exact stdio fd table directly), so this is purely a limitation of
    # replicating fd-index-3 semantics from Python's subprocess module, not
    # something jobRunner.ts itself needs to work around.
    try:
        proc = subprocess.Popen(
            [sys.executable, str(SOLVER_PY)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            close_fds=False,
            preexec_fn=lambda: os.dup2(w, 3),
        )
    finally:
        os.close(w)  # parent's copy of the write end — the child has its own via dup2

    stdin_payload = raw_stdin if raw_stdin is not None else json.dumps(payload)
    stdout_data, stderr_data = proc.communicate(input=stdin_payload.encode(), timeout=timeout)

    fd3_chunks = []
    while True:
        chunk = os.read(r, 65536)
        if not chunk:
            break
        fd3_chunks.append(chunk)
    os.close(r)

    return b"".join(fd3_chunks).decode(), stdout_data.decode(), stderr_data.decode(), proc.returncode


BASE_PMEDIAN_INPUT = {
    "modelType": "p_median",
    "pValue": 3,
    "distanceBands": [200, 400, 800, 1600],
    "capacityMode": "uniform",
    "uniformCapacity": None,
    "warehouseStatuses": [],
    "gap": 0.0,
    "timeLimitSec": 60,
}


class TestSuccessOnFd3:
    def test_fd3_carries_exactly_one_newline_terminated_json_message(self):
        fd3_text, stdout_text, stderr_text, code = run_with_fd3(BASE_PMEDIAN_INPUT)
        assert code == 0, stderr_text
        assert fd3_text.endswith("\n")
        assert fd3_text.count("\n") == 1
        msg = json.loads(fd3_text)
        assert msg["status"] == "optimal"
        assert "edges" in msg and "objective" in msg

    def test_stdout_does_not_carry_the_envelope_when_fd3_is_available(self):
        fd3_text, stdout_text, stderr_text, code = run_with_fd3(BASE_PMEDIAN_INPUT)
        assert code == 0, stderr_text
        # stdout must not itself parse as the result — the whole point of the
        # fd3 split is that a naive "read stdout" reader can no longer pick
        # up a result at all, valid or otherwise.
        try:
            parsed = json.loads(stdout_text.strip()) if stdout_text.strip() else None
        except json.JSONDecodeError:
            parsed = "unparseable"
        assert parsed is None or "edges" not in (parsed if isinstance(parsed, dict) else {})

    def test_success_message_never_carries_status_error(self):
        fd3_text, _, _, code = run_with_fd3(BASE_PMEDIAN_INPUT)
        assert code == 0
        msg = json.loads(fd3_text)
        assert msg["status"] != "error"
        assert msg.get("solutionStatus") != "error"


class TestFailureOnFd3:
    def test_unknown_model_type_is_a_failure_message_not_a_success_envelope(self):
        fd3_text, stdout_text, stderr_text, code = run_with_fd3({"modelType": "not_a_real_model"})
        assert code == 0, stderr_text
        msg = json.loads(fd3_text)
        assert "failureReason" in msg
        assert "edges" not in msg
        assert msg["failureReason"] == "internal_error"
        assert msg["failureStage"] == "dispatch"
        # errorDetail must never carry raw exception/stdout text.
        assert msg.get("errorDetail") in (None, {})

    def test_malformed_stdin_is_a_failure_message(self):
        fd3_text, stdout_text, stderr_text, code = run_with_fd3(
            payload=None, raw_stdin="not valid json {{",
        )
        assert code == 0, stderr_text
        msg = json.loads(fd3_text)
        assert msg["failureReason"] == "internal_error"
        assert msg["failureStage"] == "input_parse"

    def test_failure_message_has_no_edges_key_ever(self):
        fd3_text, _, _, code = run_with_fd3({"modelType": "bogus"})
        msg = json.loads(fd3_text)
        assert "edges" not in msg
        assert "status" not in msg


class TestFd3CloseOnExec:
    def test_fd3_is_marked_close_on_exec_before_any_cbc_spawn(self):
        """CBC is spawned by PuLP from *inside* a solve_*() call, well after
        module import. Confirms solve.py sets FD_CLOEXEC on fd 3 at import
        time (before any solve() is even called) — the earliest point that
        can matter, since a CBC child spawned later would otherwise inherit
        an open fd 3 and could hold Node's read end open past solve.py's own
        exit."""
        r, w = os.pipe()
        try:
            proc = subprocess.Popen(
                [sys.executable, "-c",
                 "import fcntl,sys,os; sys.path.insert(0, '.'); import solve; "
                 "flags = fcntl.fcntl(3, fcntl.F_GETFD); "
                 "sys.stderr.write(str(bool(flags & fcntl.FD_CLOEXEC)))"],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                close_fds=False, cwd=str(Path(__file__).parent.parent),
                preexec_fn=lambda: os.dup2(w, 3),
            )
        finally:
            os.close(w)
        _out, err = proc.communicate(timeout=30)
        os.close(r)
        assert err.decode() == "True"


class TestNosSolveWorkdirEnvVar:
    def test_solve_still_succeeds_with_a_custom_workdir(self, tmp_path):
        workdir = tmp_path / "nos-solve-test"
        workdir.mkdir()
        env = {**os.environ, "NOS_SOLVE_WORKDIR": str(workdir)}
        r, w = os.pipe()
        try:
            proc = subprocess.Popen(
                [sys.executable, str(SOLVER_PY)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                close_fds=False, env=env,
                preexec_fn=lambda: os.dup2(w, 3),
            )
        finally:
            os.close(w)
        stdout_data, stderr_data = proc.communicate(
            input=json.dumps(BASE_PMEDIAN_INPUT).encode(), timeout=60)
        chunks = []
        while True:
            chunk = os.read(r, 65536)
            if not chunk:
                break
            chunks.append(chunk)
        os.close(r)
        assert proc.returncode == 0, stderr_data.decode()
        msg = json.loads(b"".join(chunks).decode())
        assert msg["status"] == "optimal"
        # Node's own cleanup (not exercised in this pure-Python test) removes
        # the directory after the process group dies; solve_with_capture's
        # own finally already removes its per-call subdirectory regardless.
        assert workdir.exists()  # the base dir itself is Node's to remove, not solve.py's
