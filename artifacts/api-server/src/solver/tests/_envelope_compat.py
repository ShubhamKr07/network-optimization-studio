"""G2.1 wrapped solve.py's output in a standardized envelope ({status,
objective, edges, metrics, details, ...}). These test files assert on
solver *math* (objective/assignment values), not the wire shape — that's
resultEnvelope.ts's own Zod-validated DoD — so flatten back to the
pre-envelope shape once here (mirrors pmedian.ts's envelopeToLegacy() shim)
instead of touching every assertion in every test file. Per that task's
documented exception, only paths change here, not any expected numeric
value."""


def flatten_envelope(env: dict) -> dict:
    if "edges" not in env:
        return env  # already flat (e.g. the {"status":"error",...} subprocess-failure shape)
    metrics = env.get("metrics") or {}
    details = env.get("details") or {}
    return {
        "status": env.get("status"),
        "openWarehouseIds": details.get("openWarehouseIds", []),
        "assignments": details.get("assignments", []),
        "objective": env.get("objective", 0),
        "weightedAvgDistanceMi": metrics.get("weightedAvgDistance", 0),
        "bandCoverage": metrics.get("bandCoverage", []),
        "utilization": metrics.get("utilizationByNode", []),
        "runTimeSec": env.get("runTimeSec", 0),
        "solverUsed": env.get("solverUsed"),
        "infeasibilityReason": env.get("infeasibilityReason"),
    }
