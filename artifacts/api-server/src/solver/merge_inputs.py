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


def build_merged_two_echelon_dataset(
    inputs: dict[str, Any],
    mines: dict[str, dict],
    refineries: dict[str, dict],
    customers: dict[str, dict],
    distance: dict[tuple[str, str], float],
) -> dict[str, Any]:
    """B6.2: `two-echelon-gold-au`'s own `load_dataset -> apply distance
    overrides -> append added entities` pipeline, consumed by
    `solve_two_echelon` in solve.py as a per-call, non-mutating drop-in for
    its `GOLD_REFINERIES`/`GOLD_CUSTOMERS`/`_gold_distances()` module-level
    data.

    Own function, not forced through `build_merged_pmedian_dataset` (owns the
    id<->index bridge this model doesn't need) or `build_merged_transport_
    dataset`/`build_merged_brazil_dataset` (both two-entity-type merges) —
    two-echelon-gold-au is already ID-keyed end to end (DD-2), like Brazil/
    transport-coal, but has a genuinely different shape: THREE entity types
    (mines/refineries/customers, not two) and TWO legs sharing one flat
    distance dict, not one. `mines` is a parameter purely for the leg-
    resolution check below — there is no `addedMines` concept at all (the
    mine is fixed, never overridable) and `mines` is never merged/returned.

    Args:
        inputs: the validated `inputs` blob (or any dict exposing the same
            keys) containing `addedRefineries`, `addedCustomers`,
            `distanceOverrides` (twoEchelon.ts's B6.2 schema). All three
            optional, missing keys treated as empty lists.
        mines: base dataset, `solve.py`'s `GOLD_MINES`-shaped
            `{str_id: {"id": str, "city": str, "state": str, "lat": float,
            "lng": float}}`. Never mutated, never merged (no addedMines).
        refineries: base dataset, `solve.py`'s `GOLD_REFINERIES`-shaped
            `{str_id: {...}}`. Never mutated.
        customers: base dataset, `solve.py`'s `GOLD_CUSTOMERS`-shaped
            `{str_id: {..., "demand": float}}`. Never mutated.
        distance: base dataset, `solve.py`'s `_gold_distances()`-shaped
            `{(str_from_id, str_to_id): float}` — ONE dict covering BOTH the
            mine->refinery leg and the refinery->customer leg (verified
            directly against solve_two_echelon's own `dist[p, r]`/
            `dist[r, c]` indexing, both drawn from this same dict). Never
            mutated.

    Returns a dict:
        refineries: `{**refineries}` plus one entry per `addedRefineries`
            item keyed by its own id (no synthetic index needed), shaped
            like an existing `refineries` value — no `status` key (that
            lives in `addedRefineriesById` below instead, matching the base
            refineries' own shape, which also carries no status — status
            comes from a separate sparse `refineryStatuses` override map for
            base refineries).
        customers: same pattern for `addedCustomers`, INCLUDING `demand`
            directly on the merged dict (mirrors `build_merged_pmedian_
            dataset`'s added customers, which also carry demand directly —
            unlike refineries' status, demand has no separate sparse-
            override-only mechanism to conflict with).
        distance: `{**distance, **<resolved distanceOverrides>}` — the
            override pairs simply overlay the base dict. This is also how an
            added entity gets ANY distance at all (L4: no auto-haversine —
            an override IS the mechanism). Each override's leg is resolved
            purely by which id-space `fromId`/`toId` belong to (mine/
            refinery/customer are three disjoint id sets) — NOT a string-
            prefix convention. A pair must cleanly match one of the two
            adjacent-leg shapes (mine->refinery, or refinery->customer);
            anything else (backwards, or skipping a leg entirely, e.g.
            mine->customer) raises UnresolvableIdError.
        addedRefineriesById: `{id: <raw addedRefineries entry>}` — lets
            `solve_two_echelon` resolve an added refinery's OWN `status`
            (forced_open/inactive/active) without conflating it with the
            sparse `refineryStatuses` override map that applies to BASE
            refineries only (mirrors B3.1/B6.1's established "added entity's
            own record wins" precedent) — an added refinery competing to be
            the single open one is a real, meaningful capability, not
            skipped for a first pass.
        addedCustomersById: `{id: <raw addedCustomers entry>}` — same
            reasoning for `demand`, mirroring the sparse `customerDemands`
            override map's "applies to BASE customers only" boundary.

    Raises:
        UnresolvableIdError: a `distanceOverrides` entry's `(fromId, toId)`
            pair does not resolve as a mine->refinery leg or a refinery->
            customer leg (base dataset or this scenario's added
            refineries/customers) — checked strictly per role, same
            backwards-pair protection as every other merge function above.
    """
    added_refineries = inputs.get("addedRefineries", []) or []
    added_customers = inputs.get("addedCustomers", []) or []
    distance_overrides = inputs.get("distanceOverrides", []) or []

    merged_refineries = dict(refineries)
    added_refineries_by_id: dict[str, dict] = {}
    for r in added_refineries:
        rid = r["id"]
        merged_refineries[rid] = {
            "id": rid,
            "city": r["city"],
            "state": r["state"],
            "lat": r["lat"],
            "lng": r["lng"],
        }
        added_refineries_by_id[rid] = r

    merged_customers = dict(customers)
    added_customers_by_id: dict[str, dict] = {}
    for c in added_customers:
        cid = c["id"]
        merged_customers[cid] = {
            "id": cid,
            "city": c["city"],
            "state": c["state"],
            "lat": c["lat"],
            "lng": c["lng"],
            "demand": c["demand"],
        }
        added_customers_by_id[cid] = c

    merged_distance = dict(distance)
    for override in distance_overrides:
        from_id, to_id = override["fromId"], override["toId"]
        # Leg resolved purely by which id-space each side belongs to (never a
        # string-prefix convention) -- mirrors solve_two_echelon's own
        # dist[p, r] / dist[r, c] indexing, both drawn from this SAME flat
        # dict. A pair must cleanly match one of the two adjacent-leg shapes:
        # mine -> refinery, or refinery -> customer. Anything else
        # (backwards, or skipping a leg entirely, e.g. mine -> customer) is
        # rejected rather than silently coerced.
        is_mine_to_refinery = from_id in mines and to_id in merged_refineries
        is_refinery_to_customer = from_id in merged_refineries and to_id in merged_customers
        if not is_mine_to_refinery and not is_refinery_to_customer:
            raise UnresolvableIdError(
                f"distanceOverrides pair (fromId '{from_id}', toId '{to_id}') does not "
                "resolve as a mine->refinery leg or a refinery->customer leg - fromId/toId "
                "must be adjacent ids in this model's two-echelon structure (base dataset "
                "or this scenario's added refineries/customers)"
            )
        merged_distance[(from_id, to_id)] = override["distance"]

    return {
        "refineries": merged_refineries,
        "customers": merged_customers,
        "distance": merged_distance,
        "addedRefineriesById": added_refineries_by_id,
        "addedCustomersById": added_customers_by_id,
    }


def build_merged_jade_dataset(
    inputs: dict[str, Any],
    plants: dict[str, dict],
    warehouses: dict[str, dict],
    customers: dict[str, dict],
    capability: dict[tuple[str, str], float],
    product_ids: list[str],
    distance: dict[tuple[str, str], float],
) -> dict[str, Any]:
    """jade-T4: `two-echelon-jade-us`'s own `load_dataset -> apply distance/
    capability overrides -> append added entities -> apply exclusions`
    pipeline, consumed by `solve_jade` in solve.py as a per-call,
    non-mutating drop-in for its `JADE_PLANTS`/`JADE_WAREHOUSES`/
    `JADE_CUSTOMERS`/`JADE_CAPABILITY`/`_jade_distances()` module-level data.

    Own function, not forced through any existing `build_merged_*_dataset` —
    two-echelon-jade-us is already ID-keyed end to end (DD-2), like Brazil/
    transport-coal/two-echelon-gold-au, but has a genuinely different shape:
    FOUR entity types (plants/warehouses/customers, plus a fixed `products`
    axis that is never edited/added — no `addedProducts` concept anywhere in
    the spec), a plant x product CAPABILITY matrix on top of the usual
    entity/distance merge, and a distance space spanning two disjoint leg
    namespaces (plant->warehouse, warehouse->customer) sharing one flat
    `distances.json`, same convention as two-echelon-gold-au's one distance
    dict for two legs — except JADE's `distanceOverrides` entries carry an
    explicit `leg` field (spec's Interfaces block), rather than two-echelon-
    gold-au's purely id-space-inferred leg resolution, since JADE's plant/
    warehouse/customer id spaces are NOT guaranteed mutually exclusive from
    a future added-entity's perspective the way mine/refinery/customer are
    today - the explicit `leg` tag is validated against BOTH the stated leg
    and each side's actual id-space membership (defense in depth), never
    inferred from the tag alone.

    Args:
        inputs: the validated `inputs` blob (or any dict exposing the same
            keys) containing `addedPlants`, `addedWarehouses`,
            `addedCustomers`, `distanceOverrides`, `capabilityOverrides`,
            `excludedCustomerIds` (T5's jadeInputsSchema, not yet built at
            this task - this function only needs the dict keys to exist).
            All keys optional, missing ones treated as empty list/set.
        plants: base dataset, `solve.py`'s `JADE_PLANTS`-shaped
            `{str_id: {"id", "sourceId", "name", "city", "state", "lat",
            "lng"}}`. Never mutated.
        warehouses: base dataset, `solve.py`'s `JADE_WAREHOUSES`-shaped
            `{str_id: {..., "zip"}}`. Never mutated.
        customers: base dataset, `solve.py`'s `JADE_CUSTOMERS`-shaped
            `{str_id: {..., "demand": float, "demands": {productId:
            float}}}`. Never mutated.
        capability: base dataset, `solve.py`'s `JADE_CAPABILITY`-shaped
            `{(plantId, productId): capacity}` — all 16 base cells present
            (spec §2.2). Never mutated.
        product_ids: the fixed 4 canonical product ids (`JADE_PRODUCTS`
            keys) — there is no `addedProducts`, so this is always the base
            product set, supplied by the caller rather than hardcoded here
            to keep this module dataset-format-agnostic like every other
            `build_merged_*_dataset`.
        distance: base dataset, `solve.py`'s `_jade_distances()`-shaped
            `{(fromId, toId): float}` — ONE dict covering BOTH the
            plant->warehouse leg and the warehouse->customer leg (same
            one-dict-two-legs convention as two-echelon-gold-au). Never
            mutated.

    Returns a dict:
        plants: `{**plants}` plus one entry per `addedPlants` item keyed by
            its own id, shaped like an existing `plants` value (no
            `sourceId`/`name` — those are base-entity-only display fields).
        warehouses: same pattern for `addedWarehouses` — no `status` key
            (that lives in `addedWarehousesById` below, matching base
            warehouses' own shape, whose status comes from a separate
            sparse `warehouseStatuses` override map).
        customers: `{**customers, **addedCustomers}` (keyed by id, each
            shaped with `demand`/`demands`) with any id present in
            `excludedCustomerIds` REMOVED — exclusion applies uniformly to
            base AND added customers (same flat-set convention as
            p-median-us/transport-coal/two-echelon-gold-au's own
            `excludedCustomerIds`), and is applied HERE (not left to
            solve_jade's own filtering) per this task's own test contract.
        capability: the FULL effective plant x product cross product over
            `plants ∪ addedPlants` and all 4 `product_ids` — every merged
            plant gets an entry for every product, defaulting to the base
            value (or `0` for an added plant, "added plants default all
            capability cells disabled" per spec §5) — with
            `capabilityOverrides` applied on top (`enabled: True ->
            210_000_000`, `False -> 0`), so a scenario can enable an
            off-diagonal cell for a BASE plant too, not just an added one.
        distance: `{**distance, **<resolved overrides>}` — each
            `distanceOverrides` entry's declared `leg` is checked against
            the ACTUAL id-space membership of its `fromId`/`toId` (checked
            against the customers set BEFORE exclusion filtering, so an
            override referencing an about-to-be-excluded customer still
            resolves as "a customer", not "unknown id") before being
            applied as `(fromId, toId): distance`. This is also how an
            added entity gets ANY distance at all (L4: no auto-haversine —
            an override IS the mechanism, not a separate one).
        addedPlantsById / addedWarehousesById / addedCustomersById:
            `{id: <raw entry>}` for each added-entity kind — lets
            `solve_jade` resolve an added entity's OWN status/demand
            (added warehouses carry `status` directly, added customers
            carry `demands` directly) without conflating it with the
            sparse `warehouseStatuses`/`customerDemands` override maps that
            apply to BASE entities only (mirrors every prior
            `build_merged_*_dataset`'s "added entity's own record wins"
            precedent).

    Raises:
        UnresolvableIdError: a `distanceOverrides` entry's declared `leg`
            does not match its `(fromId, toId)` pair's actual role
            membership (base dataset or this scenario's added plants/
            warehouses/customers), or the entry's `leg` value is not one of
            `plant_to_warehouse`/`warehouse_to_customer`.
    """
    added_plants = inputs.get("addedPlants", []) or []
    added_warehouses = inputs.get("addedWarehouses", []) or []
    added_customers = inputs.get("addedCustomers", []) or []
    distance_overrides = inputs.get("distanceOverrides", []) or []
    capability_overrides = inputs.get("capabilityOverrides", []) or []
    excluded_ids = set(inputs.get("excludedCustomerIds", []) or [])

    merged_plants = dict(plants)
    added_plants_by_id: dict[str, dict] = {}
    for pl in added_plants:
        pid = pl["id"]
        merged_plants[pid] = {
            "id": pid,
            "city": pl["city"],
            "state": pl["state"],
            "lat": pl["lat"],
            "lng": pl["lng"],
        }
        added_plants_by_id[pid] = pl

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

    # base ∪ added customers, BEFORE exclusion filtering -- needed as the
    # role-membership set for distanceOverrides validation below (an
    # override referencing a customer that's excluded THIS scenario should
    # still resolve as "a customer", not "unknown id").
    all_customers = dict(customers)
    added_customers_by_id: dict[str, dict] = {}
    for c in added_customers:
        cid = c["id"]
        demands = dict(c["demands"])
        all_customers[cid] = {
            "id": cid,
            "city": c["city"],
            "state": c["state"],
            "lat": c["lat"],
            "lng": c["lng"],
            "demand": sum(demands.values()),
            "demands": demands,
        }
        added_customers_by_id[cid] = c

    # Exclusion applies uniformly to base + added customers (flat-set
    # convention shared with every other model) -- and is applied here, at
    # the merge layer, rather than left to solve_jade's own list-comprehension
    # filtering (this task's own test contract asserts an excluded customer
    # is absent from the MERGED customers dict, not merely skipped later).
    merged_customers = {cid: c for cid, c in all_customers.items() if cid not in excluded_ids}

    # Effective plant x product cross product: every merged plant gets an
    # entry for every base product. A plant already in the base capability
    # matrix keeps its base value; an added plant (not in the base matrix at
    # all) defaults to 0 for every product ("added plants default all
    # capability cells disabled", spec §5) -- then capabilityOverrides are
    # applied on top of THIS cross product, so a scenario can enable an
    # off-diagonal cell for a base OR an added plant alike.
    merged_capability: dict[tuple[str, str], float] = {}
    for pid in merged_plants:
        for k in product_ids:
            merged_capability[(pid, k)] = capability.get((pid, k), 0)
    for override in capability_overrides:
        pid, k, enabled = override["plantId"], override["productId"], override["enabled"]
        merged_capability[(pid, k)] = 210_000_000 if enabled else 0

    merged_distance = dict(distance)
    for override in distance_overrides:
        leg = override.get("leg")
        from_id, to_id = override["fromId"], override["toId"]
        if leg == "plant_to_warehouse":
            if from_id not in merged_plants or to_id not in merged_warehouses:
                raise UnresolvableIdError(
                    f"distanceOverrides pair (fromId '{from_id}', toId '{to_id}') declared leg "
                    "'plant_to_warehouse' but fromId is not a known plant id or toId is not a "
                    "known warehouse id (base dataset or this scenario's added entities)"
                )
        elif leg == "warehouse_to_customer":
            if from_id not in merged_warehouses or to_id not in all_customers:
                raise UnresolvableIdError(
                    f"distanceOverrides pair (fromId '{from_id}', toId '{to_id}') declared leg "
                    "'warehouse_to_customer' but fromId is not a known warehouse id or toId is "
                    "not a known customer id (base dataset or this scenario's added entities)"
                )
        else:
            raise UnresolvableIdError(
                f"distanceOverrides entry (fromId '{from_id}', toId '{to_id}') has unknown or "
                f"missing leg '{leg}' -- must be 'plant_to_warehouse' or 'warehouse_to_customer'"
            )
        merged_distance[(from_id, to_id)] = override["distance"]

    return {
        "plants": merged_plants,
        "warehouses": merged_warehouses,
        "customers": merged_customers,
        "capability": merged_capability,
        "distance": merged_distance,
        "addedPlantsById": added_plants_by_id,
        "addedWarehousesById": added_warehouses_by_id,
        "addedCustomersById": added_customers_by_id,
    }


def build_merged_chens_dataset(
    inputs: dict[str, Any],
    warehouses: dict[str, dict],
    customers: dict[str, dict],
    distance: dict[tuple[str, str], float],
) -> dict[str, Any]:
    """C4.3: Chen's Cosmetics (`chens-cosmetics-cn`, Chapter 4) `load base ->
    apply distance overrides -> append added entities -> resolve status /
    exclusion / demand` pipeline, consumed by `solve_chens` in solve.py as a
    per-call, non-mutating drop-in for its `WAREHOUSES_CHENS`/`CUSTOMERS_CHENS`/
    `DISTANCE_CHENS` module-level globals.

    Direct-id keyed end to end (like p-median-brazil / transport-coal /
    two-echelon-gold-au, DD-2) -- `wh-<n>` / `cs-<n>` string ids, distances
    keyed by `(whId, csId)` string tuples -- so no id<->index bridge (that is
    p-median-us-only). Mirrors the STRUCTURE of `build_merged_pmedian_dataset`
    (base ∪ added entities, base + distance overrides), but keyed by string id
    and, because Chen's solver reads them directly, additionally returns the
    resolved forced/inactive/excluded id sets and folds the per-customer
    integer demand override into the merged customers dict.

    Per-call, non-mutating: the caller's base `warehouses`/`customers`/`distance`
    (solve.py's module-level globals) are never written to.

    Args:
        inputs: the validated `inputs` blob (or any dict exposing the same
            keys) containing `warehouseOverrides`, `customerOverrides`,
            `addedWarehouses`, `addedCustomers`, `distanceOverrides`
            (chensInputsSchema, C4.6). All optional, missing keys treated as
            empty lists.
        warehouses: base dataset, `WAREHOUSES_CHENS`-shaped
            `{str_id: {"id", "city", "state", "lat", "lng", "zip"?}}`. Never
            mutated.
        customers: base dataset, `CUSTOMERS_CHENS`-shaped
            `{str_id: {..., "demand": int}}`. Never mutated.
        distance: base dataset, `DISTANCE_CHENS`-shaped
            `{(whId, csId): km}` (RAW km, no circuity -- solve_chens applies
            ×1.17). Never mutated.

    Returns a dict:
        warehouses: `{**warehouses}` plus one entry per `addedWarehouses` item
            keyed by its own id, shaped like a base warehouse value (no
            `status` key -- status is resolved into the forced/inactive sets
            below, matching every prior merge's "status lives elsewhere, not on
            the entity dict" convention).
        customers: `{**customers}` plus one entry per `addedCustomers` item
            keyed by its own id, `demand` carried directly on the dict, with any
            base customer's `customerOverrides[].demand` (integer) folded in
            ("own record wins" for an added customer -- its demand comes from
            its own record, never a base override).
        distance: `{**distance, **<resolved distanceOverrides>}` -- each
            override's `(fromId, toId)` overlays the base dict (fromId a
            warehouse, toId a customer, checked strictly per role -- same
            backwards-pair protection as every other merge). Also how an added
            entity gets any distance at all (L4: no auto-haversine here -- the
            added-entity estimator, C4.7, fills missing pairs at the route
            layer before storage; the solver treats a still-missing pair as
            unreachable).
        forced: set of warehouse ids marked `forced_open` (base warehouses via
            `warehouseOverrides`, added warehouses via their own `status`).
        inactive: set of warehouse ids marked `inactive` (same two sources).
        excluded: set of customer ids marked `excluded` (base customers via
            `customerOverrides`, added customers via their own `status`) --
            exclusion applies uniformly to base + added.

    Raises:
        UnresolvableIdError: a `distanceOverrides` entry's `fromId` is not a
            known warehouse id (base or added), or its `toId` is not a known
            customer id (base or added) -- checked strictly per role.
    """
    added_warehouses = inputs.get("addedWarehouses", []) or []
    added_customers = inputs.get("addedCustomers", []) or []
    distance_overrides = inputs.get("distanceOverrides", []) or []
    warehouse_overrides = inputs.get("warehouseOverrides", []) or []
    customer_overrides = inputs.get("customerOverrides", []) or []

    merged_warehouses = dict(warehouses)
    for wh in added_warehouses:
        wid = wh["id"]
        merged_warehouses[wid] = {
            "id": wid,
            "city": wh["city"],
            "state": wh["state"],
            "lat": wh["lat"],
            "lng": wh["lng"],
        }

    merged_customers = dict(customers)
    for c in added_customers:
        cid = c["id"]
        merged_customers[cid] = {
            "id": cid,
            "city": c["city"],
            "state": c["state"],
            "lat": c["lat"],
            "lng": c["lng"],
            "demand": c["demand"],
        }

    # Per-customer integer demand override folded into the merged customers
    # dict (base customers only -- an added customer's demand comes from its
    # own record above, "own record wins"). A copy is written so the caller's
    # base dict is never mutated.
    for override in customer_overrides:
        cid = override["id"]
        if override.get("demand") is not None and cid in merged_customers:
            new_c = dict(merged_customers[cid])
            new_c["demand"] = override["demand"]
            merged_customers[cid] = new_c

    merged_distance = dict(distance)
    for override in distance_overrides:
        from_id, to_id = override["fromId"], override["toId"]
        if from_id not in merged_warehouses:
            raise UnresolvableIdError(
                f"distanceOverrides references id '{from_id}' that does not resolve as a "
                "warehouse - not found among warehouse ids in the base chens-cosmetics-cn "
                "dataset or this scenario's added entities"
            )
        if to_id not in merged_customers:
            raise UnresolvableIdError(
                f"distanceOverrides references id '{to_id}' that does not resolve as a "
                "customer - not found among customer ids in the base chens-cosmetics-cn "
                "dataset or this scenario's added entities"
            )
        merged_distance[(from_id, to_id)] = override["distance"]

    forced: set = set()
    inactive: set = set()
    for ws in warehouse_overrides:
        if ws["status"] == "forced_open":
            forced.add(ws["id"])
        elif ws["status"] == "inactive":
            inactive.add(ws["id"])
    for wh in added_warehouses:
        if wh.get("status") == "forced_open":
            forced.add(wh["id"])
        elif wh.get("status") == "inactive":
            inactive.add(wh["id"])

    excluded: set = set()
    for co in customer_overrides:
        if co["status"] == "excluded":
            excluded.add(co["id"])
    for c in added_customers:
        if c.get("status") == "excluded":
            excluded.add(c["id"])

    return {
        "warehouses": merged_warehouses,
        "customers": merged_customers,
        "distance": merged_distance,
        "forced": forced,
        "inactive": inactive,
        "excluded": excluded,
    }
