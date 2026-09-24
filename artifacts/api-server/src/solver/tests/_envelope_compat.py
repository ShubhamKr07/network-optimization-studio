"""G2.1 wrapped solve.py's output in a standardized envelope ({status,
objective, edges, metrics, details, ...}). These test files assert on
solver *math* (objective/assignment values), not the wire shape — that's
resultEnvelope.ts's own Zod-validated DoD — so flatten back to the
pre-envelope shape once here (mirrors pmedian.ts's envelopeToLegacy() shim)
instead of touching every assertion in every test file. Per that task's
documented exception, only paths change here, not any expected numeric
value.

B2: also passes through solutionStatus/terminationReason/achievedGap/
solverIncumbentObjective/solverBestBound verbatim (additive -- every
pre-existing flat field is untouched) so DEC-2026-09-21-01's corrected
e2e_accuracy.py assertions can check the truthful outcome directly instead
of only the legacy `status` projection.

A8 (SCND Correctness): this is a TEST-ONLY shim consumed by the standalone
Python accuracy/regression scripts under this directory -- it is NOT one of
A8's real production result consumers (routes/solveHistory.ts,
routes/scenarios.ts's export paths), and must never be treated as one; it
never sees a stored/cached/published result, only solve.py's raw stdout
envelope for one just-run process. Hardened here so it stops silently
DISCARDING evidence: `quality` (present on every envelope since G2.1, never
copied through until now) is now explicit, and -- more durably -- any
top-level envelope key this function doesn't already know how to rename/
derive (i.e. anything other than edges/metrics/details, which ARE consumed
into derived fields below) passes through under its own name automatically.
Before this, a future top-level evidence field solve.py's `_envelope()`
adds (e.g. a later configuredGap/configuredTimeLimitSec per spec §2.12)
would vanish here unless someone remembered to extend this hand-picked
field list in lockstep -- exactly the silent-discard failure mode this task
exists to close."""


def flatten_envelope(env: dict) -> dict:
    if "edges" not in env:
        return env  # already flat (e.g. the {"status":"error",...} subprocess-failure shape)
    metrics = env.get("metrics") or {}
    details = env.get("details") or {}
    flattened = {
        "status": env.get("status"),
        "solutionStatus": env.get("solutionStatus"),
        "terminationReason": env.get("terminationReason"),
        "achievedGap": env.get("achievedGap"),
        "solverIncumbentObjective": env.get("solverIncumbentObjective"),
        "solverBestBound": env.get("solverBestBound"),
        "openWarehouseIds": details.get("openWarehouseIds", []),
        "assignments": details.get("assignments", []),
        "objective": env.get("objective", 0),
        "weightedAvgDistanceMi": metrics.get("weightedAvgDistance", 0),
        "bandCoverage": metrics.get("bandCoverage", []),
        "utilization": metrics.get("utilizationByNode", []),
        "runTimeSec": env.get("runTimeSec", 0),
        "quality": env.get("quality"),
        "solverUsed": env.get("solverUsed"),
        "infeasibilityReason": env.get("infeasibilityReason"),
    }
    # Forward-compatible passthrough (A8) -- see the module docstring. Only
    # `edges`/`metrics`/`details` are genuinely CONSUMED (folded into derived
    # fields above); every other raw top-level key -- known today or added
    # to solve.py's envelope later -- survives under its own name.
    for key, value in env.items():
        if key in ("edges", "metrics", "details"):
            continue
        flattened.setdefault(key, value)
    return flattened
