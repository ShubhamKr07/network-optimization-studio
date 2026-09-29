# Chapter 5 Editable Warehouses and Customers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `delivery-teaching-us`'s customer demand, customer exclusion and warehouse open/close status editable — in two new input tabs and on the Input Map — with every edit honoured by the solver.

**Architecture:** Approach A of three: the override machinery is added **inside `solve_delivery`**, mirroring `solve_pmedian`'s `get_bounds` / `get_demand` helpers and its `lb_{w}` / `ub_{w}` bound rows. No other solver is touched and no shared core is extracted. On the Studio side the two tabs are the existing shared components, gated by prop presence exactly as they already are for p-median.

**Tech Stack:** Python 3 + PuLP/CBC, Express 5 + Drizzle, Zod, OpenAPI + Orval, React + Vite + TanStack Query, vitest/supertest, vitest/RTL, Playwright, pytest.

**Source spec:** [`docs/superpowers/specs/2026-09-28-chapter-5-delivery-teaching-design.md`](../specs/2026-09-28-chapter-5-delivery-teaching-design.md) — **§14** is the amendment this plan implements, **§14.8** carries the requirements folded from the §15 review, and **§16.4** lists four items §16 explicitly carried here rather than closing in text.

---

## Global Constraints

Every task's requirements implicitly include this section.

**From §14, verbatim:**

- Editable: customer **demand**, customer **exclusion**, warehouse **status** (`active` / `forced_open` / `inactive`).
- **No added entities.** `add`, `copy`, `move` and `delete` stay hidden. `supportsAddedCustomerExclusion` stays `false`. `capacityModes` stays `[]` — no capacity column in the Warehouses table.
- `supportsFacilityStatus` **false → true**; `demandEditable` **false → true**. Both on a **live, shipped** manifest.
- Input tabs go from three to five: Input Map, Warehouses, Customers, Delivery Costs, Optimization Parameters.
- `demand` is `nonnegative`, **not** `positive` — zero is legal.
- **Excluded customers leave the denominator; zero-demand customers do not.** `total_demand` sums `get_demand(c)` over `customers_list` only.
- Override ids are **role-prefixed end to end** — `W8`, `C269` — with no translation step (§14.8).
- `capacity` is **deliberately omitted** from the warehouse override shape: this model has no capacity, and accepting a field the solver ignores is the persisted-but-ignored trap.

**Invariants from §5 that this change can easily break:**

- `weightedAvgDistance` is its own accumulator over the **distance table**, never derived from the objective.
- `edges[].distance` carries the real distance, never the effective cost.
- `dist` is read-only for the whole solver; overrides land on `cost` only.
- Facility count is `LpConstraintLE`, never `EQ`.
- Band overflow uses the shared `-1` sentinel.
- `computeCumulativeBandCoverage` returns integers **by default**; 2 dp is opt-in for this model only.
- Shared components gate on **prop presence**, never `modelId`. `modelId` checks belong at the call site.

**Frozen goldens (§8.1) — the no-override regression fence:**

| | Scenario 1 (toggle off) | Scenario 2 (on, 800 / 1 / 10) |
|---|---|---|
| Objective | 88,240,913,478.10 | 150,194,534,098.60 |
| Open DCs | W1, W2, W60 | W6, W43, W45 |
| Weighted avg. distance | 422.5511 mi | 508.6534 mi |
| % within 400/800/1200/1600 | 59.38 / 81.45 / 99.44 / 100.00 | 26.43 / 97.19 / 100.00 / 100.00 |

If override plumbing moves these, it leaked into the no-override path. `150,194,534,098.6002` is the raw CBC value; the **stored contract is 2 dp** and `.60` is what every assertion uses (§16.2).

**From CLAUDE.md (hard rules):**

- **`e2e_accuracy.py` is sacred.** Run it, never edit it. Expect **99/99**.
- Never hand-edit `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`. Edit `openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`, commit spec + output together.
- `docs/CHANGELOG-implementation.md` is **append-only**. Correct by appending an amendment.
- Ownership filtering is security-critical: non-owned resources return **404, never 403**.
- One task = one commit. Message format `[<task-id>] <imperative summary>`.
- **Run every api-server command with `DATABASE_URL` inline**, or eight suites fail at collection and look like real failures: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`.

**Learned on the branch that shipped this model — not optional:**

- Known load-induced flakes, never regressions: `cors`, `jobRunnerDispatcher`, `resultEnvelope`, `dispatcherRecovery` (api-server); `workspace-fixups-2.spec.ts` and one `chen-bands-units-qa` case (Playwright). Re-run the file alone before treating a failure as real.
- **Do not touch** these e2e specs — a separate bundle: `tab-coverage`, `input-map-v2`, `design-system`, `workspace-ux-r1-r9`, `two-echelon`, `import`, `bundle2-fastfollow`.
- A test asserting `.not.toBe(<status>)` is **vacuous** — an unmatched `/api` path 401s via `requireAuth`, it never 404s. Assert positively.
- Every line number below was captured at `ec54a6f` and **will drift**. Locate by symbol, not by line.

---

## Plan-resolution notes

| # | Spec says | Repo actually | Resolved in |
|---|---|---|---|
| 1 | §14.5 "Task 9's `readOnly` prop … rename to `fixedGeography`" | `readOnly` also exists as an **unrelated prop** on `FreezeConfirmDialog.tsx` and `SolveDialog.tsx`. A repo-wide rename would corrupt both | Task 6 — rename scoped to `InputMapTab.tsx` (17 hits), `MapDetailsCard.tsx` and the `Workspace.tsx` call site only |
| 2 | §14.3 mirrors `solve_pmedian` | p-median's `customers_list` filters on `cust_data[k]['id']` because its dataset is **ordinal-keyed**; delivery is **id-keyed**, so the filter is on the key itself | Task 3 — filter is `[c for c in customers if c not in excluded_ids]`, no `['id']` indirection |
| 3 | §14.2 "reusing p-median's shapes" | p-median's `warehouseOverrideSchema` carries `capacity`; this model has none | Task 2 — shape copied **minus** `capacity` |
| 4 | §16.4 #4 canonical-copy divergence | §14–§16 exist only on `ch5-delivery`; `main` has §1–§13 without them | Task 0 Step 1 — merge the doc to `main` **before** any other work |

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `artifacts/studio/src/__tests__/deliveryEditableInputs.test.tsx` | Five-tab set, Warehouses/Customers wiring, no added-entity sections. |

**Modified files**

| Path | Change | Task |
|---|---|---|
| `docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py` | Four new oracle cases producing §14 goldens. | 1 |
| `solvers/delivery-teaching-us/manifest.json` | `supportsFacilityStatus` and `demandEditable` → `true`. | 2 |
| `artifacts/api-server/src/validation/inputs/delivery.ts` | `warehouseOverrides`, `customerOverrides`. | 2 |
| `artifacts/api-server/src/solver/pmedian.ts:175` | Derive the three wire fields. | 2 |
| `artifacts/api-server/src/solver/solve.py:1557` | `solve_delivery` override machinery + infeasibility. | 3 |
| `artifacts/api-server/src/solver/tests/test_delivery.py` | Override, exclusion, status and infeasibility tests. | 3 |
| `artifacts/api-server/src/services/precheck.ts:1367` | Validate the new override ids. | 4 |
| `artifacts/studio/src/pages/Workspace.tsx` | Five-tab case; Warehouses/Customers render; map props. | 5, 6 |
| `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx` | `readOnly` → `fixedGeography`, narrowed. | 6 |
| `artifacts/studio/src/components/workspace/map/MapDetailsCard.tsx` | Narrowed footer hint. | 6 |
| `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx` | Open-facilities absence → presence. | 7 |
| `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx` (×4 sites) | `sizeByDemand` default → `false`. | 8 |
| `artifacts/studio/e2e/delivery-teaching.spec.ts` | Rewrite for five tabs + editable map. | 9 |
| `artifacts/api-server/src/__tests__/modelIdSetEquality.test.ts` | Registry set-equality (§16.4 #3). | 9 |

---

## Task 0: Reconcile the canonical doc, freeze the base, re-anchor

**Files:** none changed in the repo's source. Produces a merged doc and a recorded finding list.

**Why first.** §16.4 #4: §14–§16 exist only on `ch5-delivery`, `main` has §1–§13 without them, and the `ch4-ux-fixes` working tree is pre-amendment. Any edit to another copy guarantees an add/add conflict on a 2,148-line document. Merging first costs one command; not merging costs a hand-resolved conflict in the file that defines the work.

- [ ] **Step 1: Merge the spec to local `main` before anything else — after asking**

**Ask first.** Show the commit list and `--stat`, then merge only on approval. **Local `main` only — do not push to `origin`**; that happens only for an approved deploy.

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
# on approval:
git push . HEAD:main
git rev-parse --short main HEAD
```

Expected: both SHAs identical. `main` is not checked out in any worktree (`git worktree list` shows the shared checkout on `ch4-ux-fixes`), so this fast-forward is unblocked.

- [ ] **Step 2: Record the base and confirm a clean tree**

```bash
git rev-parse HEAD
git diff --check
```

Expected: no output from `git diff --check`.

- [ ] **Step 3: Re-anchor every line reference §16.4 #2 flagged**

```bash
grep -n "def get_bounds\|def get_demand\|lb_{w}\|ub_{w}\|excluded_ids\|customers_list" artifacts/api-server/src/solver/solve.py | head
grep -n "^def solve_delivery" artifacts/api-server/src/solver/solve.py
grep -n 'modelId === "delivery-teaching-us"' artifacts/api-server/src/solver/pmedian.ts
grep -n 'case "delivery-teaching-us"' artifacts/studio/src/pages/Workspace.tsx
grep -n "<WarehousesTab\|<CustomersTab" artifacts/studio/src/pages/Workspace.tsx
grep -rn "sizeByDemand" artifacts/studio/src
grep -rn "readOnly" artifacts/studio/src/components/workspace/
```

Captured at `ec54a6f` for orientation only — **every one of these will have moved**: `solve_delivery` at `:1557`, p-median's `get_bounds` `:381` / `get_demand` `:398` / bounds rows `:431-432` / `customers_list` `:379` / `excluded_ids` `:354`, `buildPayload`'s delivery branch `pmedian.ts:175`, `inputEntriesForModel`'s case `Workspace.tsx:1255`, the tab render sites `:3308` / `:3354` / `:3444`, `precheckDeliveryInputs` `precheck.ts:1367`, the four `sizeByDemand` sites `InputMapTab.tsx:859` / `:1363` / `:1856` / `:2436`.

Record the real numbers in the branch ledger. **Anything that moved by more than a few lines means a neighbouring change landed — read it before building on it.**

- [ ] **Step 4: Sweep the capability-flip consumers (§14.8 / G5)**

```bash
grep -rn "supportsFacilityStatus\|demandEditable" artifacts lib --include=*.ts --include=*.tsx | grep -v "/dist/"
```

`supportsFacilityStatus` gates Input-Map status paint (R3), hide-closed (R7), `MapLegend` status entries and `CostSummaryTab`'s Open-facilities row. **Account for every hit before implementing.** A test gated on either flag whose coverage silently shifts is the trap this sweep exists to catch — it will not fail, it will just stop testing what it claims to.

- [ ] **Step 5: Baseline the gate**

```bash
pnpm run typecheck
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
pnpm --filter studio test
(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -q)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
```

Record real counts. Expected at time of writing: typecheck clean; api-server ~1591/1594 with the documented flakes; studio 2152/2152; pytest 301/301; `e2e_accuracy.py` **99/99**. A red baseline is a stop-and-report.

---

## Task 1: Pin the §14 goldens

**Files:**
- Modify: `docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py`
- Modify: `docs/superpowers/specs/2026-09-28-chapter-5-delivery-teaching-design.md` (§14.6 golden table)

**Interfaces:**
- Produces: four pinned expected-value sets that Task 3's tests assert against.
- Consumes: nothing.

**Why first among the code tasks.** §16.4 #1: §14.6's tests as written assert `≠`, not correctness — *"a demand override changes the objective"* passes against any wrong number. The same reasoning put §8.1's goldens before any integration work on the original branch, and it is why that branch's solver task could be reviewed at all.

- [ ] **Step 1: Add the four cases to the prototype**

The prototype takes `--xlsx` and verifies the source sha256 before solving. Extend its `run()` to accept overrides, and add four calls:

```python
def run(label, P, adjust, thr=800.0, cpm=1.0, cpmo=10.0,
        demand_overrides=None, excluded=None, forced_open=None, inactive=None,
        binary_assign=True, gap=0.0, tl=600):
    cust_active = [c for c in cust if c not in (excluded or set())]
    dem_eff = dict(dem)
    for cid, v in (demand_overrides or {}).items():
        dem_eff[cid] = v
    ...
    # bounds, mirroring the solver:
    for w in plant:
        if w in (forced_open or set()):
            prob += o[w] >= 1
        if w in (inactive or set()):
            prob += o[w] <= 0
```

Then:

```python
res.append(run("G1 demand override: C1 -> 20,000,000", 3, False,
               demand_overrides={"1": 20_000_000}))
res.append(run("G2 exclusion: drop C1", 3, False, excluded={"1"}))
res.append(run("G3 forced_open > P: pin 4 with P=3", 3, False,
               forced_open={"6", "43", "45", "60"}))
res.append(run("G4 all inactive", 3, False, inactive=set(plant)))
```

Note the prototype keys plants and customers by the **sheet's raw ids** (`"1"`, `"60"`), not the `W`/`C`-prefixed dataset ids — it reads the xlsx directly. Translate when pinning: sheet `1` is `W1`/`C1`.

- [ ] **Step 2: Run it and capture real numbers**

```bash
python3 docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py \
  --xlsx attached_assets/COG-Model-Data-3DC-3WH.xlsx
```

Expected: the two existing scenarios reproduce `88,240,913,478.10` / `{1,2,60}` / `422.5511` and `150,194,534,098.6002` / `{6,43,45}` / `508.6534` **unchanged** — if they move, the `run()` signature change leaked into the no-override path. Cases G3 and G4 should report infeasible.

- [ ] **Step 3: Pin the results into §14.6**

Add a golden table in §8.1's form — objective (2 dp), open set, weighted average distance (4 dp), band percentages (2 dp), and for G3/G4 the expected status instead. **Do not invent a number; copy what the run printed.**

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py \
        docs/superpowers/specs/2026-09-28-chapter-5-delivery-teaching-design.md
git commit -m "[ch5-edit-1] pin the section 14 goldens from an independent prototype run"
```

---

## Task 2: Contract — manifest, schema, payload

**Files:**
- Modify: `solvers/delivery-teaching-us/manifest.json`
- Modify: `artifacts/api-server/src/validation/inputs/delivery.ts`
- Modify: `artifacts/api-server/src/solver/pmedian.ts` (the `delivery-teaching-us` branch)
- Test: `artifacts/api-server/src/__tests__/deliveryContract.test.ts`
- Test: `lib/dataset-schema/src/manifest.test.ts`

**Interfaces:**
- Produces: `deliveryInputsSchema` accepts `warehouseOverrides` and `customerOverrides`; `buildPayload` emits `customerDemands`, `excludedCustomerIds`, `warehouseStatuses`.
- Consumes: Task 1's goldens (for nothing yet — Task 3 asserts them).

- [ ] **Step 1: Write the failing contract tests**

Append to `deliveryContract.test.ts`:

```ts
describe("deliveryInputsSchema — editable overrides (section 14)", () => {
  it("accepts warehouse status overrides and defaults them to []", () => {
    const parsed = deliveryInputsSchema.parse(baseInputs());
    expect(parsed.warehouseOverrides).toEqual([]);
    expect(parsed.customerOverrides).toEqual([]);
  });

  it("accepts the three warehouse statuses and rejects anything else", () => {
    for (const status of ["active", "forced_open", "inactive"]) {
      expect(deliveryInputsSchema.safeParse({
        ...baseInputs(), warehouseOverrides: [{ id: "W8", status }],
      }).success).toBe(true);
    }
    expect(deliveryInputsSchema.safeParse({
      ...baseInputs(), warehouseOverrides: [{ id: "W8", status: "closed" }],
    }).success).toBe(false);
  });

  // The model has no capacity. Accepting a field the solver ignores is the
  // persisted-but-ignored trap section 14 exists to avoid.
  it("strips or rejects a capacity on a warehouse override", () => {
    const parsed = deliveryInputsSchema.parse({
      ...baseInputs(), warehouseOverrides: [{ id: "W8", status: "inactive", capacity: 500 }],
    });
    expect((parsed.warehouseOverrides[0] as Record<string, unknown>).capacity).toBeUndefined();
  });

  it("accepts zero demand but rejects negative", () => {
    expect(deliveryInputsSchema.safeParse({
      ...baseInputs(), customerOverrides: [{ id: "C1", demand: 0, status: "active" }],
    }).success).toBe(true);
    expect(deliveryInputsSchema.safeParse({
      ...baseInputs(), customerOverrides: [{ id: "C1", demand: -1, status: "active" }],
    }).success).toBe(false);
  });
});

describe("buildPayload — section 14 wire fields", () => {
  it("derives customerDemands, excludedCustomerIds and warehouseStatuses", () => {
    const payload = buildPayload({
      modelId: "delivery-teaching-us",
      inputs: deliveryInputsSchema.parse({
        ...baseInputs(),
        warehouseOverrides: [
          { id: "W6", status: "forced_open" },
          { id: "W8", status: "inactive" },
          { id: "W9", status: "active" },
        ],
        customerOverrides: [
          { id: "C1", demand: 20_000_000, status: "active" },
          { id: "C2", demand: null, status: "excluded" },
        ],
      }),
    }) as Record<string, unknown>;

    expect(payload.customerDemands).toEqual({ C1: 20_000_000 });
    expect(payload.excludedCustomerIds).toEqual(["C2"]);
    // `active` is the default and is NOT sent — only deviations travel.
    expect(payload.warehouseStatuses).toEqual([
      { warehouseId: "W6", status: "forced_open" },
      { warehouseId: "W8", status: "inactive" },
    ]);
  });

  it("keeps the ids role-prefixed with no translation", () => {
    const payload = buildPayload({
      modelId: "delivery-teaching-us",
      inputs: deliveryInputsSchema.parse({
        ...baseInputs(), customerOverrides: [{ id: "C269", demand: 1, status: "active" }],
      }),
    }) as Record<string, Record<string, unknown>>;
    expect(Object.keys(payload.customerDemands)).toEqual(["C269"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/deliveryContract.test.ts
```

Expected: FAIL — `parsed.warehouseOverrides` is `undefined` (Zod strips undeclared keys).

- [ ] **Step 3: Extend the schema**

In `artifacts/api-server/src/validation/inputs/delivery.ts`, above `deliveryInputsSchema`:

```ts
// Section 14 — editable Warehouses and Customers. Shapes mirror pMedian.ts's
// equivalents so the shared tab components, the status enum and the solver's
// bound logic all transfer unchanged.
//
// `capacity` is DELIBERATELY absent from the warehouse override. p-median's
// shape carries it; this model has capacityModes: [] and the solver has no
// capacity constraint, so accepting the field would persist a value nothing
// reads — the persisted-but-ignored trap.
const warehouseOverrideSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["active", "forced_open", "inactive"]),
});

// `demand` is NONNEGATIVE, not positive: zero is a legal demand and means
// "still a customer, still served, contributes nothing" — distinct from
// `status: "excluded"`, which removes the customer from the denominator.
const customerOverrideSchema = z.object({
  id: z.string().min(1),
  demand: z.number().finite().nonnegative().nullable().optional(),
  status: z.enum(["active", "excluded"]),
});
```

and inside the object body:

```ts
  warehouseOverrides: z.array(warehouseOverrideSchema).default([]),
  customerOverrides: z.array(customerOverrideSchema).default([]),
```

- [ ] **Step 4: Extend `buildPayload`**

In `artifacts/api-server/src/solver/pmedian.ts`'s `delivery-teaching-us` branch, add to the returned object:

```ts
      customerDemands: Object.fromEntries(
        i.customerOverrides.filter(o => o.demand != null).map(o => [o.id, o.demand as number]),
      ),
      excludedCustomerIds: i.customerOverrides
        .filter(o => o.status === "excluded").map(o => o.id),
      warehouseStatuses: i.warehouseOverrides
        .filter(o => o.status !== "active")
        .map(o => ({ warehouseId: o.id, status: o.status })),
```

Only deviations travel: an `active` warehouse and a `null` demand are the defaults and are not sent.

- [ ] **Step 5: Flip the manifest capabilities**

In `solvers/delivery-teaching-us/manifest.json`:

```json
    "demandEditable": true,
    "supportsFacilityStatus": true,
```

`capacityModes` stays `[]` and `supportsAddedCustomerExclusion` stays `false`.

- [ ] **Step 6: Update the manifest test**

`lib/dataset-schema/src/manifest.test.ts` asserts `supportsFacilityStatus` is `false` for this model. Flip that assertion to `true` and add `demandEditable: true`, with a comment citing §14.

- [ ] **Step 7: Run the suites**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/deliveryContract.test.ts src/__tests__/registry.test.ts
pnpm --filter @workspace/dataset-schema exec vitest run src/manifest.test.ts
pnpm run typecheck
```

Expected: PASS. **Task 0 Step 4's sweep listed every other consumer of these two flags — re-run those suites too** and report any whose coverage changed without failing.

- [ ] **Step 8: Commit**

```bash
git add solvers/delivery-teaching-us/manifest.json \
        artifacts/api-server/src/validation/inputs/delivery.ts \
        artifacts/api-server/src/solver/pmedian.ts \
        artifacts/api-server/src/__tests__/deliveryContract.test.ts \
        lib/dataset-schema/src/manifest.test.ts
git commit -m "[ch5-edit-2] accept warehouse status and customer demand/exclusion overrides"
```

---

## Task 3: Solver — overrides, and infeasibility that is now reachable

**Files:**
- Modify: `artifacts/api-server/src/solver/solve.py` (`solve_delivery`)
- Test: `artifacts/api-server/src/solver/tests/test_delivery.py`

**Interfaces:**
- Consumes: Task 2's wire fields; Task 1's pinned goldens.
- Produces: a solver that honours all three override kinds and returns a truthful `infeasible`.

- [ ] **Step 1: Write the failing tests**

Append to `test_delivery.py`. **Replace every `PIN_*` placeholder with the number Task 1's prototype actually printed** — these are the only values in this plan that are not yet measured, and asserting an unmeasured number is the defect §16.4 #1 exists to prevent.

```python
def test_demand_override_changes_objective_and_wad():
    """Section 14.3. Pinned, not merely `!=` — an inequality assertion passes
    against any wrong number."""
    env = solve_delivery({**BASE, "customerDemands": {"C1": 20_000_000}})
    assert env["solutionStatus"] == "optimal"
    assert env["objective"] == pytest.approx(PIN_G1_OBJECTIVE, rel=1e-9)
    assert env["metrics"]["weightedAvgDistance"] == pytest.approx(PIN_G1_WAD, abs=5e-4)


def test_excluded_customer_leaves_the_denominator():
    """Section 14.3's distinction, half one: an excluded customer is absent from
    assignments AND from the weighted-average/band denominator."""
    env = solve_delivery({**BASE, "excludedCustomerIds": ["C1"]})
    assert all(a["customerId"] != "C1" for a in env["details"]["assignments"])
    assert len(env["details"]["assignments"]) == 312
    assert env["objective"] == pytest.approx(PIN_G2_OBJECTIVE, rel=1e-9)
    assert env["metrics"]["weightedAvgDistance"] == pytest.approx(PIN_G2_WAD, abs=5e-4)


def test_zero_demand_customer_stays_in_the_denominator():
    """Section 14.3's distinction, half two — the half that makes the pair
    meaningful. A zero-demand customer is STILL assigned and still counted in
    the served set; it simply contributes nothing. If this and the exclusion
    test produced the same numbers, the two mechanisms would be redundant and
    one of them would be a lie to the student."""
    env = solve_delivery({**BASE, "customerDemands": {"C1": 0}})
    assert any(a["customerId"] == "C1" for a in env["details"]["assignments"])
    assert len(env["details"]["assignments"]) == 313
    excluded = solve_delivery({**BASE, "excludedCustomerIds": ["C1"]})
    assert env["metrics"]["weightedAvgDistance"] != pytest.approx(
        excluded["metrics"]["weightedAvgDistance"], abs=1e-6)


def test_forced_open_pins_a_warehouse_into_the_open_set():
    env = solve_delivery({**BASE, "warehouseStatuses": [
        {"warehouseId": "W8", "status": "forced_open"}]})
    assert "W8" in env["details"]["openWarehouseIds"]
    assert len(env["details"]["openWarehouseIds"]) <= 3


def test_inactive_keeps_a_warehouse_out():
    base = solve_delivery(dict(BASE))
    assert "W1" in base["details"]["openWarehouseIds"]
    env = solve_delivery({**BASE, "warehouseStatuses": [
        {"warehouseId": "W1", "status": "inactive"}]})
    assert "W1" not in env["details"]["openWarehouseIds"]


def test_more_than_p_forced_open_is_infeasible():
    """Section 14.4 case 2 — the likeliest student trap and the least obvious:
    four lower bounds of 1 against `sum(open) <= 3`."""
    env = solve_delivery({**BASE, "warehouseStatuses": [
        {"warehouseId": w, "status": "forced_open"} for w in ("W1", "W2", "W6", "W60")]})
    assert env["solutionStatus"] == "infeasible"
    assert env["edges"] == []


def test_all_warehouses_inactive_is_infeasible():
    env = solve_delivery({**BASE, "warehouseStatuses": [
        {"warehouseId": w, "status": "inactive"} for w in DELIV_WAREHOUSES]})
    assert env["solutionStatus"] == "infeasible"


def test_all_customers_excluded_does_not_divide_by_zero():
    """Section 14.4 case 3 — degenerate, not infeasible. Without the guard the
    weighted average divides by zero and the worker dies with a ZeroDivisionError
    instead of returning an envelope."""
    env = solve_delivery({**BASE, "excludedCustomerIds": list(DELIV_CUSTOMERS)})
    assert env["metrics"]["weightedAvgDistance"] == 0
    assert env["details"]["assignments"] == []


def test_overrides_do_not_move_the_frozen_goldens():
    """The no-override regression fence. If override plumbing leaked into the
    default path, Scenario 1 moves."""
    env = solve_delivery(dict(BASE))
    assert env["objective"] == pytest.approx(88240913478.10, rel=1e-9)
    assert set(env["details"]["openWarehouseIds"]) == {"W1", "W2", "W60"}
    assert env["metrics"]["weightedAvgDistance"] == pytest.approx(422.5511, abs=5e-4)


def test_exclusion_combined_with_an_overflow_lane():
    """Section 14.8 / G7 — the overflow remainder must use POST-exclusion
    total_demand. The two interact precisely in the denominator, and nothing
    else exercises them together."""
    env = solve_delivery({**BASE, "distanceBands": [100, 200],
                          "excludedCustomerIds": ["C1"]})
    rows = {r["band"]: r["percent"] for r in env["metrics"]["bandCoverage"]}
    assert -1 in rows
    assert sum(rows.values()) == pytest.approx(100.0, abs=0.05)
```

- [ ] **Step 2: Run to verify failure**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/test_delivery.py -x -q
```

Expected: the override tests fail because `solve_delivery` ignores the new fields — demand overrides change nothing, and the infeasible cases still return `optimal`.

- [ ] **Step 3: Add the override machinery**

In `solve_delivery`, after the existing input reads:

```python
    # Section 14.3 — mirrors solve_pmedian's helpers. Note the filter is on the
    # KEY: p-median's dataset is ordinal-keyed so it filters on
    # cust_data[k]['id']; this one is id-keyed, so there is no indirection.
    excluded_ids = set(inp.get('excludedCustomerIds', []))
    customer_demands = inp.get('customerDemands', {}) or {}
    wh_statuses = {s['warehouseId']: s['status']
                   for s in (inp.get('warehouseStatuses', []) or [])}

    customers_list = [c for c in customers if c not in excluded_ids]

    def get_demand(c):
        return customer_demands.get(c, DELIV_CUSTOMERS[c]['demand'])

    def get_bounds(w):
        s = wh_statuses.get(w)
        if s == "forced_open":
            return (1, 1)
        if s == "inactive":
            return (0, 0)
        return (0, 1)
```

Replace every `customers` with `customers_list` in the variable declarations, the objective, the `served_{c}` rows, the per-pair linking rows and the post-solve loop. Replace every `demand[c]` with `get_demand(c)`. Add the bound rows:

```python
    for w in warehouses:
        lb, ub = get_bounds(w)
        prob += LpConstraint(Open[w], LpConstraintGE, f"lb_{w}", lb)
        prob += LpConstraint(Open[w], LpConstraintLE, f"ub_{w}", ub)
```

and guard the denominator:

```python
    total_demand = sum(get_demand(c) for c in customers_list)
    active_demand = total_demand if total_demand > 0 else 1
```

using `active_demand` as the divisor for `weighted_avg_distance` and every band percentage. **`dist` stays untouched throughout** — overrides land on `cost` only, and `weightedAvgDistance` stays its own accumulator.

- [ ] **Step 4: Run to verify they pass**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/test_delivery.py -q
```

Expected: PASS, all cases including the frozen goldens.

- [ ] **Step 5: Prove no other solver moved**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/ -q
(cd tests && python3 e2e_accuracy.py)
```

Expected: full pytest green; `e2e_accuracy.py` **99/99**, file untouched.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/solver/solve.py \
        artifacts/api-server/src/solver/tests/test_delivery.py
git commit -m "[ch5-edit-3] honour demand, exclusion and warehouse status in solve_delivery"
```

---

## Task 4: Precheck the new override ids

**Files:**
- Modify: `artifacts/api-server/src/services/precheck.ts` (`precheckDeliveryInputs`)
- Test: `artifacts/api-server/src/__tests__/precheck.test.ts`

**Why this task exists.** §14.8 / G2. Zod's `z.string()` checks shape and the status enum, **not existence**. An override naming `W999` is caught nowhere before the solver and surfaces as a generic `internal_error` — the exact failure `precheckDeliveryInputs` was created to prevent, and the same class as the whole-branch review's I-1 which was already fixed once for lane costs.

- [ ] **Step 1: Write the failing tests**

```ts
describe("precheckDeliveryInputs — section 14 override ids", () => {
  it("rejects an unknown warehouse override id and names it", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us", {
      ...base, warehouseOverrides: [{ id: "W999", status: "inactive" }],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.errors)).toContain("W999");
  });

  it("rejects an unknown customer override id and names it", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us", {
      ...base, customerOverrides: [{ id: "C999", demand: 5, status: "active" }],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.errors)).toContain("C999");
  });

  // A role-swapped id is individually well-formed and still wrong.
  it("rejects a customer id used as a warehouse override", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us", {
      ...base, warehouseOverrides: [{ id: "C1", status: "inactive" }],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts valid ids", () => {
    expect(runNetworkEditsPrecheckForModel("delivery-teaching-us", {
      ...base,
      warehouseOverrides: [{ id: "W8", status: "forced_open" }],
      customerOverrides: [{ id: "C1", demand: 0, status: "excluded" }],
    }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/precheck.test.ts
```

Expected: the negative cases FAIL by returning `ok: true` — that is the bug.

- [ ] **Step 3: Extend the precheck**

In `precheckDeliveryInputs`, after the existing lane-cost loop:

```ts
  // Section 14.8 — Zod validates shape and the status enum, never existence.
  // Without this an override naming W999 reaches the solver and surfaces as a
  // generic internal_error. NOT a feasibility rule: section 14.4 keeps
  // feasibility in the model, and this function stays about malformed input.
  for (const ov of inputs.warehouseOverrides ?? []) {
    if (!warehouses.has(ov.id)) {
      errors.push({ code: "reference_integrity", message: `Unknown warehouse id ${ov.id}` });
    }
  }
  for (const ov of inputs.customerOverrides ?? []) {
    if (!customers.has(ov.id)) {
      errors.push({ code: "reference_integrity", message: `Unknown customer id ${ov.id}` });
    }
  }
```

`PrecheckErrorCode` is a **closed union** and `PrecheckError` is `{ code; message }` with no `entityId` — use `reference_integrity` and put the id in the message. Do not widen either.

- [ ] **Step 4: Run to verify they pass**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/precheck.test.ts \
    src/__tests__/deliveryPrecheckIntegration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/services/precheck.ts \
        artifacts/api-server/src/__tests__/precheck.test.ts
git commit -m "[ch5-edit-4] precheck the warehouse and customer override ids"
```

---

## Task 5: The two tabs

**Files:**
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (`inputEntriesForModel`; tab render gates)
- Create: `artifacts/studio/src/__tests__/deliveryEditableInputs.test.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
describe("delivery-teaching-us — five input tabs (section 14.5)", () => {
  it("offers Input Map, Warehouses, Customers, Delivery Costs, Optimization Parameters", () => {
    expect(inputEntriesForModel("delivery-teaching-us").map(e => e.id)).toEqual(
      ["input-map", "warehouses", "customers", "deliveryCosts", "optimization-parameters"]);
  });

  it("does not disturb the p-median default", () => {
    expect(inputEntriesForModel("p-median-us").map(e => e.id)).toEqual(
      ["input-map", "customers", "warehouses", "distances", "optimization-parameters"]);
  });

  // No added entities: those sections are gated on the onAdded* callbacks being
  // non-null, so NOT passing them is what hides them.
  it("renders neither tab's added-entity section", () => {
    renderDeliveryWorkspaceTab("warehouses");
    expect(screen.queryByTestId("added-warehouses-section")).toBeNull();
    renderDeliveryWorkspaceTab("customers");
    expect(screen.queryByTestId("added-customers-section")).toBeNull();
  });

  it("shows no capacity column — this model has capacityModes: []", () => {
    renderDeliveryWorkspaceTab("warehouses");
    expect(screen.queryByText(/capacity/i)).toBeNull();
  });
});
```

Replace `renderDeliveryWorkspaceTab` with the render helper `Workspace.TabCoverage.test.tsx` already uses, and the added-section testids with the real ones read from `WarehousesTab.tsx` / `CustomersTab.tsx` — **read them, do not guess**, as the Task 9 brief's wrong testid list on the previous branch showed.

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter studio exec vitest run src/__tests__/deliveryEditableInputs.test.tsx
```

Expected: FAIL — three entries, not five.

- [ ] **Step 3: Extend the tab case**

```tsx
    case "delivery-teaching-us":
      return [
        { id: "input-map", label: "Input Map" },
        { id: "warehouses", label: "Warehouses" },
        { id: "customers", label: "Customers" },
        { id: "deliveryCosts", label: "Delivery Costs" },
        { id: "optimization-parameters", label: "Optimization Parameters" },
      ];
```

The case stays **explicit**. The switch tail is `case "p-median-brazil": case "p-median-us": default:`, so a model that merely falls through inherits p-median's list — which now happens to be closer to what this model wants, and that makes writing the case out more important, not less. An accidental match is not a decision.

- [ ] **Step 4: Render the two tabs**

Extend the existing `<WarehousesTab>` and `<CustomersTab>` render gates to include this model, passing `onWarehouseOverridesChange` / `onCustomerOverridesChange` and `demandEditable`, and **not** passing `onAddedWarehousesChange` / `onAddedCustomersChange`. Add a `deliveryCosts`-style row for both entities to `isEditableInputTab` so the Save and dirty path exists — without it the tabs render and silently fail to persist, which is what the previous branch's Task 11 review caught.

- [ ] **Step 5: Update TabCoverage**

`Workspace.TabCoverage.test.tsx`'s delivery block asserts three input entries. Move it to five.

- [ ] **Step 6: Run**

```bash
pnpm --filter studio exec vitest run src/__tests__/deliveryEditableInputs.test.tsx \
  src/__tests__/Workspace.TabCoverage.test.tsx src/__tests__/Workspace.test.tsx
pnpm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/pages/Workspace.tsx \
        artifacts/studio/src/__tests__/deliveryEditableInputs.test.tsx \
        artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx
git commit -m "[ch5-edit-5] add the Warehouses and Customers input tabs"
```

---

## Task 6: The map — `readOnly` becomes `fixedGeography`

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx` (17 `readOnly` hits)
- Modify: `artifacts/studio/src/components/workspace/map/MapDetailsCard.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (map call site)
- Test: `artifacts/studio/src/__tests__/InputMapTab.deliveryReadOnly.test.tsx`

**Why rename.** §14.5: the prop keeps hiding add/copy/move/delete but stops hiding status and demand. A boolean whose name has stopped describing what it does is the same class of problem as the mount test that could not fail.

**The trap.** `readOnly` also exists as an **unrelated prop** on `FreezeConfirmDialog.tsx` and `SolveDialog.tsx`. A repo-wide rename corrupts both. Scope it to `InputMapTab.tsx`, `MapDetailsCard.tsx` and the `Workspace.tsx` map call site only.

- [ ] **Step 1: Write the failing tests**

```tsx
describe("delivery map — fixedGeography (section 14.5)", () => {
  it.each([
    "button-input-map-place-wh", "button-input-map-place-cs",
    "map-action-move", "map-action-copy", "map-action-delete",
  ])("still hides %s — geography stays fixed", (testid) => {
    renderDeliveryMap();
    expect(screen.queryByTestId(testid)).toBeNull();
  });

  it("now ALLOWS status editing", async () => {
    renderDeliveryMap();
    fireEvent.contextMenu(document.querySelector(".leaflet-marker-icon")!);
    expect(await screen.findByTestId("edit-warehouse-status")).toBeInTheDocument();
  });

  it("now ALLOWS demand editing", async () => {
    renderDeliveryMap();
    fireEvent.contextMenu(document.querySelectorAll(".leaflet-marker-icon")[1]!);
    expect(await screen.findByTestId("edit-customer-demand-input")).toBeInTheDocument();
  });

  it("keeps added-entity markers undraggable", () => {
    renderDeliveryMap({ addedWarehouses: [addedWh], inputs: { addedWarehouses: [addedWh] } });
    document.querySelectorAll(".leaflet-marker-icon").forEach(m =>
      expect(m.className).not.toContain("leaflet-marker-draggable"));
  });
});
```

Read every testid from the source before writing — the previous branch's equivalent brief listed several that did not exist.

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter studio exec vitest run src/__tests__/InputMapTab.deliveryReadOnly.test.tsx
```

Expected: the two "now ALLOWS" cases FAIL — `readOnly` currently hides them.

- [ ] **Step 3: Rename and narrow**

Rename `readOnly` → `fixedGeography` in `InputMapTab.tsx` and `MapDetailsCard.tsx` and at the `Workspace.tsx` call site. Then **remove** the gate from the status and demand affordances, keeping it on add, place, copy, move, delete, `draggableIds` and the map Save path. Narrow `MapDetailsCard`'s footer hint to name only the actions that still exist.

- [ ] **Step 4: Prove the rename is complete**

```bash
grep -rn "readOnly" artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx \
  artifacts/studio/src/components/workspace/map/MapDetailsCard.tsx
```

Expected: **no output**. A leftover `readOnly` keeps hiding status and demand with no error — the rename's whole purpose lost silently. Confirm `FreezeConfirmDialog.tsx` and `SolveDialog.tsx` still have their own unrelated `readOnly` untouched.

- [ ] **Step 5: Run the sibling suites**

```bash
pnpm --filter studio exec vitest run src/__tests__/InputMapTab.deliveryReadOnly.test.tsx \
  src/__tests__/InputMapTabV2.test.tsx src/__tests__/InputMapTab.maxCoverage.test.tsx \
  src/__tests__/InputMapTabV2.transport.test.tsx
```

Expected: PASS. These exercise the same shared component for other models, where dragging and adding are live features that must keep working.

- [ ] **Step 6: Commit**

```bash
git add artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx \
        artifacts/studio/src/components/workspace/map/MapDetailsCard.tsx \
        artifacts/studio/src/pages/Workspace.tsx \
        artifacts/studio/src/__tests__/InputMapTab.deliveryReadOnly.test.tsx
git commit -m "[ch5-edit-6] rename readOnly to fixedGeography and allow status and demand edits"
```

---

## Task 7: Invert the Open-facilities assertion

**Files:**
- Modify: `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`

`CostSummaryTab.tsx` itself needs **no change** — its Open-facilities row is gated on `supportsFacilityStatus`, which Task 2 flipped. Only the test that asserted the row's absence for this model inverts.

- [ ] **Step 1: Invert the assertion**

Find the delivery case asserting the row is absent and change it to assert presence, with a comment citing §14: the row is present now because `supportsFacilityStatus` is `true`, and the spec passage that said otherwise (§7.6) is superseded.

- [ ] **Step 2: Run**

```bash
pnpm --filter studio exec vitest run src/__tests__/CostSummaryTab.test.tsx
```

Expected: PASS, with every other model's rows unchanged.

- [ ] **Step 3: Commit**

```bash
git add artifacts/studio/src/__tests__/CostSummaryTab.test.tsx
git commit -m "[ch5-edit-7] invert the Open-facilities assertion for delivery"
```

---

## Task 8: `sizeByDemand` defaults to unchecked, all models

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx` (four sites)
- Test: `artifacts/studio/src/__tests__/InputMapTabV2.test.tsx` and the three sibling map suites

**This is the only part of the change that touches the other six models.** Requested separately; kept as its own task so a reviewer can reject it without rejecting the feature.

- [ ] **Step 1: Write the failing test**

```tsx
it("starts with size-customers-by-demand UNCHECKED and still toggles on", async () => {
  render(<InputMapTab mode="pmedian" {...props} />);
  const toggle = screen.getByTestId("toggle-layer-size-by-demand");
  expect(toggle).not.toBeChecked();
  await userEvent.click(toggle);
  expect(toggle).toBeChecked();
});
```

Add one per model family, in the suite that already covers that family's map.

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — the toggle starts checked.

- [ ] **Step 3: Flip the four defaults**

Each of the four sites currently reads `toggles.sizeByDemand ?? true` in both the `checked` prop and the `onToggle` negation. Change both to `?? false`:

```tsx
checked={toggles.sizeByDemand ?? false}
onToggle={() => setToggles(t => ({ ...t, sizeByDemand: !(t.sizeByDemand ?? false) }))}
```

All four must change together — a partial flip makes one model's map behave differently for no stated reason.

- [ ] **Step 4: Run every map suite**

```bash
pnpm --filter studio test
```

Expected: PASS. Any suite asserting demand-sized bubbles by default needs updating to reflect the new default, not working around it.

- [ ] **Step 5: Commit**

```bash
git add artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx artifacts/studio/src/__tests__/
git commit -m "[ch5-edit-8] default size-customers-by-demand to unchecked for every model"
```

---

## Task 9: e2e rewrite, the registry test, and closeout

**Files:**
- Modify: `artifacts/studio/e2e/delivery-teaching.spec.ts`
- Modify: `artifacts/api-server/src/__tests__/modelIdSetEquality.test.ts`
- Modify: `docs/CHANGELOG-implementation.md`, `model-integration-precheck.md`

- [ ] **Step 1: Rewrite the e2e spec (§14.8 / G4)**

`delivery-teaching.spec.ts` was written for the three-tab, read-only-map world and is in `e2e:gate` now. Its sidebar assertion names exactly `input-map`, `deliveryCosts` and `optimization-parameters` — that breaks at five tabs. Its `button-input-map-place-wh` count-0 assertion **stays valid** and must be kept. Add: open the Warehouses tab, set a DC `inactive`, re-solve, assert it leaves the open set; open Customers, exclude a city, re-solve, assert the assignment count drops to 312.

- [ ] **Step 2: Build the registry set-equality test (§16.4 #3)**

Extend `modelIdSetEquality.test.ts` with one assertion that the model-id set is identical across `KNOWN_MODEL_IDS`, `MODEL_IDS`, `VALID_MODEL_IDS`, `KNOWN_SCHEMAS`, `PACKAGE_SPECS`, the four OpenAPI enums, `StudioModelType` and `solve.py`'s dispatcher. This was proposed in §9, is still unbuilt, and converts eighteen hand-maintained lists into one failing assertion. **It is the only item in this plan that reduces future work rather than adding to it.**

- [ ] **Step 3: Documentation**

Append a `CHANGELOG-implementation.md` entry (append-only — do not edit prior text). Update `model-integration-precheck.md` if any Gate 1 point's mechanism changed.

- [ ] **Step 4: Full gate**

```bash
git diff --check
pnpm run typecheck
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
pnpm --filter studio test
(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -q)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
pnpm e2e:gate
```

`e2e_accuracy.py` must be **99/99 and unmodified**. `pnpm e2e:gate`'s baseline is **43 passed / 13 failed / 4 skipped**; the 13 are pre-existing test-rot and env-gap failures belonging to a separate bundle. Confirm the 13 are the **same 13**, not a different set of the same size.

- [ ] **Step 5: Re-run Task 0's audit**

A consumer added during implementation is what a single up-front audit misses. Re-run Step 3's re-anchoring and Step 4's capability sweep, and diff against the recorded baseline.

- [ ] **Step 6: Commit**

```bash
git add artifacts/studio/e2e/delivery-teaching.spec.ts \
        artifacts/api-server/src/__tests__/modelIdSetEquality.test.ts \
        docs/CHANGELOG-implementation.md model-integration-precheck.md
git commit -m "[ch5-edit-9] rewrite the delivery e2e journey and add the registry set-equality test"
```

---

## Self-Review

**1. Spec coverage.** §14.1 tab set → Task 5. §14.2 contract → Task 2. §14.3 solver → Task 3. §14.4 infeasibility → Task 3 (three cases, each its own test). §14.5 UI: tabs → Task 5, map rename → Task 6, Open-facilities → Task 7, `sizeByDemand` → Task 8. §14.6 testing → distributed, with the pinned values from Task 1. §14.7 registration points → Tasks 2, 5. §14.8: G6 id form → Task 2 Step 1's prefix test; G2 precheck → Task 4; G3 rename completeness → Task 6 Step 4; G4 sibling spec → Task 9 Step 1; G5 capability sweep → Task 0 Step 4 and Task 2 Step 7; G1 goldens → Task 1; G7 exclusion × overflow → Task 3 Step 1. §16.4: #1 goldens → Task 1; #2 re-anchoring → Task 0 Step 3; #3 registry test → Task 9 Step 2; #4 canonical copy → Task 0 Step 1.

**2. Placeholder scan.** One deliberate exception: Task 3's `PIN_G1_OBJECTIVE`, `PIN_G1_WAD`, `PIN_G2_OBJECTIVE`, `PIN_G2_WAD` are named placeholders, because the numbers do not exist until Task 1 runs the prototype. That is the point of ordering Task 1 first, and the step says so explicitly rather than inviting a guess. Two places name a convention instead of repeating code: Task 5's render helper (copy `Workspace.TabCoverage.test.tsx`'s) and Task 6's testids (read from source — a previous brief's guessed list was wrong).

**3. Type consistency.** `warehouseOverrides` / `customerOverrides` are declared in Task 2 and consumed in Tasks 4, 5. The wire fields `customerDemands` / `excludedCustomerIds` / `warehouseStatuses` are produced in Task 2 and consumed in Task 3. `get_demand` / `get_bounds` / `customers_list` / `active_demand` are declared in Task 3 and used only there. `fixedGeography` replaces `readOnly` in Task 6 and appears nowhere earlier. Status values are `active` / `forced_open` / `inactive` throughout; customer status is `active` / `excluded` throughout.

**Open risk to watch at review:** Task 2 flips two capabilities on a **live, shipped** manifest. Task 0 Step 4's sweep is the only thing standing between that and a test whose coverage silently shifts — and the previous branch's evidence is that a reviewer claiming a gate is green is not the same as the gate being green.

---

# Plan review — 2026-09-29

An independent pass over this plan at `ee5f9c0`, with every repo claim it makes
re-measured against the working tree rather than read off the plan. **Three blocking
defects, and all three fail silently** — no exception, no red test, just wrong
behaviour or a test chasing a non-bug. Fix them in the plan text before Task 1 runs;
they are plan defects, not implementation risk.

The findings share one shape: *the plan names N call sites and there are M.* Two of the
five shared symbols it changes had an undercount. §R.4's method exists for that.

## R.1 Blocking

### B1 — Task 6 misses `PMEDIAN_MAP_READONLY_NOOP`; map edits are silently discarded

`Workspace.tsx:146` declares `const PMEDIAN_MAP_READONLY_NOOP = (_next: PMedianMapInputs) => {};`
and `:3268` wires it in:

```tsx
onInputsChange={modelId === "delivery-teaching-us" ? PMEDIAN_MAP_READONLY_NOOP : handlePMedianMapInputsChange}
readOnly={modelId === "delivery-teaching-us"}
```

Task 6 renames `readOnly` → `fixedGeography` and removes the gate from the status and
demand affordances, but touches **neither the noop const nor line 3268**. The map then
renders status and demand controls whose every change is handed to a function with an
empty body. Nothing throws, nothing fails: Task 6 Step 1's tests assert only that the
controls are *present*.

**Fix.** Task 6 must also route `delivery-teaching-us` to a real `onInputsChange` — either
`handlePMedianMapInputsChange` or a narrowed handler that accepts status and demand and
ignores geometry — and retire or re-scope `PMEDIAN_MAP_READONLY_NOOP`. Add a test that a
status edit on the map actually reaches `onInputsChange`, not merely that the control renders.

### B2 — Task 8 flips four of nine sites; the checkbox unchecks while markers stay sized

Measured, not quoted. `sizeByDemand ?? true` appears at:

| File | Lines | What they are |
|---|---|---|
| `InputMapTab.tsx` | 859, 1363, 1856, 2436 | the four `LayerCheckbox` sites the plan names |
| `InputMapTab.tsx` | **952, 1432, 1953, 2504** | `sizeByDemand={toggles.sizeByDemand ?? true}` passed down to the child |
| **`EntityMarkers.tsx`** | **193** | `const sizeByDemand = toggles.sizeByDemand ?? true;` |

Task 8 Step 3 names only the first row, and Task 8's file list names only `InputMapTab.tsx`.
Flipping just those four leaves the **checkbox rendering unchecked while the markers are still
sized by demand** — a visible contradiction between control and map, with no failing test,
because Task 8 Step 1 asserts the checkbox's own state and nothing downstream.

**Fix.** Flip all nine. Add `EntityMarkers.tsx` to Task 8's file list. Assert the **marker
radius** (or the prop `EntityMarkers` receives), not just `toBeChecked()`.

### B3 — Task 3's overflow test asserts a sum that cannot be 100

`solve_delivery` accumulates band demand **cumulatively** (`if d <= b: band_demand[b] += …`)
and then appends an **exclusive** overflow row:

```python
band_coverage = [{"band": b, "percent": round(band_demand[b] * 100 / total_demand, 2)}
                 for b in distance_bands]
if overflow_demand:
    band_coverage.append({"band": -1, "percent": round(overflow_demand * 100 / total_demand, 2)})
```

For bands `[100, 200]` the rows are `P≤100`, `P≤200`, and `100 − P≤200`. Their sum is
`100 + P≤100`, not `100`. On this dataset `P≤100 > 0`, so

```python
assert sum(rows.values()) == pytest.approx(100.0, abs=0.05)
```

**fails against a correct solver.** An implementer following the plan literally will go
looking for a bug in `solve_delivery` that is not there.

**Fix.** The invariant that actually holds is largest-band plus overflow:

```python
assert rows[200] + rows[-1] == pytest.approx(100.0, abs=0.05)
```

Keep the `-1 in rows` assertion and the post-exclusion-denominator intent (§14.8 / G7) —
only the arithmetic changes.

## R.2 High

**H1 — the gate omits `e2e_journey.py`, which has a live delivery journey.**
`e2e_journey.py:620` defines `journey_delivery()`, which fetches
`/api/dataset?modelId=delivery-teaching-us` and solves; CLAUDE.md records the script as real
coverage dispatching `auth|dataset|pmedian|transport|delivery|brazil`. Task 2's manifest flip
and Task 5's tab change are precisely what it exercises, and Task 9 Step 4 runs only
`e2e_accuracy.py`. Add `python3 e2e_journey.py http://localhost:3001 delivery` to Task 9
Step 4 **and** to Task 0 Step 5's baseline, so the before/after comparison exists.

**H2 — `modelIdSetEquality.test.ts` already exists; Task 9 Step 2's premise is wrong.**
The file is present and already asserts `MODEL_IDS ≡ KNOWN_MODEL_IDS ≡ VALID_MODEL_IDS ≡
PACKAGE_SPECS`, all four OpenAPI enum sites, and `StudioModelType`. It is not "still unbuilt".
What is genuinely missing is **`KNOWN_SCHEMAS`** and **`solve.py`'s dispatcher**. And the
existing test carries its own defect: the `it(...)` title reads *"KNOWN_SCHEMAS,
VALID_MODEL_IDS and PACKAGE_SPECS match MODEL_IDS exactly"* while the body asserts
`KNOWN_MODEL_IDS` — `KNOWN_SCHEMAS` is never asserted at all. A title that misdescribes its
own body is the same class as the vacuous `.not.toBe(<status>)` assertion this plan warns
about in Global Constraints. Task 9 Step 2 should: correct the title, add `KNOWN_SCHEMAS`,
add the solver dispatcher.

**H3 — Task 6 must invert an existing test it presents as new.**
`artifacts/studio/src/__tests__/InputMapTab.deliveryReadOnly.test.tsx` already exists and at
`:161-170` asserts that clicking a marker shows the details card but **no** action menu and no
`map-action-*` entries. If status editing lands behind either, that test now contradicts Task 6.
The plan lists the file only under Task 6's "Test:" line and omits it from the File Structure
table, so it reads as a new file. This is the same inversion Task 7 handles explicitly for
`CostSummaryTab.test.tsx` — it deserves the same explicit step. Separately, Task 6 Step 1
**guesses** the testids `edit-warehouse-status` and `edit-customer-demand-input` one line
before instructing the implementer to read testids from source rather than guess.

## R.3 Medium and low

| ID | Finding |
|---|---|
| M1 | Task 0 Step 1's `git push . HEAD:main` contradicts the standing harness invariant *"No documentation reaches `main` except via a reviewed PR."* Asking first satisfies the merge-preference rule but not this one. Route it through a PR, or record the exception in the plan with its reason. |
| M2 | Task 0 reconciles the canonical doc; Task 1 Step 3 edits §14.6 on the branch immediately after, so the reconciliation lasts exactly one task. Not wrong — but the plan should name when the doc re-merges (Task 9 closeout) or Task 0's rationale reads stronger than it is. |
| M3 | `test_overrides_do_not_move_the_frozen_goldens` pins **Scenario 1 only**. §14.6 calls both §8.1 columns the fence, and Scenario 2 is the one that exercises the cost-adjust path the new override code sits beside. Add the adjusted column. |
| M4 | No QA task and no `/harness-retro`. CLAUDE.md: *"A branch is not finished until `/harness-retro <task_id>` has run."* Task 9's e2e rewrite is spec authoring, not exploratory real-browser QA; the standing expectation is a dedicated QA task. |
| M5 | Task 8 changes a shared-map default for all seven models, while Global Constraints forbids touching `input-map-v2` and `tab-coverage`. If either asserts demand-sized markers, Task 8 breaks a spec the implementer is barred from fixing. Name the resolution up front rather than discovering it at Task 9's gate. |
| L1 | Task 6 Step 4's completeness grep covers only `InputMapTab.tsx` and `MapDetailsCard.tsx`. `readOnly` also appears in `Workspace.tsx`, `Workspace.test.tsx`, `MapDetailsCard.test.tsx` and the delivery map test. Typecheck is the real backstop; the grep is advertised as the proof and is not one. |
| L2 | The plan never states that **no OpenAPI or codegen change is needed** — scenario `inputs` is a free-form `type: object` by design (§6.6). Global Constraints mentions codegen, which invites a pointless regeneration. |
| L3 | Global Constraints omits **hard rule 6** (*"solver changes enter as data, not branches"*) — the rule Task 3's `get_bounds` / bound-rows design exists to satisfy. Citing it defends the design at review instead of leaving it to be re-litigated. |

## R.3.1 Claims re-measured and confirmed correct

Recorded so the review is not read as uniformly negative, and so these are not re-checked:

- `attached_assets/COG-Model-Data-3DC-3WH.xlsx` — the filename in Task 1 Step 2 is exact.
- `readOnly` is 17 hits in `InputMapTab.tsx`, and the rename trap is real: `FreezeConfirmDialog.tsx`
  and `SolveDialog.tsx` carry their own unrelated `readOnly`. Scoping the rename is correct.
- `runNetworkEditsPrecheckForModel(modelId, inputs): PrecheckResult` is **synchronous**, as Task 4's
  tests assume, and `reference_integrity` is a member of the closed `PrecheckErrorCode` union.
- `solve_delivery(inp)` is at `solve.py:1557`; `DELIV_WAREHOUSES` / `DELIV_CUSTOMERS` exist as named.
- `inputEntriesForModel`'s delivery case currently returns exactly three entries
  (`input-map`, `deliveryCosts`, `optimization-parameters`) and the switch tail is
  `case "p-median-brazil": case "p-median-us": default:` — the omission hazard is as described.

## R.4 Closeout strategy

1. **Fix B1–B3 in the plan text first.** They are wrong instructions, not risky ones; an
   implementer who follows the plan faithfully still ships two silent bugs and debugs a
   third that does not exist.
2. **Add a Task 0 Step 6 — consumer census.** For every shared symbol this plan changes
   (`sizeByDemand`, `readOnly`, `supportsFacilityStatus`, `demandEditable`, the map's
   `onInputsChange`), count *every* read site and compare the count against the number the
   plan states. **A mismatch is a stop-and-report**, not a note. Two of five were wrong here.
3. **Correct H1–H3 and M1–M5 in place**, each as an explicit step in its own task rather
   than a note, so a checkbox exists for it.
4. **Add a Task 10: QA, whole-branch review, retro.** Real-browser QA of the five-tab
   surface and the editable map, a whole-branch review pass, then `/harness-retro`. The
   previous branch needed a `[ch5-del-fix]` whole-branch-review commit; this plan has no
   equivalent slot.
5. **Re-measure every "expected" number at Task 0**, do not carry it from `ec54a6f`. The
   plan already says line numbers will drift; the same applies to its gate counts and to
   the `43 passed / 13 failed / 4 skipped` e2e baseline.
6. **Track closure in a review matrix** — `Finding · Task · Fix · Owner · Status · Evidence`,
   one row per B/H/M/L above, closed only with a named test or a stated reason none is possible.

## R.5 Dependency-check methods

The generalisable lesson from B1 and B2: **the plan's factual errors were all undercounts of
call sites.** So the method is count-first, and a count mismatch halts the task.

```bash
# The five shared symbols this plan changes. Compare each count to the plan's stated count.
grep -rn "sizeByDemand" artifacts/studio/src | grep -v node_modules            # plan says 4; there are 9
grep -rln "readOnly" artifacts/studio/src | grep -v node_modules               # incl. the two unrelated dialogs
grep -rn "PMEDIAN_MAP_READONLY_NOOP\|onInputsChange" artifacts/studio/src/pages/Workspace.tsx
grep -rn "supportsFacilityStatus\|demandEditable" artifacts lib --include=*.ts --include=*.tsx | grep -v /dist/
grep -rn "delivery-teaching-us" artifacts lib e2e scripts solvers | grep -v node_modules
```

Two structural checks that turn this from a grep habit into a gate:

- **Finish the registry set-equality test** (H2) — add `KNOWN_SCHEMAS` and `solve.py`'s
  dispatcher, and fix its misleading title. It is still the one item in this plan that
  reduces future work.
- **Run both standalone solver scripts, not one.** `python3 -m pytest tests/` discovers
  neither `e2e_accuracy.py` nor `e2e_journey.py`. The gate must name both, and
  `e2e_journey.py delivery` is the only automated check that exercises this model end to end
  over real HTTP.

Line references above were read at `ee5f9c0` and will drift — locate by symbol, as
Global Constraints already requires.
