# translate.py
"""API-schema -> solve.py wire-format translation for the benchmark harness.

`corpus/manifest.json`'s cases carry API-schema inputs -- the SAME shape
`solvers/<model_id>/manifest.json`'s `inputsSchema` validates and the studio
frontend sends (e.g. `p`, `warehouseOverrides`, `customerOverrides`,
`distanceOverrides`). `solve.py`'s dispatcher and `solve_*` functions read a
different, internal "wire" dict (e.g. `pValue`, `warehouseCapacities`,
`customerDemands`, `warehouseStatuses`). In production this translation is
done once, at the route layer, by
`artifacts/api-server/src/solver/pmedian.ts`'s `buildPayload` (TS) before
`jobRunner.ts` pipes the result to `solve.py`'s stdin.

`measure.py`'s `_default_solve` previously called `solve.solve(inp)`
DIRECTLY on a case's raw API-schema inputs, skipping this translation --
harmless for the fast fake-`solve_fn`-driven unit suite (which never reaches
solve.py at all), but wrong for a real campaign, which needs solve.py to
receive the same shape it gets in production.

`to_solver_input(model_id, api_inputs)` is this module's one entry point: a
pure, dependency-free (no TS/node needed) Python mirror of `buildPayload`,
one branch per model exactly like `buildPayload` itself, since each model's
reshape rules (or lack of any) are genuinely different -- verified per model
directly against `solve.py`'s own `inp.get(...)` reads (`solve_pmedian`,
`solve_transport`, `solve_capacitated_pmedian`, `solve_two_echelon`,
`solve_jade`, `solve_chens`) and each model's `validation/inputs/*.ts`
schema, not assumed to generalize. Two models (`transport-coal`,
`chens-cosmetics-cn`) turn out to need no real reshaping at all -- their
API-schema field names ARE solve.py's wire keys verbatim; those branches
exist only to add the `modelType` dispatch key and are documented as such
below, per M1.6's task 2 instruction not to add needless translation.

This module deliberately does NOT do id<->index bridging (B1.3): that
bridge lives entirely inside `merge_inputs.py`'s `build_merged_pmedian_dataset`,
called BY `solve_pmedian` itself once it already has wire-format input --
this module's job stops at producing the same wire dict `buildPayload`
would have produced; everything downstream of that point runs unmodified,
real `solve.py`/`merge_inputs.py` code, same as production.
"""
import json
from functools import lru_cache
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    p = Path(__file__).resolve()
    return next(parent for parent in p.parents if (parent / "pnpm-workspace.yaml").exists())


@lru_cache(maxsize=None)
def _capabilities(model_id: str) -> dict:
    manifest_path = _repo_root() / "solvers" / model_id / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    return manifest.get("capabilities", {})


def _supports_added_customer_exclusion(model_id: str) -> bool:
    # Mirrors buildPayload's capability-gate pattern exactly (pmedian.ts,
    # read from the registry/manifest, never hardcoded per model_id) --
    # true for p-median-us / two-echelon-gold-au / two-echelon-jade-us /
    # chens-cosmetics-cn, false for p-median-brazil, absent (falsy) for
    # transport-coal (no added-customer-exclusion concept there at all).
    return bool(_capabilities(model_id).get("supportsAddedCustomerExclusion", False))


def to_solver_input(model_id: str, api_inputs: dict[str, Any]) -> dict[str, Any]:
    """Translate one model's API-schema `inputs` dict into solve.py's wire
    dict. `api_inputs` may carry an extraneous `modelType` key (the corpus's
    own wire-format dispatch tag, bolted onto cases for `corpus.py`'s
    validation -- NOT part of any real `*InputsSchema`); it is ignored here,
    since the correct wire `modelType` is derived from `model_id` below,
    exactly as `buildPayload` derives it from `input.modelId`.
    """
    i = api_inputs
    if model_id == "transport-coal":
        return _translate_transport(i)
    if model_id == "two-echelon-gold-au":
        return _translate_two_echelon_gold(model_id, i)
    if model_id == "two-echelon-jade-us":
        return _translate_two_echelon_jade(model_id, i)
    if model_id == "chens-cosmetics-cn":
        return _translate_chens(i)
    if model_id in ("p-median-us", "p-median-brazil"):
        return _translate_pmedian(model_id, i)
    raise ValueError(f"translate.to_solver_input: unknown model_id {model_id!r}")


def _translate_transport(i: dict[str, Any]) -> dict[str, Any]:
    # transportLpInputsSchema (transportLp.ts) already speaks solve_transport's
    # wire keys verbatim -- capacityFactor/singleSource/capacityInactive/
    # mineCapacities/stationDemands/addedMines/addedStations/
    # laneCostOverrides are top-level API-schema fields with the SAME names
    # solve_transport's `inp.get(...)` reads (verified directly against
    # solve.py). buildPayload's transport-coal block (pmedian.ts) does this
    # exact same no-op passthrough, only adding `modelType`.
    return {
        "modelType": "transport",
        "distanceBands": i.get("distanceBands", []),
        "gap": i.get("gap", 0.0),
        "timeLimitSec": i.get("timeLimitSec", 120),
        "capacityFactor": i.get("capacityFactor", 1.0),
        "singleSource": i.get("singleSource", False),
        "capacityInactive": i.get("capacityInactive", False),
        "mineCapacities": i.get("mineCapacities") or {},
        "stationDemands": i.get("stationDemands") or {},
        "addedMines": i.get("addedMines", []),
        "addedStations": i.get("addedStations", []),
        "laneCostOverrides": i.get("laneCostOverrides", []),
    }


def _translate_two_echelon_gold(model_id: str, i: dict[str, Any]) -> dict[str, Any]:
    added_customers = i.get("addedCustomers", [])
    supports_exclusion = _supports_added_customer_exclusion(model_id)
    excluded_customer_ids = [
        o["id"] for o in i.get("customerOverrides", []) if o.get("status") == "excluded"
    ] + (
        [c["id"] for c in added_customers if c.get("status") == "excluded"]
        if supports_exclusion else []
    )
    return {
        "modelType": "two_echelon",
        "bomRatio": i.get("bomRatio"),
        "refineryStatuses": [
            {"refineryId": o["id"], "status": o["status"]}
            for o in i.get("refineryOverrides", []) if o.get("status") != "active"
        ],
        "excludedCustomerIds": excluded_customer_ids,
        "customerDemands": {
            o["id"]: o["demand"]
            for o in i.get("customerOverrides", [])
            if o.get("demand") is not None
        },
        "distanceBands": i.get("distanceBands", []),
        "gap": i.get("gap", 0.0),
        "timeLimitSec": i.get("timeLimitSec", 120),
        "addedRefineries": i.get("addedRefineries", []),
        "addedCustomers": added_customers,
        "distanceOverrides": i.get("distanceOverrides", []),
    }


def _translate_two_echelon_jade(model_id: str, i: dict[str, Any]) -> dict[str, Any]:
    added_customers = i.get("addedCustomers", [])
    supports_exclusion = _supports_added_customer_exclusion(model_id)
    excluded_customer_ids = [
        o["id"] for o in i.get("customerOverrides", []) if o.get("status") == "excluded"
    ] + (
        [c["id"] for c in added_customers if c.get("status") == "excluded"]
        if supports_exclusion else []
    )
    return {
        "modelType": "two_echelon_jade",
        "p": i.get("p"),
        "distanceBands": i.get("distanceBands", []),
        "gap": i.get("gap", 0.0),
        "timeLimitSec": i.get("timeLimitSec", 120),
        "warehouseStatuses": [
            {"warehouseId": o["id"], "status": o["status"]}
            for o in i.get("warehouseOverrides", []) if o.get("status") != "active"
        ],
        "excludedCustomerIds": excluded_customer_ids,
        # Sparse per-product override, keyed by customer id (solve_jade's
        # get_demands() layers this onto the base customer's own `demands`
        # dict) -- mirrors buildPayload's jade block exactly.
        "customerDemands": {
            o["id"]: o["demands"]
            for o in i.get("customerOverrides", [])
            if o.get("demands") is not None
        },
        # Wire name differs from the schema name on purpose (buildPayload's
        # own comment: this is exactly the translation boundary where a
        # schema name and a wire name are allowed to differ).
        "capabilityOverrides": i.get("plantProductCapability", []),
        "addedPlants": i.get("addedPlants", []),
        "addedWarehouses": i.get("addedWarehouses", []),
        "addedCustomers": added_customers,
        "distanceOverrides": i.get("distanceOverrides", []),
    }


def _translate_chens(i: dict[str, Any]) -> dict[str, Any]:
    # chensInputsSchema (chens.ts) is a direct-id passthrough (DD-2) --
    # solve_chens / build_merged_chens_dataset read `warehouseOverrides`,
    # `customerOverrides`, `addedWarehouses`, `addedCustomers`,
    # `distanceOverrides`, `objective`, `p`, `highServiceDistKm`,
    # `maxDistKm`, `avgServiceDistCapKm`, `coverageFloorDemand` under these
    # EXACT names (verified directly against solve.py, no `inp['pValue']`-
    # style renaming anywhere in solve_chens). buildPayload's
    # chens-cosmetics-cn block (pmedian.ts) does this same no-op passthrough,
    # only adding `modelType`. avgServiceDistCapKm/coverageFloorDemand are
    # objective-discriminated (present iff their mode) -- included only when
    # not None, same as buildPayload's own JSON.stringify-drops-undefined
    # behavior for those two fields.
    out: dict[str, Any] = {
        "modelType": "chens",
        "objective": i.get("objective"),
        "p": i.get("p"),
        "highServiceDistKm": i.get("highServiceDistKm"),
        "maxDistKm": i.get("maxDistKm"),
        "gap": i.get("gap", 0.0),
        "timeLimitSec": i.get("timeLimitSec", 120),
        "distanceBands": i.get("distanceBands", []),
        "warehouseOverrides": i.get("warehouseOverrides", []),
        "customerOverrides": i.get("customerOverrides", []),
        "addedWarehouses": i.get("addedWarehouses", []),
        "addedCustomers": i.get("addedCustomers", []),
        "distanceOverrides": i.get("distanceOverrides", []),
    }
    if i.get("avgServiceDistCapKm") is not None:
        out["avgServiceDistCapKm"] = i["avgServiceDistCapKm"]
    if i.get("coverageFloorDemand") is not None:
        out["coverageFloorDemand"] = i["coverageFloorDemand"]
    return out


def _translate_pmedian(model_id: str, i: dict[str, Any]) -> dict[str, Any]:
    # Shared by p-median-us AND p-median-brazil, mirroring buildPayload's own
    # shared p-median block (pmedian.ts) -- model_id only discriminates the
    # output `modelType` and the added-customer-exclusion capability gate.
    capacity_mode = i.get("capacityMode", "none")
    effective_capacity = None if capacity_mode == "none" else i.get("uniformCapacity")
    warehouse_statuses = [
        {"warehouseId": o["id"], "status": o["status"]}
        for o in i.get("warehouseOverrides", []) if o.get("status") != "active"
    ]
    added_customers = i.get("addedCustomers", [])
    supports_exclusion = _supports_added_customer_exclusion(model_id)
    excluded_customer_ids = [
        o["id"] for o in i.get("customerOverrides", []) if o.get("status") == "excluded"
    ] + (
        [c["id"] for c in added_customers if c.get("status") == "excluded"]
        if supports_exclusion else []
    )
    warehouse_capacities = {
        o["id"]: o["capacity"]
        for o in i.get("warehouseOverrides", [])
        if o.get("capacity") is not None and capacity_mode != "none"
    }
    customer_demands = {
        o["id"]: o["demand"]
        for o in i.get("customerOverrides", [])
        if o.get("demand") is not None
    }
    # Task 27: under capacityMode "none", an added warehouse's own `capacity`
    # is stripped, so "none" means no per-warehouse capacity constraint
    # reaches solve.py from ANY source -- mirrors buildPayload's own
    # addedWarehouses reshape exactly.
    added_warehouses = i.get("addedWarehouses", [])
    if capacity_mode == "none":
        added_warehouses = [{**w, "capacity": None} for w in added_warehouses]

    out: dict[str, Any] = {
        "modelType": "capacitated_pmedian" if model_id == "p-median-brazil" else "p_median",
        "pValue": i.get("p"),
        "distanceBands": i.get("distanceBands", []),
        "uniformCapacity": effective_capacity,
        "warehouseCapacities": warehouse_capacities,
        "customerDemands": customer_demands,
        "warehouseStatuses": warehouse_statuses,
        "excludedCustomerIds": excluded_customer_ids,
        "gap": i.get("gap", 0.0),
        "timeLimitSec": i.get("timeLimitSec", 120),
        "addedWarehouses": added_warehouses,
        "addedCustomers": added_customers,
        "distanceOverrides": i.get("distanceOverrides", []),
    }
    # warehouseCapacity: `effectiveCapacity ?? undefined` in buildPayload --
    # a JS `undefined` key is dropped by JSON.stringify before it ever
    # reaches solve.py's stdin, so solve_capacitated_pmedian's own
    # `inp.get('warehouseCapacity', 20_000_000)` default applies. Mirrored
    # here by omitting the key entirely rather than setting it to `None`
    # (which `int(...)` would reject) when there is no effective capacity.
    if effective_capacity is not None:
        out["warehouseCapacity"] = effective_capacity
    # singleSource: `i.singleSource` with no coalescing in buildPayload --
    # Brazil-only (solve_capacitated_pmedian defaults to True when absent);
    # p-median-us's solve_pmedian never reads this key at all. Omit when not
    # explicitly present in api_inputs, same undefined-drop reasoning as
    # warehouseCapacity above -- setting it to a Python `None` would make
    # `bool(None)` silently become False, corrupting Brazil's real default.
    if i.get("singleSource") is not None:
        out["singleSource"] = i["singleSource"]
    return out
