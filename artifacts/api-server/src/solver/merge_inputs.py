"""SCN v0.3 Phase B, task B1.3 - id<->index bridge for p-median-us.

`p-median-us` is the sole index-keyed dataset among the four models (DD-2's
correction, verified directly against solve.py): `WAREHOUSES`/`CUSTOMERS`
are `{int_index: {..., "id": str, ...}}` and `DISTANCE` is
`{(int_wh_index, int_cust_index): float}`. Scenario-local network edits
(`addedWarehouses`/`addedCustomers`/`distanceOverrides`, B1.1) are ID-keyed
at the API boundary - students think in IDs, not the dataset's internal
integer indices - so this module is the one place that translates between
the two, rather than every call site doing it ad hoc.

Scope boundary: this is the bridge only. It does not load a dataset, does
not merge distance overrides into `DISTANCE`, and does not append added
entities into `WAREHOUSES`/`CUSTOMERS` - that's B3.1's job
(`load_dataset -> apply overrides -> append added entities`), which will
import `resolve_pmedian_ids_to_indices` from here rather than re-deriving
id<->index resolution itself.

B3.1 adds `build_merged_pmedian_dataset` below: the actual merge pipeline
(`apply distance overrides -> append added entities`, on top of a caller-
supplied base dataset - "load_dataset" itself stays solve.py's job, since
that's already handled by its own module-level load block). Consumed by
`solve_pmedian` in `solve.py` as a per-call, non-mutating drop-in for its
`WAREHOUSES`/`CUSTOMERS`/`DISTANCE` module globals.
"""
from __future__ import annotations

from typing import Any


class UnresolvableIdError(ValueError):
    """Raised when a distanceOverride's fromId does not resolve as a
    warehouse id, or its toId does not resolve as a customer id - whether
    because the id doesn't exist anywhere (neither the base dataset nor
    this scenario's own added entities), or because it exists but only in
    the OTHER role (e.g. a backwards override passing a customer id as
    fromId). Never silently coerced to a wrong/garbage index - B2.1's
    precheck service is the primary place this gets caught before a solve
    is even attempted, but this function must not paper over it either."""


def _resolve_as(entity_id: str, role: str, id_to_index: dict) -> int:
    """Resolve entity_id strictly within one role's id space (warehouse OR
    customer - never "whichever space happens to contain it"). Fix for a
    real review-confirmed bug: probing both maps and returning whichever
    matched let a backwards override (fromId=a customer id, toId=a
    warehouse id) silently resolve to a structurally valid-looking
    (int, int) tuple - e.g. {fromId: "C1", toId: "ALN"} produced (1, 1),
    the SAME key as the real ALN->C1 distance, silently corrupting it once
    merged into DISTANCE. distanceOverrides is a warehouse->customer pair
    by definition (it mirrors DISTANCE's own (warehouse_idx, customer_idx)
    shape), not a generic "any two ids" pair, so fromId must resolve as a
    warehouse and toId must resolve as a customer - even if the id happens
    to also be valid in the other role."""
    if entity_id in id_to_index:
        return id_to_index[entity_id]
    raise UnresolvableIdError(
        f"distanceOverrides references id '{entity_id}' that does not resolve as a {role} - "
        f"not found among {role} ids in the base p-median-us dataset or this scenario's "
        "added entities"
    )


def resolve_pmedian_ids_to_indices(
    inputs: dict[str, Any],
    warehouses: dict[int, dict],
    customers: dict[int, dict],
) -> dict[str, Any]:
    """Build the id<->index bridge for p-median-us's scenario-local network
    edits.

    Args:
        inputs: the validated `inputs` blob (or any dict exposing the same
            keys) containing `addedWarehouses`, `addedCustomers`,
            `distanceOverrides` (B1.1's schema). All three are optional -
            missing keys are treated as empty lists.
        warehouses: base dataset, `solve.py`'s `WAREHOUSES`-shaped
            `{int_index: {"id": str, ...}}`. Never mutated.
        customers: base dataset, `solve.py`'s `CUSTOMERS`-shaped
            `{int_index: {"id": str, ...}}`. Never mutated.

    Returns a dict:
        warehouseIdToIndex: id -> index, covering base warehouses AND any
            addedWarehouses (each assigned a synthetic index).
        customerIdToIndex: same, for customers.
        addedWarehouseIndices: id -> synthetic index, addedWarehouses only
            (subset of warehouseIdToIndex - lets a caller distinguish "this
            id is new" from "this id was already in the base dataset").
        addedCustomerIndices: id -> synthetic index, addedCustomers only.
        distanceOverridesByIndex: DISTANCE-shaped `{(int, int): float}`,
            each distanceOverride's (fromId, toId) resolved through the
            (base + added) reverse maps. A later step (B3.1) merges this
            over the base DISTANCE dict.

    Raises:
        UnresolvableIdError: a distanceOverride's fromId does not resolve
            as a warehouse id, or its toId does not resolve as a customer
            id (checked against the base dataset + this scenario's own
            added entities only - never against the other role, so a
            backwards override can't silently produce a coincidentally
            valid-looking index pair).
    """
    added_warehouses = inputs.get("addedWarehouses", []) or []
    added_customers = inputs.get("addedCustomers", []) or []
    distance_overrides = inputs.get("distanceOverrides", []) or []

    # Fresh reverse maps built from the base dataset - warehouses.json/
    # customers.json's real string id, nested inside each index-keyed
    # value. Copied (not aliased) so extending with added entities below
    # never mutates a caller-owned dict.
    warehouse_id_to_index = {wh["id"]: idx for idx, wh in warehouses.items()}
    customer_id_to_index = {c["id"]: idx for idx, c in customers.items()}

    # Synthetic indices: max existing + 1, +2, ... per entity type. Warehouse
    # and customer indices are independent spaces (DISTANCE's key is a
    # positional (wh_index, cust_index) tuple, not a shared namespace), so
    # each gets its own counter - only intra-type collisions matter.
    next_warehouse_index = max(warehouses.keys(), default=0) + 1
    added_warehouse_indices: dict[str, int] = {}
    for wh in added_warehouses:
        wid = wh["id"]
        added_warehouse_indices[wid] = next_warehouse_index
        warehouse_id_to_index[wid] = next_warehouse_index
        next_warehouse_index += 1

    next_customer_index = max(customers.keys(), default=0) + 1
    added_customer_indices: dict[str, int] = {}
    for c in added_customers:
        cid = c["id"]
        added_customer_indices[cid] = next_customer_index
        customer_id_to_index[cid] = next_customer_index
        next_customer_index += 1

    distance_overrides_by_index: dict[tuple[int, int], float] = {}
    for override in distance_overrides:
        # Direction is meaningful, not incidental: distanceOverrides mirrors
        # DISTANCE's own (warehouse_idx, customer_idx) key shape, so fromId
        # must resolve as a warehouse and toId must resolve as a customer -
        # each checked against its own role's map only.
        from_index = _resolve_as(override["fromId"], "warehouse", warehouse_id_to_index)
        to_index = _resolve_as(override["toId"], "customer", customer_id_to_index)
        distance_overrides_by_index[(from_index, to_index)] = override["distance"]

    return {
        "warehouseIdToIndex": warehouse_id_to_index,
        "customerIdToIndex": customer_id_to_index,
        "addedWarehouseIndices": added_warehouse_indices,
        "addedCustomerIndices": added_customer_indices,
        "distanceOverridesByIndex": distance_overrides_by_index,
    }


def build_merged_pmedian_dataset(
    inputs: dict[str, Any],
    warehouses: dict[int, dict],
    customers: dict[int, dict],
    distance: dict[tuple[int, int], float],
) -> dict[str, Any]:
    """B3.1: `load_dataset -> apply distance overrides -> append added
    entities`, producing merged WAREHOUSES-shaped, CUSTOMERS-shaped, and
    DISTANCE-shaped structures `solve_pmedian` can use as drop-in
    replacements for its module-level globals.

    Per-call, non-mutating: `warehouses`/`customers`/`distance` (the caller's
    base dataset - solve.py's own module-level WAREHOUSES/CUSTOMERS/DISTANCE
    globals) are never written to. Every scenario's `inputs` gets its own
    fresh merged copy, so concurrent solves for other scenarios never see
    one scenario's added entities or distance overrides.

    Args:
        inputs: the validated `inputs` blob (or any dict exposing the same
            keys) containing `addedWarehouses`, `addedCustomers`,
            `distanceOverrides` (B1.1's schema). All three optional, missing
            keys treated as empty lists (same contract as
            `resolve_pmedian_ids_to_indices`, which this calls internally).
        warehouses: base dataset, `solve.py`'s `WAREHOUSES`-shaped
            `{int_index: {"id": str, "city": str, "state": str, "lat":
            float, "lng": float}}`. Never mutated.
        customers: base dataset, `solve.py`'s `CUSTOMERS`-shaped
            `{int_index: {"id": str, "city": str, "state": str, "lat":
            float, "lng": float, "demand": float}}`. Never mutated.
        distance: base dataset, `solve.py`'s `DISTANCE`-shaped
            `{(int_wh_index, int_cust_index): float}`. Never mutated.

    Returns a dict:
        warehouses: `{**warehouses}` plus one entry per `addedWarehouses`
            item at its synthetic index, shaped like an existing
            `warehouses` value (`id`/`city`/`state`/`lat`/`lng` - no
            `capacity`/`status` key, matching the base shape exactly; those
            live in `addedWarehousesById` below instead, since base
            warehouses don't carry them in this dict either - they come
            from solve_pmedian's separate sparse `warehouseCapacities`/
            `warehouseStatuses` override maps).
        customers: same pattern for `addedCustomers`, shaped like an
            existing `customers` value including `demand` (added customers
            DO carry `demand` directly on this dict, unlike warehouses -
            matches B1.1's schema, where `addedCustomerSchema` has no
            separate status/capacity-style sparse-override sibling for
            demand the way warehouses do).
        distance: `{**distance, **<resolved distanceOverridesByIndex>}` -
            the override pairs simply overlay the base dict. This is also
            how an added entity gets ANY distance at all (L4: no
            auto-haversine for added entities - an override IS the
            mechanism, not a separate one).
        addedWarehousesById: `{id: <raw addedWarehouses entry>}` - lets
            `solve_pmedian` resolve an added warehouse's OWN `capacity`/
            `status` (present directly on its `addedWarehouses` record,
            per B1.1's schema) without conflating it with the sparse
            `warehouseCapacities`/`warehouseStatuses` override maps that
            apply to BASE warehouses only. Mirrors B2.1's `precheckPMedianInputs`
            precedent exactly: its own completeness check already treats an
            added warehouse's active/inactive status as coming solely from
            `addedWarehouses[].status`, never layered with
            `warehouseOverrides` - there is no design for a base-style
            override to also apply on top of an added entity's own record.
        addedCustomersById: `{id: <raw addedCustomers entry>}` - same
            reasoning for `demand`, mirroring `precheckPMedianInputs`'s own
            `activeAddedCustomerIds` (unconditionally every added customer,
            never filtered by `customerOverrides`).

    Raises:
        UnresolvableIdError: propagated from `resolve_pmedian_ids_to_indices`
            - a `distanceOverrides` entry references an id that isn't a
            known warehouse (fromId) or customer (toId), base or added.
    """
    bridge = resolve_pmedian_ids_to_indices(inputs, warehouses, customers)

    added_warehouses = inputs.get("addedWarehouses", []) or []
    added_customers = inputs.get("addedCustomers", []) or []

    merged_warehouses = dict(warehouses)
    added_warehouses_by_id: dict[str, dict] = {}
    for wh in added_warehouses:
        idx = bridge["addedWarehouseIndices"][wh["id"]]
        merged_warehouses[idx] = {
            "id": wh["id"],
            "city": wh["city"],
            "state": wh["state"],
            "lat": wh["lat"],
            "lng": wh["lng"],
        }
        added_warehouses_by_id[wh["id"]] = wh

    merged_customers = dict(customers)
    added_customers_by_id: dict[str, dict] = {}
    for c in added_customers:
        idx = bridge["addedCustomerIndices"][c["id"]]
        merged_customers[idx] = {
            "id": c["id"],
            "city": c["city"],
            "lat": c["lat"],
            "lng": c["lng"],
            "demand": c["demand"],
        }
        added_customers_by_id[c["id"]] = c

    merged_distance = {**distance, **bridge["distanceOverridesByIndex"]}

    return {
        "warehouses": merged_warehouses,
        "customers": merged_customers,
        "distance": merged_distance,
        "addedWarehousesById": added_warehouses_by_id,
        "addedCustomersById": added_customers_by_id,
    }


def build_merged_brazil_dataset(
    inputs: dict[str, Any],
    warehouses: dict[str, dict],
    regions: dict[str, dict],
    distance: dict[tuple[str, str], float],
) -> dict[str, Any]:
    """B6.3: `p-median-brazil`'s own `load_dataset -> apply distance
    overrides -> append added entities` pipeline, consumed by
    `solve_capacitated_pmedian` in solve.py as a per-call, non-mutating
    drop-in for its `BRAZIL_WAREHOUSES`/`BRAZIL_REGIONS`/`_brazil_distances()`
    module-level data.

    Deliberately NOT a generalization of `build_merged_pmedian_dataset`
    above, nor built by parameterizing that function - it exists
    specifically to do the id<->index bridge (B1.3's whole point, since
    p-median-us's WAREHOUSES/CUSTOMERS/DISTANCE are index-keyed, DD-2's
    correction). `p-median-brazil` is already ID-keyed end to end
    (`BRAZIL_WAREHOUSES`/`BRAZIL_REGIONS` are `{str_id: {...}}`,
    `_brazil_distances()` is `{(str_wh_id, str_region_id): float}`) - there
    is no index to bridge to, so a shared "generalized" merge would need a
    conditional bridge-or-not branch purely to serve the one caller (Brazil)
    that never needs the branch taken. Simpler to keep this as its own
    function: a plain dict merge, reusing only what's genuinely shared with
    the p-median-us pipeline - the shape of the merge itself
    (`{**base, **added}` for entities, `{**base, **overrides}` for
    distance) and `UnresolvableIdError` for reference-integrity failures.

    Args:
        inputs: the validated `inputs` blob (or any dict exposing the same
            keys) containing `addedWarehouses`, `addedCustomers`,
            `distanceOverrides` (B1.1's schema, shared with p-median-us).
            All three optional, missing keys treated as empty lists.
        warehouses: base dataset, `solve.py`'s `BRAZIL_WAREHOUSES`-shaped
            `{str_id: {"id": str, "city": str, "state": str, "lat": float,
            "lng": float}}`. Never mutated.
        regions: base dataset, `solve.py`'s `BRAZIL_REGIONS`-shaped
            `{str_id: {"id": str, "name": str, "lat": float, "lng": float,
            "demand": float}}`. Never mutated.
        distance: base dataset, `solve.py`'s `_brazil_distances()`-shaped
            `{(str_wh_id, str_region_id): float}`. Never mutated.

    Returns a dict:
        warehouses: `{**warehouses}` plus one entry per `addedWarehouses`
            item keyed by its own id (no synthetic index needed - the id
            IS the key), shaped like an existing `warehouses` value.
        regions: same pattern for `addedCustomers`, shaped like an existing
            `regions` value - `addedCustomers`' `city` field becomes this
            shape's `name` field (`BRAZIL_REGIONS` has no separate `city`
            key, only `name`), and `demand` carries straight through (same
            as p-median-us's `addedCustomersById` treatment).
        distance: `{**distance, **<resolved overrides>}` - each
            `distanceOverrides` entry's `(fromId, toId)` pair used directly
            as the merged dict's key (no index resolution - the pair
            already matches `distance`'s own key shape). Also how an added
            entity gets any distance at all (same L4 precedent as
            p-median-us: an override IS the mechanism, no auto-haversine).
        addedWarehousesById: `{id: <raw addedWarehouses entry>}` - lets
            `solve_capacitated_pmedian` resolve an added warehouse's own
            `status` (forced_open/inactive) without a base-warehouse-style
            sparse override map (p-median-brazil has none - D1.1's
            per-warehouse override tables were never built for this model).
        addedCustomersById: `{id: <raw addedCustomers entry>}` - same
            reasoning, unused by solve_capacitated_pmedian today (an added
            region's demand is read straight off the merged `regions` dict
            instead, mirroring how base regions' demand is already read)
            but included for parity with `build_merged_pmedian_dataset`'s
            return shape.

    Raises:
        UnresolvableIdError: a `distanceOverrides` entry's `fromId` is not a
            known warehouse id (base or added), or `toId` is not a known
            region id (base or added) - checked strictly per role, same
            backwards-pair protection as `resolve_pmedian_ids_to_indices`.
    """
    added_warehouses = inputs.get("addedWarehouses", []) or []
    added_customers = inputs.get("addedCustomers", []) or []
    distance_overrides = inputs.get("distanceOverrides", []) or []

    merged_warehouses = dict(warehouses)
    added_warehouses_by_id: dict[str, dict] = {}
    for wh in added_warehouses:
        wid = wh["id"]
        merged_warehouses[wid] = {
            "id": wid,
            "city": wh["city"],
            "state": wh["state"],
            "lat": wh["lat"],
            "lng": wh["lng"],
        }
        added_warehouses_by_id[wid] = wh

    merged_regions = dict(regions)
    added_customers_by_id: dict[str, dict] = {}
    for c in added_customers:
        cid = c["id"]
        merged_regions[cid] = {
            "id": cid,
            "name": c["city"],
            "lat": c["lat"],
            "lng": c["lng"],
            "demand": c["demand"],
        }
        added_customers_by_id[cid] = c

    merged_distance = dict(distance)
    for override in distance_overrides:
        from_id, to_id = override["fromId"], override["toId"]
        if from_id not in merged_warehouses:
            raise UnresolvableIdError(
                f"distanceOverrides references id '{from_id}' that does not resolve as a "
                "warehouse - not found among warehouse ids in the base p-median-brazil "
                "dataset or this scenario's added entities"
            )
        if to_id not in merged_regions:
            raise UnresolvableIdError(
                f"distanceOverrides references id '{to_id}' that does not resolve as a "
                "customer - not found among customer ids in the base p-median-brazil "
                "dataset or this scenario's added entities"
            )
        merged_distance[(from_id, to_id)] = override["distance"]

    return {
        "warehouses": merged_warehouses,
        "regions": merged_regions,
        "distance": merged_distance,
        "addedWarehousesById": added_warehouses_by_id,
        "addedCustomersById": added_customers_by_id,
    }


def build_merged_transport_dataset(
    inputs: dict[str, Any],
    mines: dict[str, dict],
    stations: dict[str, dict],
    distance: dict[tuple[str, str], float],
) -> dict[str, Any]:
    """B6.1: `transport-coal`'s own `load_dataset -> apply lane-cost
    overrides -> append added entities` pipeline, consumed by
    `solve_transport` in solve.py as a per-call, non-mutating drop-in for
    its `COAL_MINES`/`POWER_STATIONS`/`_transport_distances()` module-level
    data.

    Deliberately NOT built by forcing this through `build_merged_pmedian_
    dataset` (p-median-specific, owns the id<->index bridge transport-coal
    doesn't need) or by generalizing it — same rationale as
    `build_merged_brazil_dataset`: `transport-coal` is already ID-keyed end
    to end (`COAL_MINES`/`POWER_STATIONS` are `{str_id: {...}}`,
    `_transport_distances()` is `{(str_mine_id, str_station_id): float}`),
    DD-2's correction, so there is no index to bridge to. Only genuinely
    shared code is reused: the merge shape itself (`{**base, **added}` for
    entities, `{**base, **overrides}` for distance) and
    `UnresolvableIdError` for reference-integrity failures.

    Args:
        inputs: the validated `inputs` blob (or any dict exposing the same
            keys) containing `addedMines`, `addedStations`,
            `laneCostOverrides` (transportLp.ts's B6.1 schema). All three
            optional, missing keys treated as empty lists.
        mines: base dataset, `solve.py`'s `COAL_MINES`-shaped
            `{str_id: {"id": str, "name": str, "city": str, "state": str,
            "lat": float, "lng": float, "capacity": float}}`. Never
            mutated.
        stations: base dataset, `solve.py`'s `POWER_STATIONS`-shaped
            `{str_id: {"id": str, "city": str, "state": str, "lat": float,
            "lng": float, "demand": float}}`. Never mutated.
        distance: base dataset, `solve.py`'s `_transport_distances()`-shaped
            `{(str_mine_id, str_station_id): float}` — despite the name
            "distance", this is the same object `solve_transport` calls its
            lane cost matrix (see transportLp.ts's header comment: the
            values are real geographic distances in miles, but the model's
            own vocabulary for this arc data — and this task's schema field
            name — is "lane cost", matching costs.json). Never mutated.

    Returns a dict:
        mines: `{**mines}` plus one entry per `addedMines` item keyed by its
            own id (no synthetic index needed - the id IS the key), shaped
            like an existing `mines` value INCLUDING `capacity` (unlike
            p-median's merged warehouses dict, which omits capacity/status
            entirely — base `COAL_MINES` rows already carry `capacity`
            directly, since `solve_transport` reads
            `COAL_MINES[m]['capacity']` as its own fallback, not a separate
            sparse-override-only mechanism the way p-median's warehouses
            do). An added mine with no `capacity` given merges with
            `capacity: None` (unconstrained supply — `solve_transport`
            must treat `None` as "no capacity constraint for this mine",
            mirroring p-median's own None-means-unconstrained convention).
        stations: same pattern for `addedStations`, shaped like an existing
            `stations` value including `demand` (added stations DO carry
            `demand` directly, same as p-median's added customers).
        distance: `{**distance, **<resolved lane cost overrides>}` - the
            override pairs simply overlay the base dict. This is also how
            an added entity gets ANY lane cost at all (L4: no auto-
            haversine for added entities - an override IS the mechanism,
            not a separate one).
        addedMinesById: `{id: <raw addedMines entry>}` - lets
            `solve_transport` resolve an added mine's OWN `capacity`
            without conflating it with the sparse `mineCapacities` override
            map that applies to BASE mines only (mirrors B3.1/B6.3's
            established "added entity's own record wins" precedent). Note:
            unlike p-median's added warehouses, there is no `status` here
            at all - mines have no forced-open/inactive concept anywhere in
            this LP (verified against solve_transport and mines.json - no
            status column, no status-bound constraint).
        addedStationsById: `{id: <raw addedStations entry>}` - same
            reasoning for `demand`, mirroring the sparse `stationDemands`
            override map's "applies to BASE stations only" boundary.

    Raises:
        UnresolvableIdError: a `laneCostOverrides` entry's `fromId` is not a
            known mine id (base or added), or `toId` is not a known station
            id (base or added) - checked strictly per role, same backwards-
            pair protection as `resolve_pmedian_ids_to_indices`/
            `build_merged_brazil_dataset`.
    """
    added_mines = inputs.get("addedMines", []) or []
    added_stations = inputs.get("addedStations", []) or []
    lane_cost_overrides = inputs.get("laneCostOverrides", []) or []

    merged_mines = dict(mines)
    added_mines_by_id: dict[str, dict] = {}
    for m in added_mines:
        mid = m["id"]
        merged_mines[mid] = {
            "id": mid,
            "city": m["city"],
            "state": m["state"],
            "lat": m["lat"],
            "lng": m["lng"],
            "capacity": m.get("capacity"),
        }
        added_mines_by_id[mid] = m

    merged_stations = dict(stations)
    added_stations_by_id: dict[str, dict] = {}
    for s in added_stations:
        sid = s["id"]
        merged_stations[sid] = {
            "id": sid,
            "city": s["city"],
            "state": s["state"],
            "lat": s["lat"],
            "lng": s["lng"],
            "demand": s["demand"],
        }
        added_stations_by_id[sid] = s

    merged_distance = dict(distance)
    for override in lane_cost_overrides:
        from_id, to_id = override["fromId"], override["toId"]
        if from_id not in merged_mines:
            raise UnresolvableIdError(
                f"laneCostOverrides references id '{from_id}' that does not resolve as a "
                "mine - not found among mine ids in the base transport-coal dataset or "
                "this scenario's added entities"
            )
        if to_id not in merged_stations:
            raise UnresolvableIdError(
                f"laneCostOverrides references id '{to_id}' that does not resolve as a "
                "station - not found among station ids in the base transport-coal "
                "dataset or this scenario's added entities"
            )
        merged_distance[(from_id, to_id)] = override["cost"]

    return {
        "mines": merged_mines,
        "stations": merged_stations,
        "distance": merged_distance,
        "addedMinesById": added_mines_by_id,
        "addedStationsById": added_stations_by_id,
    }
