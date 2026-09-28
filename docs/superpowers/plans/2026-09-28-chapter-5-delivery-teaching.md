# Chapter 5 Delivery Company Teaching Example — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `delivery-teaching-us`, the 7th model — a p-median facility-location lab over the COG dataset (33 candidate DCs, 313 customers) whose objective runs off a **cost table kept separate from the distance table**, plus an "Adjust Cost Table" toggle that reprices lanes against a distance threshold.

**Architecture:** A new self-contained `solve_delivery()` in the shared `solve.py` behind a new `modelType: "delivery"` — no existing solver's mathematics is touched. The cost table is a second dataset file seeded identical to distances; the student overrides it sparsely; the rate adjustment is derived at solve time and never written back. Every distance metric is accumulated from the distance table, never from the objective.

**Tech Stack:** Python 3 + PuLP/CBC (solver), Express 5 + Drizzle (API), Zod validators, OpenAPI + Orval codegen, React + Vite + TanStack Query (Studio), vitest/supertest (API), vitest/RTL (Studio), Playwright (e2e), pytest (solver).

**Source spec:** [`docs/superpowers/specs/2026-09-28-chapter-5-delivery-teaching-design.md`](../specs/2026-09-28-chapter-5-delivery-teaching-design.md) — Rev 2, review-folded. Decisions 1–14 in its §3; the 18-point registration checklist in its §9.

**Status: Rev 1 — reviewed 2026-09-28, NOT yet folded.** The [Review record](#review-record-2026-09-28-rev-1) at the bottom of this document lists 9 blocking defects, 17 should-fix items, and 12 nits, each with a disposition. **Do not execute Tasks 1–13 from this revision.** Rev 2 folds every blocking and should-fix item into its task body in place; until Rev 2 lands, the task bodies above contain code that is known not to compile or not to pass.

---

## Global Constraints

Every task's requirements implicitly include this section.

**From the spec (exact values, verbatim):**

- Model id `delivery-teaching-us`; private wire `modelType` `delivery`; validator `deliveryInputsSchema`; solver entry `solve_delivery`. Route `/chapter-5/delivery`. Chapter label `Chapter 5`, title `Delivery Company Teaching Example`.
- Dataset: **33** warehouses, **313** customers, **10,329** lanes in each of `distances.json` and `costs.json` (dense 33 × 313, 0 missing, 0 duplicate). Total demand **208,829,000**. Distance range 0.0 – 3268.87 mi including **33 zero-distance self-lanes**. 3,819 lanes ≤ 800 mi; **0 lanes exactly 800 mi**.
- Ids are role-prefixed: warehouses `W<sheet id>`, customers `C<sheet id>`. Lane keys `"W8,C269"`.
- Defaults: `p` 3, `distanceBands` [400, 800, 1200, 1600], `gap` 0, `timeLimitSec` 120, `costAdjustEnabled` false, `distanceThreshold` 800, `costPerMile` 1, `costPerMileOver` 10.
- Effective cost: `ec[w,c] = cost[w,c] * (costPerMile if dist[w,c] <= threshold else costPerMileOver)` when enabled, else `cost[w,c]`. **Threshold compares `dist`; the rate multiplies `cost`; `<=` takes the low rate.**
- Constraints: `Σ_w y[w,c] = 1` per customer; `Σ_w o[w] <= P` (**`LpConstraintLE`**, not `EQ`); `y[w,c] <= o[w]` per pair.
- **`dist` is read-only for the whole solver.** Overrides land on `cost` only.
- `weightedAvgDistance` is its own accumulator — **never** `objective / total_demand`.
- `edges[].distance` carries the real distance, never the effective cost.
- Envelope precision: `objective` 2 dp, `weightedAvgDistance` 4 dp, band percentages 2 dp.
- Band coverage is **cumulative**, with an explicit Overflow row beyond the largest band.
- No capacity constraint. `capacityModes: []`. `utilizationByNode` is **not** emitted.
- Cost domain: lane overrides `finite().nonnegative()`; rates strictly positive.
- `p` bounded 1–33 in the schema **and** at both UI mounts via `pMax={33}`.
- Only this model becomes visible on Landing. `transport-coal` and `p-median-brazil` keep `hiddenFromLanding: true`. Landing goes from 3 visible labs to 4.
- Editable surface is the cost table **only**. No demand edits, no added entities, no facility status, no distance editor.

**Frozen goldens (spec §8.1) — these are the acceptance numbers:**

| | Scenario 1 (`costAdjustEnabled: false`) | Scenario 2 (`true`, 800 / 1 / 10) |
|---|---|---|
| Objective | 88,240,913,478.10 | 150,194,534,098.60 |
| Open DCs | `W1`, `W2`, `W60` | `W6`, `W43`, `W45` |
| Weighted avg. distance | 422.5511 mi | 508.6534 mi |
| % within 400 / 800 / 1200 / 1600 | 59.38 / 81.45 / 99.44 / 100.00 | 26.43 / 97.19 / 100.00 / 100.00 |

**From CLAUDE.md (hard rules that bind these tasks):**

- **`e2e_accuracy.py` is sacred.** Run it; never edit it. This model's goldens live in `test_delivery.py`. Modifying it needs explicit human approval.
- Never hand-edit `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`. Edit `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`, commit spec + regenerated output in the **same** commit.
- Ownership filtering is security-critical: non-owned resources return **404, never 403**.
- Solver business rules enter as data, never as new `if/else` paths in existing solver functions.
- One task = one commit. Message format `[<task-id>] <imperative summary>`.
- **Run every api-server command with `DATABASE_URL` inline.** `lib/db/src/index.ts` throws at import time without it; eight suites otherwise fail at *collection* and look like real failures. Use `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`.

**Learned from the Chapter 4 migration and this spec's review — not optional:**

- **Never assert on `Function.prototype.toString()`.** The vitest/esbuild transform strips comments, so a source-shape assertion against a stringified function silently tests nothing. Use `readFileSync` (as `lockedModelGuards.test.ts:33,82` does) or a real seam.
- **Five of this model's registration points fail silently.** A permissive `inputEntriesForModel` default, an unmounted router, a pre-approving precheck, a blank export city column, and a `pMax` that disagrees with the schema. None produces an error. Each has its own task step and its own test.
- Do not import across packages to satisfy a test — it forces `rootDir` changes and breaks the build.

---

## Plan-resolution notes (spec text vs. the repo as it stands)

Verified against the tree at `f9107ba`. Each is resolved inside a task rather than left for the implementer to discover.

| # | Spec says | Repo actually | Resolved in |
|---|---|---|---|
| 1 | "omit the model from tab allowlists" | `inputEntriesForModel` (`Workspace.tsx:1184`) ends `case "p-median-brazil": case "p-median-us": default:` — omission **grants** the full p-median editing surface | Task 9 |
| 2 | Override with an unknown id raises `UnresolvableIdError` | `runNetworkEditsPrecheckForModel` (`precheck.ts:1368`) returns `{ ok: true, errors: [] }` for an unregistered model, so it never reaches a 422 | Task 6 |
| 3 | `p` capped at 33 | Both `OptimizationParametersTab.tsx:151` and `SolveDialog.tsx:156` default `pMax = 50` | Task 10 |
| 4 | Band percentages to 2 dp | `computeCumulativeBandCoverage` (`lib/units/src/bands.ts:37-52`) returns `Math.round(...)` integers, and five models' tests are pinned to that | Task 12 |
| 5 | `costs.json` validated by `PACKAGE_SPECS` | `DistanceMap` is `z.record(z.string(), z.number())` (`dataset-schema/src/index.ts:23`) — accepts zeros **and negatives** | Task 8 |
| 6 | "create `referenceCosts.ts`" | `routes/index.ts` mounts every router explicitly; an unmounted route file 404s with no error | Task 8 |
| 7 | Open Warehouses shows Demand Served | Already true for `capacityModes: []` via `OpenWarehousesTab.tsx:158` — but only if the manifest is wired and `utilizationByNode` is absent | Task 12 |

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `scripts/extract-cog-dataset.py` | Transcribe the COG xlsx into the four dataset files. `--check` mode regenerates to a temp dir and byte-compares. |
| `solvers/delivery-teaching-us/manifest.json` | Model declaration + capabilities + `inputsSchema`. |
| `solvers/delivery-teaching-us/dataset/{warehouses,customers,distances,costs,version}.json` | The dataset package. |
| `artifacts/api-server/src/validation/inputs/delivery.ts` | `deliveryInputsSchema`. |
| `artifacts/api-server/src/data/deliveryDataset.ts` | Entity loader for `GET /dataset`. |
| `artifacts/api-server/src/data/referenceCosts.ts` | Base cost matrix + per-model builder registry + domain validation. |
| `artifacts/api-server/src/routes/referenceCosts.ts` | `GET /models/:id/reference-costs`. |
| `artifacts/api-server/src/__tests__/referenceCosts.test.ts` | 200 / ETag / 304 / 422 / malformed / mounted. |
| `artifacts/api-server/src/__tests__/deliveryContract.test.ts` | `buildPayload` + `deliveryInputsSchema`. |
| `artifacts/api-server/src/solver/tests/test_delivery.py` | Goldens and every solver invariant. |
| `artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx` | Sparse cost-override editor over the base matrix. |
| `artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx` | RTL coverage. |
| `artifacts/studio/src/__tests__/deliveryRegistration.test.tsx` | Tab set, read-only map, objective units. |
| `artifacts/studio/e2e/delivery-teaching.spec.ts` | Full journey. |

**Modified files**

| Path | Change |
|---|---|
| `artifacts/api-server/src/solver/solve.py` | `solve_delivery` + two pure seams + dispatcher branch + dataset loaders. |
| `artifacts/api-server/src/solver/pmedian.ts` | `SolveInput` union + `buildPayload` branch. |
| `artifacts/api-server/src/registry/modelRegistry.ts` | `KNOWN_SCHEMAS` + `supportsReferenceCosts` capability. |
| `artifacts/api-server/src/routes/scenarios.ts` | `VALID_MODEL_IDS`. |
| `artifacts/api-server/src/routes/dataset.ts` | Entity branch. |
| `artifacts/api-server/src/routes/index.ts` | Mount `referenceCostsRouter`. |
| `artifacts/api-server/src/services/precheck.ts` | `precheckDeliveryInputs` + dispatcher branch. |
| `artifacts/api-server/src/services/templates.ts` | `buildEffectiveFacilityCityLookup` branch. |
| `lib/dataset-schema/src/index.ts` | `PACKAGE_SPECS`, `MODEL_IDS`, `supportsReferenceCosts` in `ManifestSchema`. |
| `lib/api-spec/openapi.yaml` | 4 `modelId` enums, `ModelInfoCapabilities`, the reference-costs path. |
| `lib/units/src/bands.ts` | Opt-in decimal precision, default unchanged. |
| `lib/units/src/objective.ts` | `objectiveDimension` case. |
| `artifacts/studio/src/lib/chapters.ts` | `StudioModelType` + `CHAPTERS` entry. |
| `artifacts/studio/src/pages/Workspace.tsx` | `defaultInputsForModel`, explicit `inputEntriesForModel` case, read-only map, tab render gates, `pMax`. |
| `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx` | Adjust Cost Table control. |
| `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx` | Read-only mode. |
| `artifacts/api-server/src/registry/__tests__/registration.test.ts` | `SOLVABLE` + exact count. |
| `artifacts/api-server/src/solver/tests/e2e_journey.py` | `delivery` journey. |
| `README.md`, `CLAUDE.md`, `attached_assets/NOTEBOOKS.md`, `model-integration-precheck.md`, `docs/CHANGELOG-implementation.md` | Closeout. |

---

## Task 0: Freeze the base and run the dependency audit

**Files:** none changed. Produces a recorded finding list, not a diff.

**Why it is a task and not a paragraph.** The spec's §9 has 18 registration points, six found only by reading source. This audit runs **twice** — now, and again before closeout — because a consumer added *during* implementation is exactly what a single up-front sweep misses.

- [ ] **Step 1: Record and verify the base commit**

```bash
git rev-parse HEAD
git log --oneline -1
git diff --check
```

Record the SHA in the branch's progress ledger. Expected: a clean `git diff --check` with no output.

- [ ] **Step 2: Confirm the Chapter 4 migration is in ancestry**

The spec's line references were captured after that migration merged. Building on a tree without it means `max-coverage-us` does not exist and half the reference patterns are missing.

```bash
git merge-base --is-ancestor 1761260 HEAD && echo "migration present" || echo "STOP - migration not in ancestry"
```

Expected: `migration present`.

- [ ] **Step 3: Enumerate every registry that must learn the new id**

```bash
rg -n 'p-median-us' artifacts lib scripts --type ts --type tsx --type py -l | sort
rg -n 'MODEL_IDS|VALID_MODEL_IDS|KNOWN_SCHEMAS|PACKAGE_SPECS|SOLVABLE' artifacts lib
```

Expected known set, matching spec §9: `modelRegistry.ts` (`KNOWN_SCHEMAS`), `dataset-schema/src/index.ts` (`PACKAGE_SPECS`, `MODEL_IDS`), `routes/scenarios.ts` (`VALID_MODEL_IDS`), `registration.test.ts` (`SOLVABLE`), `openapi.yaml` (×4), `pmedian.ts` (`SolveInput`, `buildPayload`), `solve.py` (dispatcher), `chapters.ts` (`StudioModelType`, `CHAPTERS`), `Workspace.tsx` (`defaultInputsForModel`, `inputEntriesForModel`), `objective.ts`, `precheck.ts`, `templates.ts`, `dataset.ts`, `routes/index.ts`. **Anything else is a finding** — record it with its disposition before Task 1.

- [ ] **Step 4: Baseline the counts that will change**

```bash
rg -n 'toHaveLength\(6\)|six models|[0-9]+ labs|hiddenFromLanding' artifacts lib README.md CLAUDE.md
```

Known: `README.md:155,171` say "six models". `registration.test.ts` carries an exact count. Landing goes 3 visible labs → 4.

**Do not treat `bundle4-auth-landing.spec.ts` / `bundle6-ui-tweaks.spec.ts` as a correct baseline.** `docs/CHANGELOG-implementation.md:411` records both asserting `"2 labs"` when the true figure has been 3 since Chapter 4 was unlocked. They are already wrong at main; fix them to the true post-change value rather than incrementing their current one.

- [ ] **Step 5: Baseline the gate**

```bash
pnpm run typecheck
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
pnpm --filter studio test
(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
```

Record pass counts. A red baseline is a stop-and-report, not something to implement through. If the package manager cannot bootstrap, resolve that **first** — a failed bootstrap is neither a pass nor a fail and must not be recorded as either.

- [ ] **Step 6: Write the findings into the progress ledger**

An audit whose findings are not written down is an audit that did not happen.

---

## Task 1: Extract the COG dataset

**Files:**
- Create: `scripts/extract-cog-dataset.py`
- Create: `solvers/delivery-teaching-us/dataset/{warehouses,customers,distances,costs,version}.json`
- Modify: `attached_assets/NOTEBOOKS.md`
- Create (copy): `attached_assets/COG-Network-Optimization.ipynb`, `attached_assets/COG-Model-Data-3DC-3WH.xlsx`, `attached_assets/Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb`

**Interfaces:**
- Produces: the dataset package consumed by every later task. Lane keys `"W<n>,C<n>"`; entity files are id-keyed record maps (`max-coverage-us`'s convention, not `p-median-us`'s ordinal one).
- Consumes: nothing.

- [ ] **Step 1: Verify the source hashes before copying anything**

`~/Downloads` is not a controlled source directory. These are the values recorded during design (spec §4.3):

```bash
shasum -a 256 \
  "$HOME/Downloads/COG_CaseStudy_v2/Network Optimization.ipynb" \
  "$HOME/Downloads/COG_CaseStudy_v2/COG Model Data for In Class Example  3 DC 3 WH.xlsx" \
  "$HOME/Downloads/network-optimization-studio/Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb"
```

Expected, exactly:

```
f3de39fb9306d5836a986a0f5349be285e883c904d91d9487b679b8d62f5c097  .../Network Optimization.ipynb
0b8feeba841d55cdbc3c9b852413e0fbc80cb1dc06b7531ef3503a9e42be28c3  .../COG Model Data for In Class Example  3 DC 3 WH.xlsx
98ef03da4fee2f54d9f5d30fbe88f212b870b92fa5aab11ba46b3e266c07fd01  .../Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb
```

Any mismatch is a **stop-and-report** — the source changed since design and the goldens in this plan may no longer describe it.

- [ ] **Step 2: Copy the three sources into `attached_assets/`**

```bash
cp "$HOME/Downloads/COG_CaseStudy_v2/Network Optimization.ipynb" \
   attached_assets/COG-Network-Optimization.ipynb
cp "$HOME/Downloads/COG_CaseStudy_v2/COG Model Data for In Class Example  3 DC 3 WH.xlsx" \
   attached_assets/COG-Model-Data-3DC-3WH.xlsx
cp "$HOME/Downloads/network-optimization-studio/Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb" \
   attached_assets/
shasum -a 256 attached_assets/COG-Network-Optimization.ipynb \
              attached_assets/COG-Model-Data-3DC-3WH.xlsx \
              attached_assets/Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb
```

Re-hash after the copy and confirm the three values are unchanged.

- [ ] **Step 3: Write the extraction script**

Create `scripts/extract-cog-dataset.py`. It uses only the standard library — `pandas` is **not** installed in this environment, so the xlsx is parsed with `zipfile` + `ElementTree`.

```python
#!/usr/bin/env python3
"""Transcribe the COG in-class workbook into solvers/delivery-teaching-us/dataset/.

Chapter 5 (modified) — Delivery Company Teaching Example.

The workbook's `Plants` and `Customers` sheets reuse ONE id space (plant 8 and
customer 8 are both Atlanta), so ids are role-prefixed here: W<n> / C<n>. Lane
keys are "W8,C269", matching max-coverage-us's id-keyed convention rather than
p-median-us's older ordinal one.

costs.json is written as a byte-for-byte copy of distances.json's values:
"for just this example the cost and the distance are the same" (spec decision 3).
They are separate files because a student overrides cost and never distance.

Usage:
  python3 scripts/extract-cog-dataset.py --xlsx attached_assets/COG-Model-Data-3DC-3WH.xlsx
  python3 scripts/extract-cog-dataset.py --xlsx ... --check
"""
import argparse
import filecmp
import hashlib
import json
import os
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"m": M, "r": R}

EXPECTED_XLSX_SHA256 = "0b8feeba841d55cdbc3c9b852413e0fbc80cb1dc06b7531ef3503a9e42be28c3"
EXPECTED_WAREHOUSES = 33
EXPECTED_CUSTOMERS = 313
EXPECTED_LANES = 10329
EXPECTED_TOTAL_DEMAND = 208829000


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sheet_rows(z, sheets, sst, name):
    target = sheets[name]
    path = target if target.startswith("xl/") else "xl/" + target.lstrip("/")
    ws = ET.fromstring(z.read(path))

    def cell_value(c):
        t = c.get("t")
        v = c.find("m:v", NS)
        if t == "s":
            return sst[int(v.text)]
        return v.text if v is not None else None

    return [[cell_value(c) for c in row.findall("m:c", NS)]
            for row in ws.iter("{%s}row" % M)]


def load_workbook(xlsx_path):
    z = zipfile.ZipFile(xlsx_path)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target")
            for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    sheets = {s.get("name"): rels[s.get("{%s}id" % R)]
              for s in wb.find("m:sheets", NS)}
    sst = ["".join(t.text or "" for t in si.iter("{%s}t" % M))
           for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
    return z, sheets, sst


def num(raw, places):
    """Strip IEEE noise: 622.11569999999995 -> 622.1157."""
    return round(float(raw), places)


def build(xlsx_path):
    z, sheets, sst = load_workbook(xlsx_path)

    plants = sheet_rows(z, sheets, sst, "Plants")
    customers = sheet_rows(z, sheets, sst, "Customers")
    demand = sheet_rows(z, sheets, sst, "Demand")
    distances = sheet_rows(z, sheets, sst, "Distance Matrix")

    ph, ch, dh, xh = plants[0], customers[0], demand[0], distances[0]

    warehouses = {}
    for r in plants[1:]:
        wid = "W" + r[ph.index("ID")]
        warehouses[wid] = {
            "id": wid,
            "city": r[ph.index("City")],
            "state": r[ph.index("State")],
            "lat": num(r[ph.index("Latitude")], 6),
            "lng": num(r[ph.index("Longitude")], 6),
            "zip": r[ph.index("Zip Code")],
        }

    demand_by_customer = {r[dh.index("Customer ID")]: float(r[dh.index("Demand")])
                          for r in demand[1:] if r[dh.index("Demand")] is not None}

    customers_out = {}
    for r in customers[1:]:
        raw_id = r[ch.index("ID")]
        cid = "C" + raw_id
        customers_out[cid] = {
            "id": cid,
            "city": r[ch.index("City")],
            "state": r[ch.index("State")],
            "lat": num(r[ch.index("Latitude")], 6),
            "lng": num(r[ch.index("Longitude")], 6),
            "zip": r[ch.index("Zip Code")],
            "demand": demand_by_customer[raw_id],
        }

    lanes = {}
    for r in distances[1:]:
        key = "W" + r[xh.index("Plant ID")] + ",C" + r[xh.index("Customer ID")]
        if key in lanes:
            raise SystemExit("duplicate lane key: " + key)
        lanes[key] = num(r[xh.index("Distance")], 4)

    # Fail loud rather than emitting a plausible-but-wrong package.
    assert len(warehouses) == EXPECTED_WAREHOUSES, len(warehouses)
    assert len(customers_out) == EXPECTED_CUSTOMERS, len(customers_out)
    assert len(lanes) == EXPECTED_LANES, len(lanes)
    assert sum(c["demand"] for c in customers_out.values()) == EXPECTED_TOTAL_DEMAND
    missing = [(w, c) for w in warehouses for c in customers_out
               if f"{w},{c}" not in lanes]
    assert not missing, f"{len(missing)} missing lanes, e.g. {missing[:3]}"

    return {
        "warehouses.json": warehouses,
        "customers.json": customers_out,
        "distances.json": lanes,
        "costs.json": dict(lanes),   # seeded identical - spec decision 3
    }


def write_files(files, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for name, payload in files.items():
        with open(os.path.join(out_dir, name), "w") as fh:
            json.dump(payload, fh, indent=2, sort_keys=False)
            fh.write("\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--out-dir", default="solvers/delivery-teaching-us/dataset")
    ap.add_argument("--check", action="store_true",
                    help="regenerate into a temp dir and byte-compare; write nothing")
    args = ap.parse_args()

    actual = sha256_of(args.xlsx)
    if actual != EXPECTED_XLSX_SHA256:
        raise SystemExit(
            f"source sha256 mismatch\n  expected {EXPECTED_XLSX_SHA256}\n  actual   {actual}")

    files = build(args.xlsx)

    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            write_files(files, tmp)
            bad = []
            for name in files:
                a, b = os.path.join(tmp, name), os.path.join(args.out_dir, name)
                if not os.path.exists(b) or not filecmp.cmp(a, b, shallow=False):
                    bad.append(name)
            if bad:
                raise SystemExit("DRIFT: " + ", ".join(bad))
            print("check OK - all 4 files byte-identical")
            return

    write_files(files, args.out_dir)
    print(f"wrote {len(files)} files to {args.out_dir}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the extraction**

```bash
python3 scripts/extract-cog-dataset.py --xlsx attached_assets/COG-Model-Data-3DC-3WH.xlsx
```

Expected: `wrote 4 files to solvers/delivery-teaching-us/dataset`, no assertion failure.

- [ ] **Step 5: Verify the extracted shape independently of the script**

```bash
python3 - <<'PY'
import json
d = "solvers/delivery-teaching-us/dataset/"
w = json.load(open(d + "warehouses.json"))
c = json.load(open(d + "customers.json"))
dist = json.load(open(d + "distances.json"))
cost = json.load(open(d + "costs.json"))
print("warehouses", len(w), "customers", len(c), "lanes", len(dist))
print("total demand", sum(x["demand"] for x in c.values()))
print("keys identical:", dist.keys() == cost.keys())
print("values identical:", dist == cost)
print("zero lanes:", sum(1 for v in dist.values() if v == 0))
print("exactly 800:", sum(1 for v in dist.values() if v == 800))
print("max distance:", max(dist.values()))
PY
```

Expected exactly: `warehouses 33 customers 313 lanes 10329`, `total demand 208829000`, `keys identical: True`, `values identical: True`, `zero lanes: 33`, `exactly 800: 0`, `max distance: 3268.8663` (or the 4 dp value from the sheet).

- [ ] **Step 6: Prove `--check` detects drift**

A check mode that has never failed is not known to work.

```bash
python3 scripts/extract-cog-dataset.py --xlsx attached_assets/COG-Model-Data-3DC-3WH.xlsx --check
python3 - <<'PY'
import json
p = "solvers/delivery-teaching-us/dataset/costs.json"
d = json.load(open(p)); k = next(iter(d)); d[k] = d[k] + 1
json.dump(d, open(p, "w"), indent=2); open(p, "a").write("\n")
PY
python3 scripts/extract-cog-dataset.py --xlsx attached_assets/COG-Model-Data-3DC-3WH.xlsx --check || echo "drift correctly detected"
python3 scripts/extract-cog-dataset.py --xlsx attached_assets/COG-Model-Data-3DC-3WH.xlsx
```

Expected: first `check OK`, then `DRIFT: costs.json` and `drift correctly detected`, then a clean regeneration.

- [ ] **Step 7: Update `attached_assets/NOTEBOOKS.md`**

It currently records Chapter 5 as having no notebook. Replace that with the three committed sources and their sha256 from Step 2, in the file's existing table format.

- [ ] **Step 8: Commit**

`version.json` is written in Task 2, because its sha256 covers exactly the files `PACKAGE_SPECS` lists and that spec does not exist yet.

```bash
git add scripts/extract-cog-dataset.py \
        solvers/delivery-teaching-us/dataset/ \
        attached_assets/COG-Network-Optimization.ipynb \
        attached_assets/COG-Model-Data-3DC-3WH.xlsx \
        attached_assets/Notebook_LP_Transportation_Problem_Chapter_5_Network_Design_Book.ipynb \
        attached_assets/NOTEBOOKS.md
git commit -m "[ch5-del-1] transcribe the COG dataset and commit its sources"
```

---

## Task 2: Manifest, package spec, and the `supportsReferenceCosts` capability

**Files:**
- Create: `solvers/delivery-teaching-us/manifest.json`
- Create: `solvers/delivery-teaching-us/dataset/version.json`
- Modify: `lib/dataset-schema/src/index.ts` (`ManifestSchema` capabilities ~`:226`, `PACKAGE_SPECS` `:115`, `MODEL_IDS` `:269`)
- Modify: `artifacts/api-server/src/registry/modelRegistry.ts:75,102`
- Test: `lib/dataset-schema/src/manifest.test.ts`

**Interfaces:**
- Produces: `getManifest("delivery-teaching-us")` resolves; `capabilities.supportsReferenceCosts: boolean` exists on the public model-info type; `readVersion("delivery-teaching-us")` returns `{ version, sha256 }`.
- Consumes: Task 1's dataset files.

- [ ] **Step 1: Write the failing manifest test**

Append to `lib/dataset-schema/src/manifest.test.ts`:

```ts
describe("delivery-teaching-us manifest (Chapter 5, 7th model)", () => {
  it("declares no capacity, P support, and reference costs", () => {
    const m = readManifest("delivery-teaching-us");
    expect(m.capabilities.supportsP).toBe(true);
    expect(m.capabilities.capacityModes).toEqual([]);
    expect(m.capabilities.demandEditable).toBe(false);
    expect(m.capabilities.supportsFacilityStatus).toBe(false);
    expect(m.capabilities.supportsReferenceCosts).toBe(true);
    expect(m.capabilities.supportsReferenceDistances).toBe(false);
    expect(m.distanceUnit).toBe("mi");
    expect(m.chapter).toBe("Chapter 5");
  });

  // capacityModes: [] is what drives OpenWarehousesTab's Demand Served column
  // (OpenWarehousesTab.tsx:158). An absent array falls through to the
  // capacityMode-string gate and renders a utilization % this model cannot
  // compute, so "empty" and "absent" are NOT interchangeable here.
  it("distinguishes an empty capacityModes array from an absent one", () => {
    expect(readManifest("delivery-teaching-us").capabilities.capacityModes).toHaveLength(0);
  });

  it("defaults supportsReferenceCosts to false for every pre-existing model", () => {
    for (const id of ["p-median-us", "transport-coal", "p-median-brazil",
                      "two-echelon-gold-au", "two-echelon-jade-us", "max-coverage-us"]) {
      expect(readManifest(id).capabilities.supportsReferenceCosts).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @workspace/dataset-schema exec vitest run src/manifest.test.ts
```

Expected: FAIL — manifest file does not exist.

- [ ] **Step 3: Write the manifest**

Create `solvers/delivery-teaching-us/manifest.json`:

```json
{
  "id": "delivery-teaching-us",
  "name": "Delivery Company Teaching Example",
  "chapter": "Chapter 5",
  "datasetDir": "solvers/delivery-teaching-us/dataset",
  "countryBounds": { "sw": [24, -125], "ne": [50, -66] },
  "distanceUnit": "mi",
  "capabilities": {
    "supportsP": true,
    "capacityModes": [],
    "demandEditable": false,
    "outputGrids": ["openWarehouses", "assignments", "costSummary", "serviceStats"],
    "supportsFacilityStatus": false,
    "supportsReferenceDistances": false,
    "supportsReferenceCosts": true,
    "supportsAddedCustomerExclusion": false
  },
  "inputsSchema": {
    "type": "object",
    "properties": {
      "p": { "type": "integer", "minimum": 1, "maximum": 33 },
      "distanceBands": {
        "type": "array",
        "items": { "type": "number", "exclusiveMinimum": 0 },
        "minItems": 1
      },
      "gap": { "type": "number", "minimum": 0 },
      "timeLimitSec": { "type": "integer", "minimum": 1 },
      "costAdjustEnabled": { "type": "boolean" },
      "distanceThreshold": { "type": "number", "exclusiveMinimum": 0 },
      "costPerMile": { "type": "number", "exclusiveMinimum": 0 },
      "costPerMileOver": { "type": "number", "exclusiveMinimum": 0 },
      "laneCostOverrides": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "fromId": { "type": "string", "minLength": 1 },
            "toId": { "type": "string", "minLength": 1 },
            "cost": { "type": "number", "minimum": 0 }
          },
          "required": ["fromId", "toId", "cost"]
        }
      }
    },
    "required": [
      "p", "distanceBands", "gap", "timeLimitSec",
      "costAdjustEnabled", "distanceThreshold", "costPerMile", "costPerMileOver"
    ]
  }
}
```

`countryBounds` reuses `p-median-us`'s continental-US box. The measured extent (lat 25.7783–48.7306, lng −123.0804–−68.8299) sits strictly inside it, so the map framing matches Chapter 3 and no bespoke bounds are needed.

- [ ] **Step 4: Declare the capability in `ManifestSchema`**

In `lib/dataset-schema/src/index.ts`, beside `supportsFacilityStatus` (~`:226`):

```ts
    // Chapter 5 delivery — the cost table is the only editable input, and it
    // is a SPARSE override list, so a student who has overridden nothing would
    // see an empty table. This capability gates GET /models/:id/reference-costs,
    // the cost-side mirror of supportsReferenceDistances. Defaults false so no
    // existing model's behaviour changes.
    supportsReferenceCosts: z.boolean().optional().default(false),
```

- [ ] **Step 5: Add the package spec and the id**

`PACKAGE_SPECS` (`:115`) gains, reusing the shared entry schemas exactly as `max-coverage-us` does:

```ts
  {
    modelId: "delivery-teaching-us",
    files: {
      "warehouses.json": z.record(z.string(), WarehouseEntry),
      "customers.json": z.record(z.string(), CustomerEntry),
      "distances.json": DistanceMap,
      "costs.json": DistanceMap,
    },
  },
```

`MODEL_IDS` (`:269`) gains `"delivery-teaching-us"`.

**`DistanceMap` is `z.record(z.string(), z.number())` — it accepts zeros and negatives.** It is a shape check, not a domain check. Domain validation lives in Task 8's reference-cost builder. Do not tighten `DistanceMap`; five models depend on its current permissiveness.

- [ ] **Step 6: Expose the capability through the registry**

In `artifacts/api-server/src/registry/modelRegistry.ts`, add to the capabilities interface (~`:75`):

```ts
    supportsReferenceCosts: boolean;
```

and to the mapping (~`:102`):

```ts
      supportsReferenceCosts: manifest.capabilities?.supportsReferenceCosts ?? false,
```

A capability declared only in the manifest is invisible to the frontend, which reads capabilities off `GET /api/models`.

- [ ] **Step 7: Generate `version.json`**

`computeSha256` hashes the `files` keys in sorted filename order — `costs.json`, `customers.json`, `distances.json`, `warehouses.json` — so the spec must exist first.

```bash
node --input-type=module -e "
import { PACKAGE_SPECS, computeSha256 } from '@workspace/dataset-schema';
import { writeFileSync } from 'fs';
const spec = PACKAGE_SPECS.find(s => s.modelId === 'delivery-teaching-us');
const sha256 = computeSha256(spec);
writeFileSync('solvers/delivery-teaching-us/dataset/version.json',
  JSON.stringify({ version: 1, sha256 }, null, 2) + '\n');
console.log(sha256);
"
```

Expected: a 64-character hex digest printed, and the file written.

- [ ] **Step 8: Run the manifest tests to verify they pass**

```bash
pnpm --filter @workspace/dataset-schema exec vitest run src/manifest.test.ts
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/registry.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add solvers/delivery-teaching-us/manifest.json \
        solvers/delivery-teaching-us/dataset/version.json \
        lib/dataset-schema/src/index.ts \
        lib/dataset-schema/src/manifest.test.ts \
        artifacts/api-server/src/registry/modelRegistry.ts
git commit -m "[ch5-del-2] register the delivery manifest, package spec, and reference-costs capability"
```

---

## Task 3: The Python solver

**Files:**
- Modify: `artifacts/api-server/src/solver/solve.py` (dataset loaders ~`:88`, new `solve_delivery` + seams, dispatcher `:1473`)
- Create: `artifacts/api-server/src/solver/tests/test_delivery.py`

**Interfaces:**
- Produces: `solve_delivery(inp)`; pure seams `_effective_delivery_costs(cost, dist, opts)` and `_build_delivery_problem(warehouses, customers, demand, ec, p)`; wire `modelType: "delivery"`.
- Consumes: Task 1's dataset files.

This task is first among the code tasks because it is the only one whose correctness is pinned by measured numbers. Everything downstream is plumbing around it.

- [ ] **Step 1: Write the failing golden tests**

Create `artifacts/api-server/src/solver/tests/test_delivery.py`:

```python
"""Chapter 5 (modified) - Delivery Company Teaching Example.

Goldens are measured, not predicted: the design-time prototype at
docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py solved this
exact formulation against the source workbook with PuLP/CBC. It shares no code
with solve.py, which is what makes it an independent oracle rather than a
restatement.
"""
import pytest
from solve import (
    solve_delivery,
    _effective_delivery_costs,
    _build_delivery_problem,
    DELIV_DISTANCES,
    DELIV_COSTS,
)

BASE = {
    "modelType": "delivery",
    "pValue": 3,
    "distanceBands": [400, 800, 1200, 1600],
    "gap": 0,
    "timeLimitSec": 300,
    "laneCostOverrides": [],
    "costAdjustEnabled": False,
    "distanceThreshold": 800,
    "costPerMile": 1,
    "costPerMileOver": 10,
}


def adjusted(**over):
    return {**BASE, "costAdjustEnabled": True, **over}


def bands_of(env):
    return {row["band"]: row["percent"] for row in env["metrics"]["bandCoverage"]}


def test_scenario_1_golden():
    env = solve_delivery(dict(BASE))
    assert env["solutionStatus"] == "optimal"
    assert env["objective"] == pytest.approx(88240913478.10, rel=1e-9)
    assert set(env["details"]["openWarehouseIds"]) == {"W1", "W2", "W60"}
    assert env["metrics"]["weightedAvgDistance"] == pytest.approx(422.5511, abs=5e-4)
    b = bands_of(env)
    assert b[400] == pytest.approx(59.38, abs=5e-3)
    assert b[800] == pytest.approx(81.45, abs=5e-3)
    assert b[1200] == pytest.approx(99.44, abs=5e-3)
    assert b[1600] == pytest.approx(100.00, abs=5e-3)


def test_scenario_2_golden():
    env = solve_delivery(adjusted())
    assert env["solutionStatus"] == "optimal"
    assert env["objective"] == pytest.approx(150194534098.60, rel=1e-9)
    assert set(env["details"]["openWarehouseIds"]) == {"W6", "W43", "W45"}
    assert env["metrics"]["weightedAvgDistance"] == pytest.approx(508.6534, abs=5e-4)
    b = bands_of(env)
    assert b[400] == pytest.approx(26.43, abs=5e-3)
    assert b[800] == pytest.approx(97.19, abs=5e-3)
    assert b[1200] == pytest.approx(100.00, abs=5e-3)
    assert b[1600] == pytest.approx(100.00, abs=5e-3)


def test_avg_distance_not_derived_from_objective():
    """The bug class this repo has already shipped twice (Ch9, Ch10).

    With the adjustment ON the objective is in dollars, so objective/demand is
    dollars-per-unit. If weightedAvgDistance were derived that way it would be
    a plausible number under a distance label - no exception, no failing
    assertion. 508.6534 mi vs 719.2... $/unit are far enough apart that this
    assertion cannot pass by coincidence.
    """
    env = solve_delivery(adjusted())
    total_demand = 208829000
    derived = env["objective"] / total_demand
    assert env["metrics"]["weightedAvgDistance"] == pytest.approx(508.6534, abs=5e-4)
    assert abs(env["metrics"]["weightedAvgDistance"] - derived) > 1.0


def test_toggle_off_equals_unit_rate():
    """"Off" IS the case study's Scenario 1 ($1/mile), because costs are
    seeded equal to distances. Nothing special-cases it."""
    off = solve_delivery(dict(BASE))
    unit = solve_delivery(adjusted(costPerMile=1, costPerMileOver=1))
    assert off["objective"] == pytest.approx(unit["objective"], rel=1e-9)


def test_facility_count_is_at_most_p():
    """Decision 8. Asserted against the BUILT PuLP problem, never source text."""
    import pulp
    ec = _effective_delivery_costs(DELIV_COSTS, DELIV_DISTANCES, BASE)
    prob, _y, o = _build_delivery_problem(ec, p=3)
    named = {c.name: c for c in prob.constraints.values()}
    assert "FacilityCount" in named
    assert named["FacilityCount"].sense == pulp.LpConstraintLE
    env = solve_delivery(dict(BASE))
    assert len(env["details"]["openWarehouseIds"]) <= 3


def test_threshold_boundary_is_inclusive():
    """Decision 7. Synthetic by necessity - zero real lanes measure exactly 800."""
    dist = {("W1", "C1"): 800.0, ("W1", "C2"): 800.0001}
    cost = {("W1", "C1"): 800.0, ("W1", "C2"): 800.0001}
    ec = _effective_delivery_costs(cost, dist, adjusted())
    assert ec[("W1", "C1")] == pytest.approx(800.0 * 1)
    assert ec[("W1", "C2")] == pytest.approx(800.0001 * 10)


def test_cost_override_does_not_move_distance_metrics():
    """The section 5.4 invariant, with the precondition FORCED.

    A large enough override legitimately changes the optimum and therefore
    legitimately moves WAD. This case picks a lane already in the base
    solution and lowers its cost, which cannot change which warehouses open;
    assignment equality is asserted before the metrics are compared.
    """
    base = solve_delivery(dict(BASE))
    lane = base["details"]["assignments"][0]
    over = solve_delivery({**BASE, "laneCostOverrides": [
        {"fromId": lane["warehouseId"], "toId": lane["customerId"], "cost": 0.0}]})
    assert set(over["details"]["openWarehouseIds"]) == set(base["details"]["openWarehouseIds"])
    assert _assignment_map(over) == _assignment_map(base)
    assert over["objective"] < base["objective"]
    assert over["metrics"]["weightedAvgDistance"] == pytest.approx(
        base["metrics"]["weightedAvgDistance"], abs=1e-9)
    assert over["metrics"]["bandCoverage"] == base["metrics"]["bandCoverage"]


def test_cost_override_large_enough_does_move_the_assignment():
    """The other side. A cost change that reroutes demand SHOULD move WAD;
    a test that only ever proves invariance would pass against a solver that
    ignored overrides entirely."""
    base = solve_delivery(dict(BASE))
    huge = [{"fromId": a["warehouseId"], "toId": a["customerId"], "cost": 1e7}
            for a in base["details"]["assignments"][:40]]
    over = solve_delivery({**BASE, "laneCostOverrides": huge})
    assert _assignment_map(over) != _assignment_map(base)


def test_edges_carry_distance_not_cost():
    """ServiceStatsTab recomputes live coverage from edges[].distance. Put cost
    there and the coverage bars silently become a cost histogram in miles."""
    env = solve_delivery(adjusted())
    for e in env["edges"]:
        assert e["distance"] == pytest.approx(DELIV_DISTANCES[(e["fromId"], e["toId"])])


def test_band_coverage_is_cumulative_and_exact():
    """Exact values, not merely non-decreasing - an exclusive rollup is also
    non-decreasing, so that assertion cannot tell the two semantics apart."""
    b = bands_of(solve_delivery(dict(BASE)))
    assert [b[400], b[800], b[1200], b[1600]] == [
        pytest.approx(59.38, abs=5e-3), pytest.approx(81.45, abs=5e-3),
        pytest.approx(99.44, abs=5e-3), pytest.approx(100.00, abs=5e-3)]


def test_overflow_band_is_emitted():
    """Both goldens reach 100% by 1600, so overflow needs a narrower band set."""
    env = solve_delivery({**BASE, "distanceBands": [100, 200]})
    total = sum(r["percent"] for r in env["metrics"]["bandCoverage"]
                if r["band"] in (100, 200))
    assert total < 100.0  # the remainder is beyond every band


def test_single_source():
    env = solve_delivery(dict(BASE))
    seen = {}
    for a in env["details"]["assignments"]:
        assert a["customerId"] not in seen
        seen[a["customerId"]] = a["warehouseId"]
    assert len(seen) == 313


def test_no_utilization_metric():
    """No capacity means no utilization denominator. Emitting one would plant a
    number nothing can compute; OpenWarehousesTab shows Demand Served instead."""
    env = solve_delivery(dict(BASE))
    assert "utilizationByNode" not in env["metrics"]


def test_unknown_override_id_raises():
    with pytest.raises(Exception):
        solve_delivery({**BASE, "laneCostOverrides": [
            {"fromId": "W999", "toId": "C1", "cost": 1.0}]})


def _assignment_map(env):
    return {a["customerId"]: a["warehouseId"] for a in env["details"]["assignments"]}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/test_delivery.py -x
```

Expected: FAIL — `ImportError: cannot import name 'solve_delivery' from 'solve'`.

- [ ] **Step 3: Add the dataset loaders**

In `artifacts/api-server/src/solver/solve.py`, beside the other module-level loaders (~`:88`):

```python
# Chapter 5 (modified) - Delivery Company Teaching Example. TWO lane tables:
# distances.json is read-only and is the sole source of every distance metric;
# costs.json is seeded identical but is what the student overrides and what the
# objective runs on. Keeping them separate is the whole point of the chapter.
DELIV_WAREHOUSES = _safe_load("delivery-teaching-us", "warehouses.json", default={})
DELIV_CUSTOMERS  = _safe_load("delivery-teaching-us", "customers.json",  default={})
_DELIV_DIST_RAW  = _safe_load("delivery-teaching-us", "distances.json",  default={})
_DELIV_COST_RAW  = _safe_load("delivery-teaching-us", "costs.json",      default={})

DELIV_DISTANCES = {tuple(k.split(',')): v for k, v in _DELIV_DIST_RAW.items()}
DELIV_COSTS     = {tuple(k.split(',')): v for k, v in _DELIV_COST_RAW.items()}
```

- [ ] **Step 4: Add the two pure seams and the solver**

Append to `solve.py`, before the dispatcher:

```python
def _effective_delivery_costs(cost, dist, inp):
    """Chapter 5 (modified) - the rate rule, and the ONLY place it exists.

    The threshold compares the DISTANCE; the rate multiplies the COST; `<=`
    takes the low rate (decisions 6 and 7). A cost value is "billable miles":
    seeded equal to true distance, so cost x $/mile is dollars, and editing a
    cost cell means "bill this lane as if it were N miles".

    Pure and separately callable so the boundary rule and the constraint sense
    can be asserted without inspecting source text.
    """
    if not inp.get('costAdjustEnabled'):
        return dict(cost)
    threshold = inp['distanceThreshold']
    low = inp['costPerMile']
    high = inp['costPerMileOver']
    return {k: v * (low if dist[k] <= threshold else high) for k, v in cost.items()}


def _build_delivery_problem(ec, p):
    """Build the LP and return it UNSOLVED, so tests can assert on structure."""
    warehouses = list(DELIV_WAREHOUSES.keys())
    customers = list(DELIV_CUSTOMERS.keys())
    demand = {c: DELIV_CUSTOMERS[c]['demand'] for c in customers}

    prob = LpProblem("Delivery", LpMinimize)
    y = LpVariable.dicts("A", [(w, c) for w in warehouses for c in customers], 0, 1, cat='Binary')
    o = LpVariable.dicts("Open", warehouses, 0, 1, cat='Binary')

    prob += lpSum(ec[(w, c)] * demand[c] * y[w, c] for w in warehouses for c in customers)

    for c in customers:
        prob += LpConstraint(lpSum(y[w, c] for w in warehouses),
                             LpConstraintEQ, f"served_{c}", 1)

    # Decision 8 - AT MOST P, matching the COG notebook's
    # `lpSum(use_plant) <= max_plants`. solve.py:405 uses EQ for p-median-us;
    # this divergence is deliberate and test_facility_count_is_at_most_p pins
    # the sense so a later reader does not "fix" it.
    prob += LpConstraint(lpSum(o[w] for w in warehouses),
                         LpConstraintLE, "FacilityCount", p)

    # Per-pair linking, as the COG notebook writes it. The aggregated form
    # (33 rows instead of 10,329) has a much weaker LP relaxation and CBC
    # branches far more; the measured 4.0s solve is with this form.
    for w in warehouses:
        for c in customers:
            prob += LpConstraint(y[w, c] - o[w], LpConstraintLE, f"route_{w}_{c}", 0)

    return prob, y, o


def solve_delivery(inp):
    if _LOAD_ERRORS.get("delivery-teaching-us"):
        return _load_error_envelope("delivery-teaching-us")

    p = inp['pValue']
    distance_bands = sorted(inp['distanceBands'])
    gap = inp.get('gap', 0.0)
    time_limit = inp.get('timeLimitSec', 120)

    warehouses = list(DELIV_WAREHOUSES.keys())
    customers = list(DELIV_CUSTOMERS.keys())
    demand = {c: DELIV_CUSTOMERS[c]['demand'] for c in customers}
    dist = DELIV_DISTANCES

    # Overrides land on COST and only on COST. `dist` is read-only for this
    # whole function - that single property is what makes every distance
    # metric below trustworthy.
    cost = dict(DELIV_COSTS)
    for ov in (inp.get('laneCostOverrides') or []):
        key = (ov['fromId'], ov['toId'])
        if ov['fromId'] not in DELIV_WAREHOUSES:
            raise UnresolvableIdError(f"unknown warehouse id {ov['fromId']}")
        if ov['toId'] not in DELIV_CUSTOMERS:
            raise UnresolvableIdError(f"unknown customer id {ov['toId']}")
        if key not in cost:
            raise UnresolvableIdError(f"no lane {ov['fromId']}->{ov['toId']}")
        cost[key] = ov['cost']

    ec = _effective_delivery_costs(cost, dist, inp)
    prob, y, o = _build_delivery_problem(ec, p)
    cbc = _run_cbc(prob, gap, time_limit, problem_uid="delivery")

    obj_val = value(prob.objective) or 0
    open_ids = [w for w in warehouses if o[w].varValue and o[w].varValue > 0.5]

    total_demand = sum(demand.values())
    dist_weighted = 0.0
    band_demand = {b: 0.0 for b in distance_bands}
    edges, assignments = [], []

    for c in customers:
        chosen = next((w for w in warehouses if y[w, c].varValue and y[w, c].varValue > 0.5), None)
        if chosen is None:
            continue
        d = dist[(chosen, c)]          # DISTANCE table. never ec, never cost.
        dist_weighted += d * demand[c]
        band_idx = _assign_band_or_overflow(d, distance_bands)
        assignments.append({"customerId": c, "warehouseId": chosen,
                            "distanceMi": d, "band": band_idx})
        edges.append({"fromId": chosen, "toId": c, "flow": round(demand[c]),
                      "distance": d, "band": band_idx})
        for b in distance_bands:
            if d <= b:
                band_demand[b] += demand[c]

    weighted_avg_distance = dist_weighted / total_demand if total_demand else 0.0
    band_coverage = [{"band": b, "percent": round(band_demand[b] * 100 / total_demand, 2)}
                     for b in distance_bands]

    status_str = "optimal" if cbc.solutionStatus == "optimal" else cbc.solutionStatus

    # Precision is contract, not display (spec 5.7): the goldens run to cents
    # and four decimals. No utilizationByNode - there is no capacity, so there
    # is no denominator and any value would be fabricated.
    return _envelope(
        cbc.solutionStatus, status_str, round(obj_val, 2), cbc.runTimeSec, edges,
        {"bandCoverage": band_coverage,
         "weightedAvgDistance": round(weighted_avg_distance, 4)},
        {"openWarehouseIds": open_ids,
         "assignments": assignments,
         "objective": "cost_adjusted" if inp.get('costAdjustEnabled') else "base"},
    )
```

If `_assign_band_or_overflow` does not already exist in `solve.py`, add it next to the existing band helper: it returns the index of the smallest band `>= d`, or `len(bands)` when `d` exceeds every band. Do **not** reuse a helper that silently clamps into the last band — that is how an over-1,600 lane would be miscounted as covered.

- [ ] **Step 5: Add the dispatcher branch**

In `solve()` (`:1473`), before the unknown-modelType error envelope:

```python
    if model_type == 'delivery':
        return solve_delivery(inp)
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/test_delivery.py -x -v
```

Expected: PASS, all 14 cases. The two golden solves take roughly 4s and 1s.

- [ ] **Step 7: Prove no existing solver moved**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x
cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py
```

Expected: the full pytest suite green, and `e2e_accuracy.py` reporting **99/99**. `e2e_accuracy.py` is sacred — if it fails, this change is wrong; do not edit it.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/solver/solve.py \
        artifacts/api-server/src/solver/tests/test_delivery.py
git commit -m "[ch5-del-3] add solve_delivery with the cost/distance separation and measured goldens"
```

---

## Task 4: Validator, payload builder, and route registration

**Files:**
- Create: `artifacts/api-server/src/validation/inputs/delivery.ts`
- Modify: `artifacts/api-server/src/validation/inputs/index.ts`
- Modify: `artifacts/api-server/src/registry/modelRegistry.ts` (`KNOWN_SCHEMAS` `:19`)
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (`VALID_MODEL_IDS` `:92`)
- Modify: `artifacts/api-server/src/solver/pmedian.ts` (`SolveInput` `:8`, `buildPayload`)
- Modify: `lib/api-spec/openapi.yaml` (4 `modelId` enums, `ModelInfoCapabilities`)
- Modify: `artifacts/api-server/src/registry/__tests__/registration.test.ts`
- Create: `artifacts/api-server/src/__tests__/deliveryContract.test.ts`

**Interfaces:**
- Produces: `deliveryInputsSchema`, `DeliveryInputs`; `buildPayload` emits `modelType: "delivery"`.
- Consumes: Task 3's wire contract, Task 2's manifest.

This is the **atomic OBS-5 commit**: `KNOWN_SCHEMAS` + `VALID_MODEL_IDS` + `buildPayload` + `SOLVABLE` land together, because `registration.test.ts` exists precisely to catch a model registered in one place and missing from the others.

- [ ] **Step 1: Write the failing contract test**

Create `artifacts/api-server/src/__tests__/deliveryContract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deliveryInputsSchema } from "../validation/inputs/delivery.js";
import { buildPayload } from "../solver/pmedian.js";

function baseInputs() {
  return {
    p: 3,
    distanceBands: [400, 800, 1200, 1600],
    gap: 0,
    timeLimitSec: 120,
    costAdjustEnabled: false,
    distanceThreshold: 800,
    costPerMile: 1,
    costPerMileOver: 10,
    laneCostOverrides: [],
  };
}

describe("deliveryInputsSchema", () => {
  it("accepts the default payload and defaults laneCostOverrides", () => {
    const parsed = deliveryInputsSchema.parse({ ...baseInputs(), laneCostOverrides: undefined });
    expect(parsed.laneCostOverrides).toEqual([]);
    expect(parsed.costAdjustEnabled).toBe(false);
  });

  it("accepts p at the 33 bound and rejects 34", () => {
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), p: 33 }).success).toBe(true);
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), p: 34 }).success).toBe(false);
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), p: 0 }).success).toBe(false);
  });

  // The source ships 33 zero-distance self-lanes, seeded into costs.json as
  // zero costs. A schema forbidding a zero OVERRIDE would forbid restoring a
  // value the dataset itself contains.
  it("accepts a zero lane-cost override but rejects a negative or non-finite one", () => {
    const zero = [{ fromId: "W1", toId: "C1", cost: 0 }];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: zero }).success).toBe(true);
    const neg = [{ fromId: "W1", toId: "C1", cost: -1 }];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: neg }).success).toBe(false);
    const inf = [{ fromId: "W1", toId: "C1", cost: Number.POSITIVE_INFINITY }];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: inf }).success).toBe(false);
  });

  it("rejects a zero or negative rate", () => {
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), costPerMile: 0 }).success).toBe(false);
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), costPerMileOver: -1 }).success).toBe(false);
  });

  it("rejects duplicate (fromId, toId) override pairs", () => {
    const dup = [
      { fromId: "W1", toId: "C1", cost: 5 },
      { fromId: "W1", toId: "C1", cost: 6 },
    ];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: dup }).success).toBe(false);
  });
});

describe("buildPayload — delivery-teaching-us", () => {
  it("emits modelType 'delivery' and passes every rate field through", () => {
    const payload = buildPayload({
      modelId: "delivery-teaching-us",
      inputs: deliveryInputsSchema.parse({ ...baseInputs(), costAdjustEnabled: true }),
    }) as Record<string, unknown>;

    expect(payload.modelType).toBe("delivery");
    expect(payload.pValue).toBe(3);
    expect(payload.costAdjustEnabled).toBe(true);
    expect(payload.distanceThreshold).toBe(800);
    expect(payload.costPerMile).toBe(1);
    expect(payload.costPerMileOver).toBe(10);
    expect(payload.distanceBands).toEqual([400, 800, 1200, 1600]);
  });

  // The dispatcher's old failure mode was a missing branch landing in
  // solve_pmedian and returning a plausible WRONG answer.
  it("never emits p_median for this model", () => {
    const payload = buildPayload({
      modelId: "delivery-teaching-us",
      inputs: deliveryInputsSchema.parse(baseInputs()),
    }) as Record<string, unknown>;
    expect(payload.modelType).not.toBe("p_median");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/deliveryContract.test.ts
```

Expected: FAIL — cannot resolve `../validation/inputs/delivery.js`.

- [ ] **Step 3: Write the validator**

Create `artifacts/api-server/src/validation/inputs/delivery.ts`:

```ts
import { z } from "zod";

// Chapter 5 (modified) - Delivery Company Teaching Example.
//
// The cost domain is NONNEGATIVE, not positive: the source data contains 33
// zero-distance self-lanes (a DC serving its own city), seeded into costs.json
// as zero costs, so forbidding a zero override would forbid restoring a value
// the dataset itself ships. The RATES stay strictly positive - a zero rate
// makes every lane free and the objective degenerate.
const laneCostOverrideSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  cost: z.number().finite().nonnegative(),
});

export const deliveryInputsSchema = z.object({
  // 33 candidate DCs. This bound is the API's only enforcement - both UI
  // mounts default pMax = 50 and must be passed pMax={33} explicitly, or a
  // student selects 40 from a control that offered it and gets a 422.
  p: z.number().int().min(1).max(33),
  distanceBands: z.array(z.number().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),

  // The three rate fields are ALWAYS present, with defaults, whether or not
  // the toggle is on: toggling on must never have to invent values, and a
  // scenario saved with the toggle off must retain the rates the student had
  // configured. costPerMileOver >= costPerMile is deliberately NOT enforced -
  // a student exploring a long-haul discount is doing legitimate what-if work.
  costAdjustEnabled: z.boolean().default(false),
  distanceThreshold: z.number().positive(),
  costPerMile: z.number().positive(),
  costPerMileOver: z.number().positive(),

  laneCostOverrides: z.array(laneCostOverrideSchema).default([])
    .refine(
      (rows) => new Set(rows.map((r) => `${r.fromId},${r.toId}`)).size === rows.length,
      { message: "laneCostOverrides must not contain duplicate (fromId, toId) pairs" },
    ),
});

export type DeliveryInputs = z.infer<typeof deliveryInputsSchema>;
```

Re-export it from `artifacts/api-server/src/validation/inputs/index.ts` alongside the others.

- [ ] **Step 4: Register in all four places at once**

`registry/modelRegistry.ts` `KNOWN_SCHEMAS` (`:19`):

```ts
  "delivery-teaching-us": deliveryInputsSchema,
```

`routes/scenarios.ts` `VALID_MODEL_IDS` (`:92`):

```ts
  "delivery-teaching-us",
```

`solver/pmedian.ts` `SolveInput` (`:8`):

```ts
  | { modelId: "delivery-teaching-us"; inputs: DeliveryInputs };
```

`solver/pmedian.ts` `buildPayload` — a branch **before** the p-median fallback, since that fallback is "whatever is left" and would otherwise swallow this model:

```ts
  if (input.modelId === "delivery-teaching-us") {
    const i = input.inputs;
    return {
      modelType: "delivery",
      pValue: i.p,
      distanceBands: i.distanceBands,
      gap: i.gap,
      timeLimitSec: i.timeLimitSec,
      costAdjustEnabled: i.costAdjustEnabled,
      distanceThreshold: i.distanceThreshold,
      costPerMile: i.costPerMile,
      costPerMileOver: i.costPerMileOver,
      laneCostOverrides: i.laneCostOverrides,
    };
  }
```

`registry/__tests__/registration.test.ts` — add `"delivery-teaching-us"` to `SOLVABLE`, supply its stub inputs, and update any exact model count from 6 to **7**.

- [ ] **Step 5: Update the OpenAPI contract and regenerate**

In `lib/api-spec/openapi.yaml`, add `delivery-teaching-us` to the `modelId` enum at **all four** sites — the `GET /dataset` query parameter, the `GET /scenarios` query parameter, the `Scenario` schema property, and the `ScenarioInput` schema property. Add `supportsReferenceCosts: { type: boolean }` to `ModelInfoCapabilities`.

```bash
pnpm --filter @workspace/api-spec run codegen
git status --porcelain lib/api-client-react lib/api-zod
```

Expected: only OpenAPI-derived files changed. Never hand-edit them; spec and regenerated output commit together.

- [ ] **Step 6: Run the contract and registration tests**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run \
    src/__tests__/deliveryContract.test.ts \
    src/registry/__tests__/registration.test.ts \
    src/__tests__/registry.test.ts
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/validation/inputs/delivery.ts \
        artifacts/api-server/src/validation/inputs/index.ts \
        artifacts/api-server/src/registry/modelRegistry.ts \
        artifacts/api-server/src/registry/__tests__/registration.test.ts \
        artifacts/api-server/src/routes/scenarios.ts \
        artifacts/api-server/src/solver/pmedian.ts \
        artifacts/api-server/src/__tests__/deliveryContract.test.ts \
        lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "[ch5-del-4] register delivery-teaching-us across schema, routes, payload, and contract"
```

---

## Task 5: Entity dataset loader and `GET /dataset`

**Files:**
- Create: `artifacts/api-server/src/data/deliveryDataset.ts`
- Modify: `artifacts/api-server/src/routes/dataset.ts`
- Test: `artifacts/api-server/src/__tests__/deliveryContract.test.ts` (append)

**Interfaces:**
- Produces: `DELIVERY_WAREHOUSES: WarehouseCandidate[]`, `DELIVERY_CUSTOMERS: Customer[]`.
- Consumes: Task 1's dataset files.

- [ ] **Step 1: Write the failing test**

Append to `deliveryContract.test.ts`:

```ts
import request from "supertest";
import app from "../app.js";

describe("GET /dataset — delivery-teaching-us", () => {
  it("returns 33 warehouses and 313 customers and no lane tables", async () => {
    const res = await request(app).get("/api/dataset?modelId=delivery-teaching-us").expect(200);
    expect(res.body.warehouses).toHaveLength(33);
    expect(res.body.customers).toHaveLength(313);
    // The 10,329-lane files must never reach the browser through this route.
    expect(res.body.distances).toBeUndefined();
    expect(res.body.costs).toBeUndefined();
  });

  it("carries role-prefixed ids and inline demand", async () => {
    const res = await request(app).get("/api/dataset?modelId=delivery-teaching-us").expect(200);
    expect(res.body.warehouses.every((w: { id: string }) => w.id.startsWith("W"))).toBe(true);
    expect(res.body.customers.every((c: { id: string }) => c.id.startsWith("C"))).toBe(true);
    expect(res.body.customers.reduce((s: number, c: { demand: number }) => s + c.demand, 0))
      .toBe(208829000);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/deliveryContract.test.ts
```

Expected: FAIL — `400 Unknown modelId: delivery-teaching-us`.

- [ ] **Step 3: Write the loader**

Create `artifacts/api-server/src/data/deliveryDataset.ts`, following `maxCoverageDataset.ts`'s bundling-safe pattern exactly — esbuild collapses `import.meta.url` for every merged module, so the repo root is found by walking up to `pnpm-workspace.yaml` rather than by a source-relative path:

```ts
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { WarehouseCandidate, Customer } from "./dataset.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(from: string): string {
  let dir = from;
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not locate repo root (pnpm-workspace.yaml) from " + from);
    dir = parent;
  }
  return dir;
}

// Chapter 5 (modified) - Delivery Company Teaching Example. Record maps keyed
// by real entity id (W8 / C269), the max-coverage-us convention, not
// p-median-us's ordinal keys - so Object.values (insertion order), not a
// byIndex sort. Distances are miles and are the effective distances as the
// source workbook gives them; no circuity factor is applied.
const DELIVERY_DATASET_DIR = path.join(findRepoRoot(__dirname), "solvers", "delivery-teaching-us", "dataset");

interface DeliveryWarehouseEntry { id: string; city: string; state: string; lat: number; lng: number; zip?: string; }
interface DeliveryCustomerEntry extends DeliveryWarehouseEntry { demand: number; }

function loadJson(filename: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(DELIVERY_DATASET_DIR, filename), "utf8"));
}

export const DELIVERY_WAREHOUSES: WarehouseCandidate[] =
  Object.values(loadJson("warehouses.json") as Record<string, DeliveryWarehouseEntry>);

export const DELIVERY_CUSTOMERS: Customer[] =
  Object.values(loadJson("customers.json") as Record<string, DeliveryCustomerEntry>);

// Lane-existence set. Lives here rather than beside the reference-cost builder
// so that precheck (Task 6) and the reference-cost endpoint (Task 7) both read
// one source and cannot drift, and so neither task depends on the other.
export const DELIVERY_LANE_KEYS: ReadonlySet<string> =
  new Set(Object.keys(loadJson("costs.json")));
```

- [ ] **Step 4: Add the route branch**

In `artifacts/api-server/src/routes/dataset.ts`, import the loader and add a branch beside the others, before the 400 fallthrough:

```ts
  if (modelId === "delivery-teaching-us") {
    // Chapter 5 (modified) - entities only. The two 10,329-lane tables are
    // served separately and lazily by GET /models/:id/reference-costs; this
    // route has never returned lane data for any model.
    res.json({ warehouses: DELIVERY_WAREHOUSES, customers: DELIVERY_CUSTOMERS });
    return;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/deliveryContract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/data/deliveryDataset.ts \
        artifacts/api-server/src/routes/dataset.ts \
        artifacts/api-server/src/__tests__/deliveryContract.test.ts
git commit -m "[ch5-del-5] load the delivery entities and serve them from GET /dataset"
```

---

## Task 6: Precheck — turn bad override ids into actionable 422s

**Files:**
- Modify: `artifacts/api-server/src/services/precheck.ts` (new `precheckDeliveryInputs`, dispatcher `:1368`)
- Test: `artifacts/api-server/src/__tests__/precheck.test.ts` (append)

**Interfaces:**
- Produces: `precheckDeliveryInputs(inputs: DeliveryInputs): PrecheckResult`.
- Consumes: Task 4's `DeliveryInputs`, Task 5's loaders.

**Why this is its own task.** `runNetworkEditsPrecheckForModel` (`:1368`) ends `return { ok: true, errors: [] }`. An unregistered model is **silently pre-approved** — every override reaches the worker and a bad id surfaces as a generic `internal_error` from `UnresolvableIdError` instead of something a student can act on. Nothing errors; the failure is entirely in the quality of the message.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/api-server/src/__tests__/precheck.test.ts`:

```ts
describe("precheckDeliveryInputs", () => {
  const base = {
    p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120,
    costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1, costPerMileOver: 10,
    laneCostOverrides: [],
  };

  it("passes a clean payload", () => {
    expect(runNetworkEditsPrecheckForModel("delivery-teaching-us", base).ok).toBe(true);
  });

  it("rejects an unknown warehouse id", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W999", toId: "C1", cost: 5 }] });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.errors)).toContain("W999");
  });

  it("rejects an unknown customer id", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W1", toId: "C999", cost: 5 }] });
    expect(r.ok).toBe(false);
  });

  // A role-swapped pair is individually valid on both sides and still not a lane.
  it("rejects a pair that exists in neither lane table", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "C1", toId: "W1", cost: 5 }] });
    expect(r.ok).toBe(false);
  });

  it("accepts a zero override, matching the dataset's 33 zero self-lanes", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "W1", toId: "C1", cost: 0 }] });
    expect(r.ok).toBe(true);
  });

  // The regression that matters: before this task the dispatcher's fallback
  // returned ok:true for this model, so every one of the cases above passed.
  it("no longer falls through to the unknown-model pre-approval", () => {
    const r = runNetworkEditsPrecheckForModel("delivery-teaching-us",
      { ...base, laneCostOverrides: [{ fromId: "nonsense", toId: "nonsense", cost: 1 }] });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/precheck.test.ts
```

Expected: every negative case FAILS by returning `ok: true` — the pre-approval.

- [ ] **Step 3: Write the precheck**

In `artifacts/api-server/src/services/precheck.ts`, following the existing per-model precheck shape:

```ts
// Chapter 5 (modified) - lane-cost override validation. The solver keeps its
// own UnresolvableIdError and fails closed; this exists so invalid USER input
// is a 422 the student can act on rather than a generic worker internal_error.
export function precheckDeliveryInputs(inputs: DeliveryInputs): PrecheckResult {
  const errors: PrecheckError[] = [];
  const warehouses = new Set(DELIVERY_WAREHOUSES.map((w) => w.id));
  const customers = new Set(DELIVERY_CUSTOMERS.map((c) => c.id));
  const lanes = DELIVERY_LANE_KEYS;     // from data/deliveryDataset.ts (Task 5)

  for (const ov of inputs.laneCostOverrides ?? []) {
    if (!warehouses.has(ov.fromId)) {
      errors.push({ code: "unknown_warehouse", message: `Unknown warehouse id ${ov.fromId}`, entityId: ov.fromId });
      continue;
    }
    if (!customers.has(ov.toId)) {
      errors.push({ code: "unknown_customer", message: `Unknown customer id ${ov.toId}`, entityId: ov.toId });
      continue;
    }
    if (!lanes.has(`${ov.fromId},${ov.toId}`)) {
      errors.push({ code: "unknown_lane", message: `No lane ${ov.fromId} to ${ov.toId}`, entityId: `${ov.fromId},${ov.toId}` });
    }
  }
  return { ok: errors.length === 0, errors };
}
```

Add the dispatcher branch at `:1368`, **before** the `return { ok: true, errors: [] }` fallback:

```ts
  if (modelId === "delivery-teaching-us") {
    return precheckDeliveryInputs(inputs as unknown as DeliveryInputs);
  }
```

Match `PrecheckError`'s real field names to the file's existing usage; the shape above is illustrative of the fields, not a licence to invent new ones.

- [ ] **Step 4: Run to verify they pass**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/precheck.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/services/precheck.ts \
        artifacts/api-server/src/__tests__/precheck.test.ts
git commit -m "[ch5-del-6] precheck delivery lane-cost overrides instead of pre-approving them"
```

---

## Task 7: The reference-costs endpoint

**Files:**
- Create: `artifacts/api-server/src/data/referenceCosts.ts`
- Create: `artifacts/api-server/src/routes/referenceCosts.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Create: `artifacts/api-server/src/__tests__/referenceCosts.test.ts`

**Interfaces:**
- Produces: `GET /api/models/:id/reference-costs` → `{ pairs: [{ fromId, fromCode, toId, toCode, cost }], distanceUnit }`; `getReferenceCosts(modelId)`.
- Consumes: Task 2's `supportsReferenceCosts` capability; Task 5's `DELIVERY_WAREHOUSES` / `DELIVERY_CUSTOMERS`.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/__tests__/referenceCosts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app.js";

describe("GET /models/:id/reference-costs", () => {
  it("serves all 10,329 lanes for delivery-teaching-us", async () => {
    const res = await request(app).get("/api/models/delivery-teaching-us/reference-costs").expect(200);
    expect(res.body.pairs).toHaveLength(10329);
    expect(res.body.distanceUnit).toBe("mi");
    const p = res.body.pairs[0];
    expect(p).toHaveProperty("fromId");
    expect(p).toHaveProperty("toId");
    expect(p).toHaveProperty("cost");
  });

  it("sets an ETag and answers 304 to a matching if-none-match", async () => {
    const first = await request(app).get("/api/models/delivery-teaching-us/reference-costs").expect(200);
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();
    await request(app).get("/api/models/delivery-teaching-us/reference-costs")
      .set("If-None-Match", etag).expect(304);
  });

  it("422s a model without the capability", async () => {
    await request(app).get("/api/models/p-median-us/reference-costs").expect(422);
    await request(app).get("/api/models/not-a-model/reference-costs").expect(422);
  });

  // The silent failure this test exists for: a route file that is created but
  // never registered in routes/index.ts 404s with no error anywhere.
  it("is reachable through the top-level mount, not merely defined", async () => {
    const res = await request(app).get("/api/models/delivery-teaching-us/reference-costs");
    expect(res.status).not.toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/referenceCosts.test.ts
```

Expected: FAIL — 404 on every case.

- [ ] **Step 3: Write the data layer, with domain validation**

Create `artifacts/api-server/src/data/referenceCosts.ts`, mirroring `data/referenceDistances.ts`'s registry shape:

```ts
import { readFileSync } from "fs";
import path from "path";
import { SOLVERS_ROOT, readVersion } from "@workspace/dataset-schema";
import { DELIVERY_WAREHOUSES, DELIVERY_CUSTOMERS } from "./deliveryDataset.js";

export interface ReferenceCostPair {
  fromId: string;
  fromCode: string;
  toId: string;
  toCode: string;
  cost: number;
}

export interface ReferenceCostsData {
  modelId: string;
  pairs: ReferenceCostPair[];
  /** Quoted per RFC 9110, derived from the package's version.json sha256. */
  etag: string;
}

/**
 * PACKAGE_SPECS cannot do this: DistanceMap is z.record(z.string(), z.number()),
 * which accepts zeros AND negatives. This builder is the only place a malformed
 * lane table is caught, so it fails loud at load rather than serving a 200 with
 * bad data.
 */
function buildDeliveryReferenceCosts(): ReferenceCostsData {
  const dir = path.join(SOLVERS_ROOT, "delivery-teaching-us", "dataset");
  const costs = JSON.parse(readFileSync(path.join(dir, "costs.json"), "utf8")) as Record<string, number>;
  const distances = JSON.parse(readFileSync(path.join(dir, "distances.json"), "utf8")) as Record<string, number>;

  const warehouses = new Set(DELIVERY_WAREHOUSES.map((w) => w.id));
  const customers = new Set(DELIVERY_CUSTOMERS.map((c) => c.id));
  const expected = warehouses.size * customers.size;

  if (Object.keys(costs).length !== expected) {
    throw new Error(`referenceCosts: expected ${expected} lanes, found ${Object.keys(costs).length}`);
  }
  const costKeys = Object.keys(costs).sort().join("|");
  const distKeys = Object.keys(distances).sort().join("|");
  if (costKeys !== distKeys) {
    throw new Error("referenceCosts: costs.json and distances.json key sets differ");
  }

  const pairs: ReferenceCostPair[] = [];
  for (const [key, cost] of Object.entries(costs)) {
    const [fromId, toId] = key.split(",");
    if (!fromId || !toId) throw new Error(`referenceCosts: malformed lane key "${key}"`);
    if (!warehouses.has(fromId)) throw new Error(`referenceCosts: unknown warehouse "${fromId}"`);
    if (!customers.has(toId)) throw new Error(`referenceCosts: unknown customer "${toId}"`);
    if (!Number.isFinite(cost) || cost < 0) {
      throw new Error(`referenceCosts: lane "${key}" has a non-finite or negative cost`);
    }
    pairs.push({ fromId, fromCode: fromId, toId, toCode: toId, cost });
  }

  const { sha256 } = readVersion("delivery-teaching-us");
  return { modelId: "delivery-teaching-us", pairs, etag: `"${sha256}"` };
}

const REFERENCE_COSTS_BY_MODEL: Record<string, ReferenceCostsData> = {
  "delivery-teaching-us": buildDeliveryReferenceCosts(),
};

/** Undefined for any model that has not registered a builder; the route 422s on that. */
export function getReferenceCosts(modelId: string): ReferenceCostsData | undefined {
  return REFERENCE_COSTS_BY_MODEL[modelId];
}
```

The lane-existence set that `services/precheck.ts` needs is `DELIVERY_LANE_KEYS`
from `data/deliveryDataset.ts` (Task 5), not a second copy derived here — one
source, no drift, and no dependency between this task and Task 6.

- [ ] **Step 4: Write the route**

Create `artifacts/api-server/src/routes/referenceCosts.ts`, a direct structural mirror of `routes/referenceDistances.ts` including the explicit ETag (the app disables Express's automatic weak ETags globally) and the 304 path:

```ts
import { Router } from "express";
import { getManifest } from "../registry/modelRegistry.js";
import { getReferenceCosts } from "../data/referenceCosts.js";

// Chapter 5 (modified) - GET /models/:id/reference-costs, the cost-side mirror
// of reference-distances. Unauthenticated + model-scoped, like /dataset and
// /models, so there is no owner and no 404-vs-403 concern here. Immutable base
// matrix: never merged with a scenario's own laneCostOverrides.
const router = Router();

router.get("/models/:id/reference-costs", (req, res) => {
  const modelId = req.params.id;
  const manifest = getManifest(modelId);
  if (!manifest || !manifest.capabilities.supportsReferenceCosts) {
    res.status(422).json({ error: `Model ${modelId} does not support reference costs` });
    return;
  }

  const data = getReferenceCosts(modelId);
  if (!data) {
    res.status(422).json({ error: `Model ${modelId} does not support reference costs` });
    return;
  }

  res.set("ETag", data.etag);
  res.set("Cache-Control", "public, max-age=0, must-revalidate");

  if (req.headers["if-none-match"] === data.etag) {
    res.status(304).end();
    return;
  }

  res.json({ pairs: data.pairs, distanceUnit: manifest.distanceUnit ?? "mi" });
});

export default router;
```

- [ ] **Step 5: Mount it**

In `artifacts/api-server/src/routes/index.ts` — this repo registers every router here, not in `app.ts`:

```ts
import referenceCostsRouter from "./referenceCosts.js";
...
router.use(referenceCostsRouter);
```

- [ ] **Step 6: Add the path to OpenAPI and regenerate**

Add `/models/{id}/reference-costs` beside the existing reference-distances path, with its 200/304/422 responses and the `ReferenceCostPair` schema.

```bash
pnpm --filter @workspace/api-spec run codegen
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/referenceCosts.test.ts
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/data/referenceCosts.ts \
        artifacts/api-server/src/routes/referenceCosts.ts \
        artifacts/api-server/src/routes/index.ts \
        artifacts/api-server/src/__tests__/referenceCosts.test.ts \
        lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "[ch5-del-7] serve and validate the base cost matrix behind a mounted endpoint"
```

---

## Task 8: Studio registration and the explicit input surface

**Files:**
- Modify: `artifacts/studio/src/lib/chapters.ts`
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (`defaultInputsForModel` `:125`, `inputEntriesForModel` `:1184`)
- Modify: `lib/units/src/objective.ts:20`
- Create: `artifacts/studio/src/__tests__/deliveryRegistration.test.tsx`

**Interfaces:**
- Produces: `StudioModelType` includes `"delivery-teaching-us"`; a `CHAPTERS` entry at `/chapter-5/delivery`; default inputs; the explicit three-entry tab list.
- Consumes: Task 4's contract.

**This task closes two of the five silent failures.** `inputEntriesForModel` has a permissive `default:` that would grant the full p-median editing surface, and `objectiveDimension`'s `default:` renders the objective as a unit-less number.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/studio/src/__tests__/deliveryRegistration.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { CHAPTERS, chapterForModelId } from "@/lib/chapters";
import { objectiveDimension } from "@workspace/units";
import { defaultInputsForModel, inputEntriesForModel } from "@/pages/Workspace";

describe("delivery-teaching-us — chapter registration", () => {
  it("is visible on Landing while the other two Chapter 5 labs stay hidden", () => {
    const entry = chapterForModelId("delivery-teaching-us");
    expect(entry).toBeDefined();
    expect(entry!.hiddenFromLanding).toBeFalsy();
    expect(entry!.locked).toBeFalsy();
    expect(entry!.path).toBe("/chapter-5/delivery");
    expect(chapterForModelId("transport-coal")!.hiddenFromLanding).toBe(true);
    expect(chapterForModelId("p-median-brazil")!.hiddenFromLanding).toBe(true);
  });

  it("takes Landing from three visible labs to four", () => {
    expect(CHAPTERS.filter(c => !c.hiddenFromLanding)).toHaveLength(4);
  });
});

describe("delivery-teaching-us — default inputs", () => {
  it("opens as the case study's Scenario 1, one click from Scenario 2", () => {
    expect(defaultInputsForModel("delivery-teaching-us")).toEqual({
      p: 3,
      distanceBands: [400, 800, 1200, 1600],
      gap: 0,
      timeLimitSec: 120,
      costAdjustEnabled: false,
      distanceThreshold: 800,
      costPerMile: 1,
      costPerMileOver: 10,
      laneCostOverrides: [],
    });
  });
});

describe("delivery-teaching-us — objective units", () => {
  it("is monetary when adjusted and demand-distance when not, never opaque", () => {
    expect(objectiveDimension("delivery-teaching-us", "cost_adjusted")).toBe("monetary");
    expect(objectiveDimension("delivery-teaching-us", "base")).toBe("demand-distance");
    expect(objectiveDimension("delivery-teaching-us", null)).not.toBe("opaque");
  });
});

describe("delivery-teaching-us — the input surface is fixed", () => {
  // The silent failure: inputEntriesForModel's tail is
  //   case "p-median-brazil": case "p-median-us": default:
  // so a model that is merely ABSENT inherits Customers, Warehouses and
  // Distances editors. Omission grants the editable surface; only an explicit
  // case withholds it.
  it("offers exactly Input Map, Delivery Costs and Optimization Parameters", () => {
    expect(inputEntriesForModel("delivery-teaching-us").map(e => e.id))
      .toEqual(["input-map", "deliveryCosts", "optimization-parameters"]);
  });

  it("offers no customers, warehouses or distances editor", () => {
    const ids = inputEntriesForModel("delivery-teaching-us").map(e => e.id);
    expect(ids).not.toContain("customers");
    expect(ids).not.toContain("warehouses");
    expect(ids).not.toContain("distances");
  });

  it("does not disturb the p-median default for the models that rely on it", () => {
    expect(inputEntriesForModel("p-median-us").map(e => e.id))
      .toEqual(["input-map", "customers", "warehouses", "distances", "optimization-parameters"]);
  });
});
```

If `inputEntriesForModel` is not currently exported from `Workspace.tsx`, export it — a named export is the smallest change that makes this testable, and the function is already pure.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter studio exec vitest run src/__tests__/deliveryRegistration.test.tsx
```

Expected: FAIL — `StudioModelType` rejects the id at the type level and the tab assertions return the p-median list.

- [ ] **Step 3: Register the chapter**

In `artifacts/studio/src/lib/chapters.ts`, extend the union on line 1 with `| "delivery-teaching-us"` and add to `CHAPTERS`:

```ts
  {
    path: "/chapter-5/delivery",
    modelId: "delivery-teaching-us",
    chapter: "Chapter 5",
    title: "Delivery Company Teaching Example",
    description: "Facility location driven by a cost table: open three DCs to minimise delivery cost, then watch the network change when long lanes are repriced.",
    workspace: true,
    labHeaderTitle: "Delivery Company · Model Lab",
    labHeaderSubtitle: "Ch 5 · p-median · cost table vs distance table",
  },
```

No `hiddenFromLanding`, no `locked`. The two existing Chapter 5 entries are not touched.

- [ ] **Step 4: Add default inputs and the explicit tab case**

`defaultInputsForModel` (`:125`) — the bands are the `Outputs Needed` sheet's four, the rates are the `Trans Costs` sheet's Scenario 2:

```ts
    case "delivery-teaching-us":
      return {
        p: 3,
        distanceBands: [400, 800, 1200, 1600],
        gap: 0,
        timeLimitSec: 120,
        costAdjustEnabled: false,
        distanceThreshold: 800,
        costPerMile: 1,
        costPerMileOver: 10,
        laneCostOverrides: [],
      };
```

`inputEntriesForModel` (`:1184`) — an **explicit** case, placed before the `p-median-brazil`/`p-median-us`/`default` tail:

```ts
    // Chapter 5 (modified) - the cost table is the ONLY editable dataset
    // surface (spec decision 11). This case is load-bearing, not tidiness:
    // the switch's tail is `case "p-median-brazil": case "p-median-us":
    // default:`, so a model that is merely absent INHERITS the Customers,
    // Warehouses and Distances editors. Omission grants the editable surface.
    case "delivery-teaching-us":
      return [
        { id: "input-map", label: "Input Map" },
        { id: "deliveryCosts", label: "Delivery Costs" },
        { id: "optimization-parameters", label: "Optimization Parameters" },
      ];
```

- [ ] **Step 5: Add the objective-units case**

In `lib/units/src/objective.ts` (`:20`), before `default:`:

```ts
    case "delivery-teaching-us":
      // A cost value is billable miles. With the adjustment OFF the objective
      // is billable-miles x demand; with it ON the rate turns it into dollars.
      // Missing this case renders the objective through `default: "opaque"` as
      // a bare unit-less number - no error, no failing test.
      return objectiveMode === "cost_adjusted" ? "monetary" : "demand-distance";
```

- [ ] **Step 6: Run to verify they pass**

```bash
pnpm --filter studio exec vitest run src/__tests__/deliveryRegistration.test.tsx
pnpm run typecheck
```

Expected: PASS. Typecheck will surface every remaining exhaustive `switch (modelId)` that now lacks a case — fix each by adding the delivery branch, not by widening a type.

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/lib/chapters.ts \
        artifacts/studio/src/pages/Workspace.tsx \
        lib/units/src/objective.ts \
        artifacts/studio/src/__tests__/deliveryRegistration.test.tsx
git commit -m "[ch5-del-8] register the delivery chapter and declare its fixed input surface"
```

---

## Task 9: Read-only Input Map

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (map render gate ~`:2999`)
- Test: `artifacts/studio/src/__tests__/deliveryRegistration.test.tsx` (append)

**Interfaces:**
- Produces: `InputMapTab` accepts `readOnly?: boolean`; when true it renders markers and legend and **no** mutation affordance.
- Consumes: Task 8's tab registration.

The smallest safe change is a read-only variant of the existing p-median map, not a new map component. Today the map renders `mode="pmedian"` with `onInputsChange={handlePMedianMapInputsChange}` — fully editable.

- [ ] **Step 1: Write the failing tests**

Append to `deliveryRegistration.test.tsx`:

```tsx
describe("delivery-teaching-us — the map is read-only", () => {
  function renderDeliveryMap() {
    return render(<InputMapTab mode="pmedian" readOnly warehouses={[]} customers={[]}
                               inputs={{}} countryBounds={{ sw: [24, -125], ne: [50, -66] }} />);
  }

  // Asserting the tab list alone would pass against a map a student can still
  // drag a warehouse on, which is why every affordance is named individually.
  it.each([
    "button-add-warehouse", "button-add-customer", "button-copy-entity",
    "button-delete-entity", "button-move-entity", "select-entity-status",
    "input-entity-lat", "input-entity-lng", "input-entity-demand",
    "button-save-map-inputs",
  ])("does not render %s", (testid) => {
    renderDeliveryMap();
    expect(screen.queryByTestId(testid)).toBeNull();
  });

  it("still renders the map and its legend", () => {
    renderDeliveryMap();
    expect(screen.getByTestId("input-map")).toBeInTheDocument();
  });
});
```

Replace the `data-testid` values above with the real ones in `InputMapTab.tsx` — read them from the file; do not guess. The list must cover add, copy, move, delete, status, coordinate, demand, and Save.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter studio exec vitest run src/__tests__/deliveryRegistration.test.tsx
```

Expected: FAIL — the affordances render.

- [ ] **Step 3: Add the `readOnly` prop**

In `InputMapTab.tsx`, add `readOnly?: boolean` to the props interface with a comment recording why it exists, and gate every mutation affordance on `!readOnly`. Do not gate on `modelId` — this repo's recurring bug class is a shared component gated for one model and not its sibling, and a capability-style boolean prop cannot drift that way.

- [ ] **Step 4: Pass it from Workspace**

At the p-median map render (~`:2999`), pass `readOnly={modelId === "delivery-teaching-us"}` and omit `onInputsChange` for that model, so the component cannot write even if a future edit reintroduces an affordance.

- [ ] **Step 5: Run to verify they pass, and that no other model changed**

```bash
pnpm --filter studio exec vitest run src/__tests__/deliveryRegistration.test.tsx \
  src/__tests__/InputMapTabV2.test.tsx src/__tests__/InputMapTab.maxCoverage.test.tsx \
  src/__tests__/InputMapTabV2.transport.test.tsx
```

Expected: PASS, including every pre-existing Input Map suite.

- [ ] **Step 6: Commit**

```bash
git add artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx \
        artifacts/studio/src/pages/Workspace.tsx \
        artifacts/studio/src/__tests__/deliveryRegistration.test.tsx
git commit -m "[ch5-del-9] add a read-only Input Map variant and use it for delivery"
```

---

## Task 10: The Adjust Cost Table control and the `P` bound

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx` (union `:10-30`, props `:32-133`, new block after `:438`)
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (props into both mounts)
- Test: `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx` (append)

**Interfaces:**
- Produces: four new `OptimizationParametersField` members — `"costAdjustEnabled"`, `"distanceThreshold"`, `"costPerMile"`, `"costPerMileOver"` — and four optional props.
- Consumes: Task 8's default inputs.

**Coordinate with the Chapter 4 two-step work.** That plan removes Chapter 4's objective toggle from this file and adds an exclusive step wrapper. The agreed order is **Chapter 4 first, this second** — a deletion across two files, then an addition in one. The JSX hunks are 30 lines apart and merge clean; the real conflict is the union on one line and the props interface across a hundred. If Chapter 4 has not landed, stop and re-check the line numbers before editing.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`:

```tsx
describe("Adjust Cost Table (delivery-teaching-us)", () => {
  const deliveryProps = {
    costAdjustEnabled: false,
    distanceThreshold: 800,
    costPerMile: 1,
    costPerMileOver: 10,
    gap: 0,
    timeLimitSec: 120,
    p: 3,
    pMax: 33,
    distanceBands: [400, 800, 1200, 1600],
    onChange: vi.fn(),
  };

  it("renders the button and hides the three fields when the toggle is off", () => {
    render(<OptimizationParametersTab {...deliveryProps} />);
    expect(screen.getByTestId("button-adjust-cost-table")).toBeInTheDocument();
    expect(screen.queryByTestId("input-distance-threshold")).toBeNull();
    expect(screen.queryByTestId("input-cost-per-mile")).toBeNull();
    expect(screen.queryByTestId("input-cost-per-mile-over")).toBeNull();
  });

  it("reveals the three fields when the toggle is on", () => {
    render(<OptimizationParametersTab {...deliveryProps} costAdjustEnabled />);
    expect(screen.getByTestId("input-distance-threshold")).toHaveValue(800);
    expect(screen.getByTestId("input-cost-per-mile")).toHaveValue(1);
    expect(screen.getByTestId("input-cost-per-mile-over")).toHaveValue(10);
  });

  it("emits costAdjustEnabled through the generic onChange", async () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...deliveryProps} onChange={onChange} />);
    await userEvent.click(screen.getByTestId("button-adjust-cost-table"));
    expect(onChange).toHaveBeenCalledWith("costAdjustEnabled", true);
  });

  // Values persist across the toggle: the schema always carries all three, so
  // turning the feature off and on again must not reset a student's rates.
  it("does not clear the rate values when toggled off", async () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...deliveryProps} costAdjustEnabled onChange={onChange} />);
    await userEvent.click(screen.getByTestId("button-adjust-cost-table"));
    expect(onChange).toHaveBeenCalledWith("costAdjustEnabled", false);
    expect(onChange).not.toHaveBeenCalledWith("costPerMile", expect.anything());
    expect(onChange).not.toHaveBeenCalledWith("distanceThreshold", expect.anything());
  });

  it("renders nothing of the sort for a model that passes none of these props", () => {
    render(<OptimizationParametersTab gap={0} timeLimitSec={120} distanceBands={[500]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("button-adjust-cost-table")).toBeNull();
  });

  // pMax defaults to 50 in BOTH mounts against a schema cap of 33.
  it("caps the P slider at 33 when pMax is passed", () => {
    render(<OptimizationParametersTab {...deliveryProps} />);
    expect(screen.getByTestId("input-p")).toHaveAttribute("max", "33");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter studio exec vitest run src/__tests__/OptimizationParametersTab.test.tsx
```

Expected: FAIL — no such testids.

- [ ] **Step 3: Extend the field union and the props**

`OptimizationParametersField` (`:10-30`) gains four members. The existing `onChange` signature is already `(field, value: number | number[] | boolean)` (`:132`), so the boolean needs no widening:

```ts
  // Chapter 5 (modified) - the Adjust Cost Table feature's four fields.
  | "costAdjustEnabled"
  | "distanceThreshold"
  | "costPerMile"
  | "costPerMileOver"
```

`OptimizationParametersTabProps` (`:32-133`) gains:

```ts
  /** Chapter 5 (modified) - present only for delivery-teaching-us. Gated on
   * presence like every other model-specific parameter in this component,
   * never on modelId. */
  costAdjustEnabled?: boolean;
  distanceThreshold?: number;
  costPerMile?: number;
  costPerMileOver?: number;
```

- [ ] **Step 4: Add the JSX block**

Insert **immediately after** the `{bomRatio != null && ( … )}` block at `:438` — with the `capacityFactor` / `singleSource` / `capacityInactive` family, after the ungated gap and time-limit inputs, and **outside** the `{objective != null && (...)}` block at `:235-359`.

That placement is load-bearing. Chapter 4's Task 7 wraps its own block in `{(step ?? 1) === 1 && ...}` so Steps 1 and 2 render exclusively; anything gated only on prop presence *inside* that wrapper silently stops rendering on Step 2. This model has no step concept and its control must render whenever its props are present.

```tsx
{costAdjustEnabled != null && (
  <div className="space-y-2" data-testid="cost-adjust-section">
    <Button
      variant={costAdjustEnabled ? "secondary" : "outline"}
      className="h-8 w-full text-sm"
      data-testid="button-adjust-cost-table"
      onClick={() => onChange("costAdjustEnabled", !costAdjustEnabled)}
    >
      Adjust Cost Table
    </Button>
    {costAdjustEnabled && (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Each lane is repriced from its distance: at or under the threshold it
          bills at the first rate, beyond it at the second. Distances are never
          changed.
        </p>
        <div>
          <Label htmlFor="input-distance-threshold" className="text-xs text-muted-foreground">
            Distance threshold (mi)
          </Label>
          <Input id="input-distance-threshold" type="number" value={distanceThreshold}
                 data-testid="input-distance-threshold"
                 className="h-8 text-sm mt-1 font-mono"
                 onChange={e => onChange("distanceThreshold", parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <Label htmlFor="input-cost-per-mile" className="text-xs text-muted-foreground">
            Cost per mile
          </Label>
          <Input id="input-cost-per-mile" type="number" value={costPerMile}
                 data-testid="input-cost-per-mile"
                 className="h-8 text-sm mt-1 font-mono"
                 onChange={e => onChange("costPerMile", parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <Label htmlFor="input-cost-per-mile-over" className="text-xs text-muted-foreground">
            Cost per mile over the threshold
          </Label>
          <Input id="input-cost-per-mile-over" type="number" value={costPerMileOver}
                 data-testid="input-cost-per-mile-over"
                 className="h-8 text-sm mt-1 font-mono"
                 onChange={e => onChange("costPerMileOver", parseFloat(e.target.value) || 0)} />
        </div>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: Wire both mounts from Workspace**

Pass the four values plus `pMax={33}` into `OptimizationParametersTab`, reading them off `localInputs` with the same presence-typed reader pattern the file already uses for `capacityFactor`. Pass `pMax={33}` into `SolveDialog` as well — it defaults to 50 independently (`SolveDialog.tsx:156`), and a bound enforced at one mount is not a bound.

- [ ] **Step 6: Run to verify they pass**

```bash
pnpm --filter studio exec vitest run src/__tests__/OptimizationParametersTab.test.tsx \
  src/__tests__/SolveDialog.test.tsx
```

Expected: PASS, including the pre-existing suites.

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx \
        artifacts/studio/src/pages/Workspace.tsx \
        artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx
git commit -m "[ch5-del-10] add the Adjust Cost Table control and cap P at 33 in both mounts"
```

---

## Task 11: The Delivery Costs tab

**Files:**
- Create: `artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx`
- Create: `artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (tab content gate)

**Interfaces:**
- Consumes: Task 7's `GET /models/:id/reference-costs` via the generated hook; Task 8's `deliveryCosts` entry id.
- Produces: edits to `localInputs.laneCostOverrides`.

Modelled directly on `DistancesTab.tsx`: base rows from the reference endpoint merged read-only with the student's sparse overrides, `PAGE_SIZE = 50` pagination, two free-text substring filters, typed-id add row.

**With 10,329 base rows the filters are not a nicety.** They are the only practical way to reach a lane; paging to row 4,000 is not an interaction. Treat "filter to a city, edit its cost" as the primary flow.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx` covering:

```tsx
describe("DeliveryCostsTab", () => {
  it("renders base rows from the reference-costs query", async () => { /* mock the hook with 3 pairs, assert all 3 render */ });
  it("shows an override in place of its base value and marks it overridden", async () => { /* ... */ });
  it("paginates at 50 rows", async () => { /* mock 120 pairs, assert 50 rendered and a page control present */ });
  it("filters by from-id substring", async () => { /* ... */ });
  it("filters by to-id substring", async () => { /* ... */ });
  it("adds an override for a typed pair", async () => { /* assert onChange receives {fromId,toId,cost} */ });
  it("rejects a duplicate (fromId,toId) at add time", async () => { /* ... */ });
  it("accepts a zero cost", async () => { /* the dataset ships 33 zero self-lanes */ });
  it("rejects a negative cost", async () => { /* ... */ });
  it("removes an override and falls back to the base value", async () => { /* ... */ });
});
```

Fill each body with real assertions against the component's own testids — copy the interaction patterns from `DistancesTab.test.tsx`, which exercises the identical shape.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter studio exec vitest run src/__tests__/DeliveryCostsTab.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `DeliveryCostsTab.tsx` following `DistancesTab.tsx`'s structure: `baseByKey` from the reference query, `overrideByKey` from `laneCostOverrides`, `mergedRows` combining them, `PAGE_SIZE = 50`, `fromFilter`/`toFilter`, and an add-row with typed ids validated for non-empty, in-range cost, and pair-not-already-overridden. The value column is **cost**, labelled as cost, and carries no unit conversion — a cost is billable miles, not a distance, and must not be routed through `useDistanceDraft`.

- [ ] **Step 4: Render it from Workspace**

Add a tab-content branch for `entity === "deliveryCosts"`, beside the existing `laneCosts` and `distances` branches.

- [ ] **Step 5: Run to verify they pass**

```bash
pnpm --filter studio exec vitest run src/__tests__/DeliveryCostsTab.test.tsx
pnpm --filter studio test
```

Expected: PASS, and the full Studio suite still green.

- [ ] **Step 6: Commit**

```bash
git add artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx \
        artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx \
        artifacts/studio/src/pages/Workspace.tsx
git commit -m "[ch5-del-11] add the Delivery Costs override editor over the base cost matrix"
```

---

## Task 12: Outputs — band precision, Demand Served, and exports

**Files:**
- Modify: `lib/units/src/bands.ts`
- Modify: `artifacts/api-server/src/services/templates.ts` (`buildEffectiveFacilityCityLookup`)
- Test: `lib/units/src/bands.test.ts`, `artifacts/api-server/src/__tests__/templates.test.ts`

**Interfaces:**
- Produces: `computeCumulativeBandCoverage(edges, bands, opts?: { decimals?: number })` — **default unchanged**; `buildEffectiveFacilityCityLookup` resolves delivery warehouse cities.
- Consumes: Task 3's envelope, Task 5's loaders.

- [ ] **Step 1: Write the failing tests**

In `lib/units/src/bands.test.ts`:

```ts
describe("computeCumulativeBandCoverage — opt-in precision", () => {
  const edges = [
    { distance: 100, flow: 1 },
    { distance: 900, flow: 2 },
  ];

  // Five models have tests pinned to integer percentages. Changing the default
  // is out of scope; this is additive.
  it("still returns integers by default", () => {
    const rows = computeCumulativeBandCoverage(edges, [400, 1600]);
    expect(rows[0]!.percent).toBe(33);
  });

  it("returns two decimals when asked", () => {
    const rows = computeCumulativeBandCoverage(edges, [400, 1600], { decimals: 2 });
    expect(rows[0]!.percent).toBeCloseTo(33.33, 2);
  });

  it("keeps the Overflow row under both precisions", () => {
    const rows = computeCumulativeBandCoverage(edges, [400], { decimals: 2 });
    expect(rows.some(r => r.band === OVERFLOW_BAND)).toBe(true);
  });
});
```

In `artifacts/api-server/src/__tests__/templates.test.ts`:

```ts
it("resolves delivery-teaching-us warehouse cities", () => {
  const lookup = buildEffectiveFacilityCityLookup("delivery-teaching-us", {});
  // Missing this branch ships blank city values in the Open Warehouses export
  // and nothing errors.
  expect(lookup["W1"]).toBeTruthy();
  expect(lookup["W60"]).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @workspace/units exec vitest run src/bands.test.ts
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/templates.test.ts
```

Expected: FAIL — no `decimals` option; `lookup["W1"]` undefined.

- [ ] **Step 3: Add opt-in precision**

In `lib/units/src/bands.ts:37`, add an optional third parameter and route both `Math.round` calls through it, defaulting to 0 decimals so existing output is byte-identical.

- [ ] **Step 4: Add the city-lookup branch**

In `services/templates.ts`, add a `delivery-teaching-us` branch to `buildEffectiveFacilityCityLookup` returning the id→city map from `DELIVERY_WAREHOUSES`.

- [ ] **Step 5: Pass 2 decimals for this model in Service Stats**

In `ServiceStatsTab.tsx`, pass `{ decimals: 2 }` when the active model is `delivery-teaching-us`. Gate on the model's own presence of a 2 dp `bandCoverage` metric rather than a hardcoded id if a capability-shaped seam is already available; otherwise a single explicit comparison is acceptable here and must carry a comment saying why.

- [ ] **Step 6: Run to verify they pass, plus every band consumer**

```bash
pnpm --filter @workspace/units test
pnpm --filter studio exec vitest run src/__tests__/bands.test.ts src/__tests__/ServiceStatsTab.test.tsx
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/templates.test.ts
```

Expected: PASS, with every pre-existing integer-percentage assertion untouched.

- [ ] **Step 7: Verify the four output grids export**

Create a delivery scenario, solve it, and export each of Open Warehouses, Assignments, Cost Summary and Service Stats as CSV and JSON. Confirm: cities are populated, the objective carries the right mode and units, weighted average distance keeps 4 dp, band percentages keep 2 dp, and an Overflow row appears when present.

The spec's §9 point-9 `N/A` is **input-side only** — output exports are in scope.

- [ ] **Step 8: Commit**

```bash
git add lib/units/src/bands.ts lib/units/src/bands.test.ts \
        artifacts/api-server/src/services/templates.ts \
        artifacts/api-server/src/__tests__/templates.test.ts \
        artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx
git commit -m "[ch5-del-12] add opt-in band precision, delivery city lookup, and verified exports"
```

---

## Task 13: End-to-end, journey, and closeout

**Files:**
- Create: `artifacts/studio/e2e/delivery-teaching.spec.ts`
- Modify: `artifacts/api-server/src/solver/tests/e2e_journey.py`
- Modify: `artifacts/studio/e2e/bundle4-auth-landing.spec.ts`, `bundle6-ui-tweaks.spec.ts`
- Modify: `README.md`, `CLAUDE.md`, `model-integration-precheck.md`, `docs/CHANGELOG-implementation.md`

- [ ] **Step 1: Write the Playwright journey**

Create `artifacts/studio/e2e/delivery-teaching.spec.ts`, modelled on `max-coverage.spec.ts`:

1. Landing shows the Chapter 5 Delivery card; `transport-coal` and `p-median-brazil` remain absent.
2. Create a scenario → the tab rail shows exactly Input Map, Delivery Costs, Optimization Parameters.
3. The Input Map renders and exposes no add/move/delete/status/demand/Save affordance.
4. Solve → Scenario 1's open set `{W1, W2, W60}` and weighted average distance 422.5511.
5. Click **Adjust Cost Table**, confirm the three fields appear at 800 / 1 / 10, re-solve → open set flips to `{W6, W43, W45}` and 800-mile coverage rises to 97.19%.
6. Override one lane's cost and re-solve. **Pin a lane whose override cannot change the assignment**, or assert the mathematically correct result of a controlled change — a bare "objective moved" assertion is ambiguous because a large override legitimately reroutes demand.
7. Export Open Warehouses as CSV and assert the city column is populated.

**Use seeded solver results for everything except one real-CBC solve.** pytest owns the numeric proof; three live CBC solves in Playwright buys nothing and costs ~6 seconds each.

- [ ] **Step 2: Add the journey case**

Add a `delivery` section to `e2e_journey.py` following its existing style: create → solve → assert status optimal, 313 customers served, open ids ⊆ the 33 warehouse ids, weighted average distance in a sane range; then a second run with the toggle on asserting the open set changes.

`e2e_accuracy.py` is **not** touched. It is run at the gate and never edited.

- [ ] **Step 3: Fix the already-stale lab-count specs**

`bundle4-auth-landing.spec.ts` and `bundle6-ui-tweaks.spec.ts` assert `"2 labs"` when the true figure has been 3 since Chapter 4 was unlocked (`docs/CHANGELOG-implementation.md:411`). Set them to the correct post-change value of **4**, and update the chapter-strip assertions. Do not increment their current wrong values.

- [ ] **Step 4: Run the full gate**

```bash
git diff --check
pnpm run typecheck
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
pnpm --filter studio test
(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
(cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:3000 delivery)
pnpm e2e:gate
```

Expected: all green; `e2e_accuracy.py` at **99/99**, unmodified. `resultEnvelope.test.ts` and `jobRunnerDispatcher` are known load-induced flakes — if they fail, re-run those files in isolation before treating it as a regression.

- [ ] **Step 5: Re-run Task 0's dependency audit**

A consumer added *during* implementation is exactly what a single up-front audit misses. Re-run Task 0 Steps 3 and 4 and diff the findings against the recorded baseline.

- [ ] **Step 6: Documentation closeout**

- `README.md:155,171` — "six models" → seven.
- `CLAUDE.md:139` — correct the stale claim that `e2e_journey.py` is "fully non-runnable"; it now authenticates via `/auth/register` + `/auth/login` (`e2e_journey.py:201,235,239`).
- `model-integration-precheck.md` — fold in checklist points 11–18 from the spec's §9, so the next model does not rediscover them. Note explicitly that five of them fail silently.
- `docs/CHANGELOG-implementation.md` — the implementation entry, and amend `:448`'s "Chapter 5 — nothing to commit", which Task 1 supersedes.
- `attached_assets/NOTEBOOKS.md` — already updated in Task 1; confirm the hashes match the committed files.

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/e2e/ artifacts/api-server/src/solver/tests/e2e_journey.py \
        README.md CLAUDE.md model-integration-precheck.md docs/CHANGELOG-implementation.md
git commit -m "[ch5-del-13] add the delivery e2e journey and complete the documentation closeout"
```

- [ ] **Step 8: Run `/harness-retro`**

A branch is not finished until this has run.

---

## Self-Review

**1. Spec coverage.** Decision 1 → Tasks 2/4. Decision 2 → Tasks 1/3. Decision 3 → Task 1. Decision 4 → Task 8. Decisions 5/6/7 → Task 3 (`_effective_delivery_costs`). Decision 8 → Task 3 (`LpConstraintLE` + its test). Decision 9 → Task 3 (`served_{c}` equality + `test_single_source`). Decision 10 → Tasks 3/12 (Summary vs Service Stats split). Decision 11 → Tasks 8/9/11. Decision 12 → Task 2 (`capacityModes: []`) + Task 3 (no `utilizationByNode`). Decision 13 → Tasks 2/8. Decision 14 → Task 8. Spec §9's 18 registration points map as: 1–2 Task 2; 3 Task 4; 4 Task 4; 5 Task 2; 6 Task 4; 7 Tasks 4/7; 8 Task 3; 9 N/A input-side, outputs in Task 12; 10 N/A; 11 Task 8; 12 Task 2; 13 Task 8; 14 Task 6; 15 Task 7; 16 Task 12; 17 Task 10; 18 Task 4.

**2. Placeholder scan.** One deliberate exception: Task 11 Step 1 lists ten test names with `/* ... */` bodies rather than full code. That is because each body is a mechanical copy of the corresponding case in `DistancesTab.test.tsx`, which exercises an identical component shape — reproducing 200 lines of near-duplicate RTL here would be less accurate than pointing at the file the implementer must match. Two places name an existing repo convention instead of repeating it: Task 9 Step 1's testid list (must be read from `InputMapTab.tsx`, not guessed) and Task 6 Step 3's `PrecheckError` field names (must match the file's existing usage).

**3. Type consistency.** `solve_delivery` / `_effective_delivery_costs` / `_build_delivery_problem` / `DELIV_DISTANCES` / `DELIV_COSTS` are declared once in Task 3 and consumed under the same names in its tests. `deliveryInputsSchema` / `DeliveryInputs` are declared in Task 4 and consumed in Tasks 6 and 10. `DELIVERY_WAREHOUSES` / `DELIVERY_CUSTOMERS` / `DELIVERY_LANE_KEYS` are declared in Task 5 and consumed in Tasks 6, 7 and 12. `getReferenceCosts` is declared and consumed within Task 7. The tab entity id is `deliveryCosts` in Tasks 8 and 11 consistently.

**One defect this review caught and fixed rather than noted.** The first draft put a `deliveryLaneKeySet()` helper in Task 7's `referenceCosts.ts` and consumed it from Task 6's precheck — a task depending on a later one. Moving the set to `DELIVERY_LANE_KEYS` in Task 5's `deliveryDataset.ts` removes the inversion, keeps Tasks 6 and 7 independent of each other, and leaves precheck and the endpoint reading one source instead of two copies that could drift.

**Open risk to watch at review:** Task 10 edits a file the Chapter 4 two-step plan also edits. The agreed order is Chapter 4 first. If both land in either order the JSX merges clean (30 lines apart), but the `OptimizationParametersField` union and the props interface conflict and must be reconciled by hand — not relocated.

---

## Review record (2026-09-28, Rev 1)

**Method.** Every claim the plan makes about the repository was traced against the tree at `3065c91` (main, clean) by six independent read-only passes: solver (`solve.py` + tests), api-server TS, `lib/*` + OpenAPI, Studio + e2e, git/sources/Chapter-4 status, and a spec-vs-plan coverage cross-check. Findings are grouped by severity; each carries a disposition. "Fold" means: rewrite the named task step in place for Rev 2. Nothing below has been folded yet.

**Base facts re-established (do not re-derive):** `1761260` (Ch4 migration merge) is an ancestor of HEAD. All three `~/Downloads` source hashes match the plan exactly. Postgres `nos_dev` accepts connections. `pulp` 3.3.2 imports; `pandas` does not. The `~/Downloads` xlsx has six sheets (`Customers`, `Demand`, `Plants`, `Trans Costs`, `Distance Matrix`, `Outputs Needed`); customer ids are exactly `1..313`; all 33 plant ids also appear as customer ids and the matrix stores `0` for each of those 33 self-lanes; plant ids are `1,2,3,4,6,7,8,9,11,12,14,15,16,17,19,22,25,27,28,35,38,39,43,44,45,52,55,57,60,66,99,116,152`.

### R1. Blocking — the implementer builds wrong code or a red test

| # | Task | Finding | Evidence | Disposition |
|---|---|---|---|---|
| B1 | 10, 0 | **The Chapter 4 two-step plan is ~60 % implemented, not plan-only.** Tasks 1–6 are committed on `ch4-2s-7-work` (`14c5e8f`…`63e16d5`, not merged to main); Task 7 is in progress, uncommitted, in the locked worktree `.worktrees/ch4-two-step`, where `OptimizationParametersTab.tsx` already carries `step?: 1 \| 2`, `stepEditable`, `step2Gap`, `step2TimeLimitSec` plus new `StepToggle.tsx` / `FreezeConfirmDialog.tsx`. Every line number in Task 10 (`:10-30`, `:32-133`, `:235-359`, `:438`) is main-only. Also on main, `:438` is where the `bomRatio` block **opens** (it ends ~`:455`); "insert immediately after `:438`" lands inside it. | `git log --all -- artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx`; `git worktree list`; `OptimizationParametersTab.tsx:438` | Fold: Task 0 Step 2 gains a second ancestry guard on the Ch4 merge SHA; Task 10 is blocked until then and every line number is re-captured against that tree. Insert point becomes "after the `bomRatio` block closes". |
| B2 | 3 | **`test_cost_override_does_not_move_distance_metrics` picks a zero lane.** `assignments[0]` is customer `C1` (Los Angeles), co-located with `W1`, distance 0, base cost 0. Overriding to `0.0` changes nothing, so `assert over["objective"] < base["objective"]` fails. | xlsx `Distance Matrix` row plant 1 → customer 1 = 0; `W1` is open in Scenario 1 | Fold: pick `next(a for a in assignments if a["distanceMi"] > 0)`; assert `over["objective"] == base["objective"] - d*demand` to within rounding rather than bare `<`. |
| B3 | 3 | **`cbc.runTimeSec` does not exist.** `_run_cbc(prob, gap, time_limit, *, problem_uid=None, msg=False)` returns `CBCCaptureResult` with slots `solutionStatus, terminationReason, achievedGap, solverIncumbentObjective, solverBestBound, lpStatus` only. Every solver times itself (`start = time.time()` … `run_time = time.time() - start`). The snippet also drops `quality=cbc.lpStatus`, never forwards the four evidence kwargs (`termination_reason`, `achieved_gap`, `solver_incumbent_objective`, `solver_best_bound`), and omits the non-optimal handling at `solve.py:1440-1446` (`_failureReason="solver_error"`, `_failureStage="cbc_parse"`), so a timeout or CBC parse failure would be published as a success. `status_str = "optimal" if … else cbc.solutionStatus` is a tautology. | `solve.py:192`, `cbc_termination.py:463-469`, `solve.py:231-250`, `solve.py:1440-1446` | Fold: copy `solve_max_coverage`'s timing + status + evidence-forwarding block verbatim; delete `status_str`. |
| B4 | 3 | **`UnresolvableIdError` lives in `merge_inputs.py:31`, not `solve.py`.** The snippet raises it without importing it. The test module also lacks the `sys.path.insert(0, …parent); sys.path.insert(0, …parent.parent)` bootstrap every sibling test uses — there is no `conftest.py`, `pytest.ini`, or `pyproject.toml` anywhere in the repo — so `from solve import …` fails at collection. | `merge_inputs.py:31`; `tests/test_max_coverage.py:22-24`; `find . -name conftest.py` → none | Fold: `from merge_inputs import UnresolvableIdError` in `solve.py`; add the bootstrap header to `test_delivery.py`. Note that the error surfaces on fd3 as `internal_error`/`solve_exception` (`solve.py:1549-1552`), which is exactly why Task 6 exists. |
| B5 | 3, 12 | **The Overflow row is never emitted, and the test named for it cannot fail.** Global Constraints and spec §5.6/§5.7/§8.2/§10 require an explicit Overflow row in `metrics.bandCoverage`. `solve_delivery` builds `band_coverage` as a comprehension over `distance_bands` only. `test_overflow_band_is_emitted` asserts `total < 100.0`, which is true whether or not a row exists. Repo has two conventions: p-median/transport/brazil emit cumulative rows with **no** overflow row; gold/jade emit `{"band": -1, …}` (`OVERFLOW_BAND`) exclusively. The client-side `computeCumulativeBandCoverage` appends an overflow row only when `overflowFlow > 0`. | `solve.py:485, 657, 849-851, 1056-1060, 1335-1340`; `lib/units/src/bands.ts:48-50` | Fold: emit cumulative rows **plus** `{"band": -1, "percent": round(overflow*100/total, 2)}` whenever overflow demand > 0 (matches the client helper's semantics); rewrite the test to assert a `band == -1` row exists for `[100, 200]` and is absent for the default bands. |
| B6 | 6 | **The precheck error codes and field do not exist.** `PrecheckErrorCode` is a closed union at `precheck.ts:76` — `"completeness" \| "id_collision" \| "reference_integrity" \| "p_range" \| "capacity" \| "zero_demand" \| "no_feasible_route" \| "coverage_floor_infeasible"`; `PrecheckError` is `{ code; message }` (`:86`), no `entityId`. The snippet's `unknown_warehouse` / `unknown_customer` / `unknown_lane` + `entityId` do not typecheck. Also missing vs spec §6.2.1 / Gate D: duplicate-pair and finite/negative cost checks, and a route-level test that a bad override yields **422** (`scenarios.ts:533-534`) rather than a worker `internal_error`. | `precheck.ts:76-91`; `jobRunner.ts:380-382`; `scenarios.ts:533` | Fold: use `reference_integrity` with the id in the message; add duplicate + domain checks; add one supertest case through `POST /scenarios/:id/solve` asserting 422. |
| B7 | 4 | **`validation/inputs/index.ts` is not a schema barrel.** It is a 10-line delegator exporting only `ValidateInputsResult` and `validateInputsForModel`. Every consumer imports `./pMedian.js`, `./maxCoverage.js` directly. Step 3's "re-export it from index.ts alongside the others" has no "others". | `validation/inputs/index.ts:1-10` | Fold: delete the re-export sentence; `modelRegistry.ts` imports `./delivery.js`'s schema directly like its siblings. |
| B8 | 12 | **`buildEffectiveFacilityCityLookup` returns a `Map`, not an object.** Signature is `(modelId: string, inputs: { addedWarehouses?; addedRefineries? }): Map<string, string>` with a ternary chain and an empty-map fallback. `lookup["W1"]` is always `undefined`, so the test is red against a correct implementation. | `templates.ts:1388-1402` | Fold: `lookup.get("W1")`. |
| B9 | 1 | **The extractor reads cells positionally and drops ZIP leading zeros.** `sheet_rows` returns `[cell_value(c) for c in row.findall("m:c")]`; xlsx omits empty `<c>` elements, so any blank cell shifts every later column silently (the sheets carry `Name`, `Active`, `Status`, `Country or Region` beyond the plan's list). Spec §4.3 requires ZIPs as strings preserving `02101`-class zeros; `cell_value` returns raw `<v>` text and nothing asserts it. | xlsx headers (Customers: `ID, Name, Active, City, State, Zip Code, Country or Region, Latitude, Longitude`; Plants add `Status`; Demand: `Customer ID, Customer, Product ID, Product, Time Period ID, Time Period, Demand`; Distance Matrix: `Plant ID, Plant, Customer ID, Customer, Distance`) | Fold: key cells by the column letter in each `<c r="…">`, look up header→letter once; zero-pad ZIP to 5 when the cell is numeric; add a Step 5 assertion on ZIP string-ness and on lat/lng ranges (spec Gate B). |

### R2. Should-fix — silent wrong behaviour, dead test, or stale premise

| # | Task | Finding | Evidence | Disposition |
|---|---|---|---|---|
| S1 | 8, 9, 11 | **`Workspace.tsx` has 12+ further `modelId ===` gates the plan never lists.** `isEditableInputTab` (`:2140-2200`) is an allow-list of `(entity, modelId)` pairs — with no `deliveryCosts` row the tab is not editable, so no Save/dirty path; Save-suppression rows (`:2211-2226`); reference-distances query `enabled` allow-list (`:1426`); input-map mode dispatch (`:2929/2954/2974`); OutputMap (`:3555-3614`); open-warehouses (`:3661-3686`); customer-assignments (`:3699`); flows (`:3747-3793`); `DistancesTab` `locationById` (`:3382`); `enableFilters` (`:3066`, `:3686`). These are `===` chains, not exhaustive switches — Task 8 Step 6's "typecheck will surface every remaining switch" is false for all of them. | `Workspace.tsx` lines cited | Fold: enumerate each gate as its own sub-step in Tasks 8/9/11 with a test; add them to the R7 inventory. |
| S2 | 10 | **`pMax` premise is stale.** It is already passed at both mounts: `Workspace.tsx:3320` (`modelId === "two-echelon-jade-us" ? jadeActiveWarehouseCount(...) : modelId === "max-coverage-us" ? 26 : undefined`) and `:4037` (`modelId === "max-coverage-us" ? 26 : undefined`). The action is to add a `33` arm to both ternaries, not "pass pMax". `pMax = 50` defaults at `OptimizationParametersTab.tsx:151` and `SolveDialog.tsx:156` are correct. | cited lines | Fold Task 10 Step 5. |
| S3 | 9, 10 | **Three plan-referenced handles are fictional.** `input-p` does not exist — P is a `<Slider>` with `data-testid="slider-p-value"` (`:205`), `max={pMax}` (`:201`), and quick-picks `button-p-quick-${n}` filtered by `n <= pMax` (`:209-213`). `input-map` does not exist — the root is `input-map-tab` (`InputMapTab.tsx:817`). `InputMapTab` has no `readOnly` prop today (read-only is expressed via `demandEditable` + omitting `onSave`). Real mutation testids: `button-input-map-place-wh`/`-cs` (`:833,836`), `map-add-menu(-wh/-cs/-pl)` (`:368-379`), `map-action-edit/-move/-copy/-delete` (`map/MapActionMenu.tsx`), `edit-warehouse-status*`, `edit-customer-status*`, `create-entity-status`, `edit-customer-demand-input/-slider`, `create-entity-demand`, `button-save` (`:868`). lat/lng are read-only `<p>` text, not inputs. `SolveDialog` is at `components/workspace/SolveDialog.tsx` (no `dialogs/`). | cited lines | Fold Task 9 Step 1 testid list and Task 10 `caps the P slider` test (assert `slider-p-value` `max` and that `button-p-quick-25` renders while nothing above 33 does). |
| S4 | 8, 13 | **`Landing.test.tsx:388` asserts `"3 labs · 3 scenarios · 1 solved"`.** Goes red the moment the chapter is visible. Not listed in any task. `App.test.tsx:132,141,149` enumerates hidden paths — unaffected since delivery is visible. `lockedChapterDrift.test.ts` pins the locked set to `["two-echelon-jade-us"]` — unaffected. | `Landing.test.tsx:388` | Fold into Task 8 Step 6: update to `4 labs`. |
| S5 | 4 | **`registration.test.ts` has source-text gates per model** at `:222-238` (asserts the `pmedian.ts` branch, the `solve.py` `model_type == '…'` string, and the openapi enum entry via `readFileSync`). Task 4 lists only `SOLVABLE`, stubs, and the count (`toHaveLength(6)` at `:98`). | `registration.test.ts:98, 118-134, 222-238` | Fold Task 4 Step 4: extend all three gates for `delivery` / `model_type == 'delivery'`. |
| S6 | 2 | **`lib/dataset-schema/src/index.test.ts` is hand-written per model, not a loop.** Gold `:4`, jade `:33`, max-coverage `:64` each have a `validatePackage(spec)` + `computeSha256 == readVersion().sha256` block. A 7th model gets zero package validation and zero sha coverage unless a block is added. Same for `maxCoverageDataset.test.ts:40`'s version check pattern on the api-server side. | `index.test.ts` | Fold into Task 2 Step 1 (new block) and Task 5 (a `deliveryDataset.test.ts` mirroring `maxCoverageDataset.test.ts`). |
| S7 | 1, 3 | **`test_datasets.py` delivery case is absent** (spec §8.2: 33/313/10,329 in both files, no missing pair, files agree at seed). The only shape guard over 10,329 transcribed lanes is the extractor's `--check`. | `tests/test_datasets.py` | Fold into Task 3 Step 1 as a second test file addition. |
| S8 | 4, 7 | **`ModelInfoCapabilities` is not a named OpenAPI schema.** Capabilities is an inline object under `ModelInfo` (`openapi.yaml:932-957`) with `required: [supportsP, capacityModes, demandEditable, outputGrids, supportsFacilityStatus, supportsReferenceDistances, supportsAddedCustomerExclusion]` (`:958`). `outputGrids` is `array of string`, no enum, in both Zod (`z.array(z.string())`) and OpenAPI. The four `modelId` enum sites are `:47`, `:166-172`, `:1417-1424`, `:1618-1625`; `Scenario.inputs` / `ScenarioInput.inputs` / `ScenarioUpdate.inputs` are bare `type: object` (no per-model oneOf), and `ModelInfo.id` has no enum — good news, nothing else to add. | cited lines | Fold Task 4 Step 5 wording; decide whether `supportsReferenceCosts` joins `required` (recommend yes, since the registry always emits it). |
| S9 | 13 | **`e2e_journey.py` dispatches via a `JOURNEYS` dict** (`:620-626`: auth/dataset/pmedian/transport/brazil). `python3 e2e_journey.py http://localhost:3000 delivery` parses (`argv[1]` URL, `argv[2]` section) but exits 1 with `Unknown section` until an entry is added. | `e2e_journey.py:55-57, 620-643` | Fold Task 13 Step 2: "add `delivery` to `JOURNEYS`". |
| S10 | 12 | **`ServiceStatsTab` imports `computeCumulativeBandCoverage` from the studio shim `@/lib/bands`**, not `@workspace/units`; live recompute (`useLiveCoverage`, `:242, :288-290`) drives the displayed percentages whenever Workspace passes `presentationBands`, and the envelope's `metrics.bandCoverage` is only the fallback. The `decimals` option must be threaded through `artifacts/studio/src/lib/bands.ts:25-37`. Envelope precision therefore matters for exports and Solution Summary, not for the Service Stats bars. | `ServiceStatsTab.tsx:6, 242, 288-290`; `studio/src/lib/bands.ts` | Fold Task 12 Steps 3/5. |
| S11 | 12, 13 | **`services/import.ts` and the `scenarios.ts` export/import gates are unlisted registration points.** `import.ts:476, 509, 553-568, 633, 918` (five modelId ternaries incl. the `entity === "customers"` allowlist); `scenarios.ts:906-926` export entity gate and `:931/:1005/:1094/:1206` export builders; `:1602-1622`, `:1670-1690` import gates; `normalizeAddedEntityDistances` `:451-484`. Task 12 Step 7 says output exports are in scope but never touches the export gate. | cited lines | Fold: trace each for the delivery model; record in R7 which are N/A (no importable entities) vs required (output grid exports). |
| S12 | 3, 7, 12 | **Spec-mapped tests missing.** `test_single_source` lacks the `flow == demand` half (§8.2). `referenceCosts.test.ts` promises "malformed" in the File Structure table but has no malformed-source case. No manifest-vs-Zod parity test in `deliveryContract.test.ts` though spec §6.1 says that file keeps them in step. No test that Solution Summary shows Objective + WAD and no "Open facilities" row, that Service Stats hosts the bands, or that the Output Map draws lines (decision 10, §7.6). `formatObjective`/`ObjectiveBar` rendering (monetary vs demand-distance) untested; only `objectiveDimension` is. No `_LOAD_ERRORS` / `_load_error_envelope` path test (§5.8). | spec §8, §7.6, §5.8 | Fold: one named test per item into Tasks 3/7/8/12. |
| S13 | 1 | **Prototype reproducibility rework (§4.3 / §12.5) has no task.** `docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py` (76 lines) hardcodes `~/Downloads` and `/tmp/ch5x/`; Task 3's docstring cites it as the independent oracle. Its formulation is `<= P`, per-pair linking, cost derived from distance at solve time — consistent with `solve_delivery`. | asset file | Fold: add Task 1 Step 9 (take `--xlsx`, verify SHA, write only requested dirs) or explicitly waive in the plan with a reason. |
| S14 | 8 | **`Workspace.TabCoverage.test.tsx` and `lib/units/src/__tests__/objective.test.ts` ("the six-model contract") are per-model enumerations.** Neither is listed. `inputEntriesForModel` is module-private today (`:1184`) — the plan already anticipates exporting it. | `Workspace.TabCoverage.test.tsx:656-731`; `objective.test.ts:4` | Fold: add a delivery `describe` to each in Task 8. |
| S15 | 0 | **Task 0 Step 3's command is invalid.** `rg --type tsx` — `tsx` is not an rg type; the step errors out instead of producing the audit list. Step 5's baseline omits `e2e_journey.py` and `pnpm e2e:gate`, so Task 13 Step 5's "diff against the baseline" has no baseline for them. | `rg --type-list` | Fold: use `--glob '*.{ts,tsx,py}'`; add both commands to Step 5. |
| S16 | 5, 7 | **Two root-resolution conventions.** `maxCoverageDataset.ts:13` reimplements `findRepoRoot` (Task 5 copies it); `referenceDistances.ts:3` imports `SOLVERS_ROOT` from `@workspace/dataset-schema` (Task 7 copies that). Both work; the plan should say why it keeps both rather than leave an implementer to "tidy" one. | cited lines | Fold: one sentence in Task 7 Step 3. |
| S17 | 13 | **Docs targets are off or incomplete.** CHANGELOG refs are `:412` (`"2 labs"` stale specs) and `:449` (`"Chapter 5 — nothing to commit"`), not 411/448. `model-integration-precheck.md` has **10** numbered points today (`:37-83`); none of `inputEntriesForModel`, `pMax`, `routes/index.ts`, `buildEffectiveFacilityCityLookup`, or the precheck dispatcher appears. Spec §12.4.4 also names the CLAUDE.md model table ("Six models live under `solvers/`"); Task 13 lists only `CLAUDE.md:139`. | cited lines | Fold Task 13 Step 6. |

### R3. Nits — reference rot inside the plan

| # | Finding | Disposition |
|---|---|---|
| N1 | Plan-resolution table rows 1, 5, 6 cite "Task 9", "Task 8", "Task 8"; the real tasks are 8, 7, 7. Line "Domain validation lives in Task 8's reference-cost builder" (Task 2 Step 5) → Task 7. | Fold. |
| N2 | Task 3 Interfaces declares `_build_delivery_problem(warehouses, customers, demand, ec, p)`; the code and both call sites use `(ec, p)`. | Fold to `(ec, p)`. |
| N3 | Task 5 Interfaces omits `DELIVERY_LANE_KEYS`, which the code exports and Tasks 6/7 consume by name. | Fold. |
| N4 | Task 9 Step 1 appends a `describe` using `render`, `screen`, `InputMapTab` to a file whose Task 8 imports include none of them. | Fold: add the import step. |
| N5 | `ServiceStatsTab.tsx` is edited (Task 12 Step 5) and committed (Step 8) but appears in neither the Modified-files table nor Task 12's Files list. The Modified table also omits `validation/inputs/index.ts` (now moot, B7), `__tests__/precheck.test.ts`, `__tests__/templates.test.ts`, `lib/units/src/bands.test.ts`, `__tests__/OptimizationParametersTab.test.tsx`, `lib/dataset-schema/src/manifest.test.ts`, `e2e/bundle4-auth-landing.spec.ts`, `e2e/bundle6-ui-tweaks.spec.ts`. | Fold: regenerate the table from the union of every task's Files list. |
| N6 | Global Constraints say "Do not import across packages to satisfy a test", yet Task 8's studio test imports `objectiveDimension` from `@workspace/units`. Workspace-package imports are normal; the rule was about relative paths into a sibling package's `src/`. | Fold: reword the constraint. |
| N7 | Task 13 Step 4 runs `e2e_journey.py http://localhost:3000 delivery`; spec §12.9 runs `e2e_journey.py delivery`. Both parse; pick one. | Fold. |
| N8 | `registration.test.ts` line references in Task 4 are absent; `modelRegistry.ts` capability interface is `PublicModelInfo.capabilities` at `:69-80` (inline intersection), mapping at `:103`; `solve.py` dispatcher is at `:1477-1494`, loaders at `:73-176`. | Fold line refs. |
| N9 | Manifest `laneCostOverrides.cost` is `minimum: 0` in the plan and `exclusiveMinimum: 0` in spec §6.1; spec §7.4 also says "positive cost". The plan is right (§6.2/§12.3.4, 33 zero self-lanes) but the spec contradiction is unflagged. | Fold: note it; correct the spec in the same commit as Rev 2. |
| N10 | Task 11 test mocks pagination at 120 pairs; spec §8.4 says "pagination works at 10,329 rows". A 120-row mock proves paging, not the render cost at 10,329 — add one render-time assertion or state the waiver. | Fold. |
| N11 | `test_delivery.py` docstring comment for `assignments[].distanceMi`/`band` — field names are plan inventions (spec defines no assignment shape). They match `solve_pmedian`'s `{customerId, warehouseId, distanceMi, band}` (`solve.py:475-476`), which is the right choice; say so and pin it with a test. | Fold. |
| N12 | Self-Review §1 says Decision 10 → "Tasks 3/12" but Task 12 has nothing about the Summary/Service-Stats split beyond band precision. | Resolved by S12. |

### R4. Claims that held (so Rev 2 need not re-trace them)

`KNOWN_SCHEMAS` `:19`; `VALID_MODEL_IDS` `:92`; `SolveInput` `:8` and the unguarded p-median fallthrough at `pmedian.ts:173`; `runNetworkEditsPrecheckForModel` `:1368` with silent `ok:true` at `:1387`; `routes/dataset.ts` if-chain with 400 fallthrough at `:59`; `routes/index.ts:19-27` mounts every router incl. `referenceDistances` at `:23`; `referenceDistances.ts` registry/ETag/304/422 shape (unknown id and no-capability both 422; unauthenticated); `WarehouseCandidate`/`Customer` types incl. optional `zip` and required `demand`; `lib/db/src/index.ts:7-11` throws without `DATABASE_URL`; `scenarios.model_id` is plain `text`; `DistanceMap` `:23`; `PACKAGE_SPECS` `:115` (max-coverage entry `:160-167`); `MODEL_IDS` `:269`; `computeSha256(spec)` hashes sorted filenames; `readManifest`/`readVersion`/`SOLVERS_ROOT` exports; `computeCumulativeBandCoverage` `:37-52` with `OVERFLOW_BAND = -1`; `objectiveDimension(modelId, objectiveMode)` `:20` with `default: "opaque"`; `objectiveModeOfDetails` reads `details.objective` as a free string (so `"cost_adjusted"`/`"base"` work); `codegen` script is `orval --config ./orval.config.ts && pnpm -w run typecheck:libs`; `e2e:gate`/`e2e:quarantine`/`typecheck` root scripts; `StudioModelType` union on `chapters.ts:1`; `Chapter` interface with required `labHeaderTitle`/`labHeaderSubtitle`; `App.tsx:63-86` iterates `CHAPTERS` (no route edit needed); both Ch5 entries `hiddenFromLanding: true`; `defaultInputsForModel` exported at `:125`; `inputEntriesForModel` tail `case "p-median-brazil": case "p-median-us": default:` at `:1222-1231`; `OpenWarehousesTab.tsx:158-160` empty-vs-absent `capacityModes` gate; `DistancesTab` `PAGE_SIZE = 50` (`:330`), `fromFilter`/`toFilter`, `useDistanceDraft`, `useGetReferenceDistances`; all seven named studio test files exist; 15 studio tests already import `@/pages/Workspace`; `bundle4-auth-landing.spec.ts:120,153-154,183-184,212-213` and `bundle6-ui-tweaks.spec.ts:270-271` assert `"2 labs"` (stale today; their `auth-labs-strip` expectations also contradict each other); no Compare page exists (multi-scenario compare is `CostSummaryTab.tsx:444`); no analytics model-id enum; `README.md:155,171` "six models"; `CLAUDE.md:139` "fully non-runnable"; `e2e_journey.py:201,235,239` auth lines; `attached_assets/NOTEBOOKS.md:16,104-109`; `.claude/glm-delegation-disabled.md` exists; all eight PuLP names in the snippet are already imported (`solve.py:24-26`); `solve.py:404-405` uses `LpConstraintEQ` for p-median.

### R5. Closeout strategy

Overkill check: no new tooling. Fold in place, re-verify with the same probe. There is no simpler alternative that leaves the plan executable.

1. **Sequence.** Chapter 5 branches off `main` **after** `ch4-2s-7-work` merges. Task 0 Step 2 gains `git merge-base --is-ancestor <ch4-merge-sha> HEAD`. Task 10 is blocked until then; Tasks 1–9 and 11–12 are not (their files do not overlap the Ch4 branch — true overlap is `Workspace.tsx`, `OptimizationParametersTab.tsx`, `SolveDialog.tsx`, `openapi.yaml`, `solve.py`, `CLAUDE.md`; **not** `objective.ts`, `bands.ts`, `chapters.ts`, `precheck.ts`, `templates.ts`, `model-integration-precheck.md` as the closing note feared).
2. **Fold, Rev 2.** Every B/S/N row is rewritten into its task body in place — no errata layer. The Modified-files table is regenerated from the union of every task's Files list. Missing tests become named steps: `test_datasets.py` case, `index.test.ts` block, `deliveryDataset.test.ts`, `Landing.test.tsx` 4-labs, `TabCoverage` block, `objective.test.ts` row, `registration.test.ts` source gates, `JOURNEYS` entry, `referenceCosts` malformed case, `flow == demand`, manifest-vs-Zod parity, Summary/Service-Stats/Output-Map placement, route-level 422.
3. **Registration inventory as a table (R7), not prose.** Spec §13.1 promised Gates A–G and a review matrix; the plan carries neither. R7 is the matrix: point → verified `file:line` → task → test that fails if missed → silent or loud.
4. **Resolve the two spec contradictions explicitly** in the plan body and correct the spec in the same commit: Overflow row emitted by the solver (yes, `band: -1` when overflow > 0); `laneCostOverrides.cost` `minimum: 0` (spec §6.1 snippet and §7.4 "positive" are wrong).
5. **Re-run the six-lens verification on Rev 2** before declaring ready. A claim checked at Rev 1 is not checked at Rev 2.

### R6. Dependency-check methods

- **Probe sweep by newest sibling.** Every registration point contains the literal `"max-coverage-us"`. Committed into Task 0 with its expected hit list; re-run at Task 13; any hit outside R7 is a finding:
  ```bash
  rg -n --glob '!**/generated/**' --glob '!**/*.test.*' --glob '!**/__tests__/**' --glob '!e2e/**' \
     '"max-coverage-us"' artifacts lib solvers scripts
  ```
  Against `3065c91` this surfaces `services/import.ts`, `data/referenceDistances.ts`, `lib/units/src/objective.ts`, and the Workspace gates in S1 — none of which the Rev 1 inventory carried.
- **Set-equality test** (spec §9 recommends it; Rev 1 dropped it). One api-server test asserting `MODEL_IDS == keys(KNOWN_SCHEMAS) == VALID_MODEL_IDS == PACKAGE_SPECS ids == openapi enum (×4, via readFileSync) == CHAPTERS modelIds (via readFileSync of chapters.ts)`. Kills the "registered in four of six places" class permanently.
- **Silent-fallback inventory.** Six places swallow an unknown model rather than fail: `pmedian.ts:173` (p-median payload), `precheck.ts:1387` (`ok:true`), `templates.ts:1402` (empty map), `objective.ts` default (`opaque`), `inputEntriesForModel` default (p-median tab set), `isEditableInputTab` (not editable). Each gets a dedicated negative test in Rev 2. Optional follow-up outside this plan: make the `switch (modelId: StudioModelType)` sites exhaustive with `assertNever` so typecheck catches the eighth model.
- **Per-task compile gate.** After each commit: `pnpm run typecheck` plus that task's test file only. Interface tables already exist per task; a task's test may import only names an earlier task produced.
- **Cross-branch overlap before Task 10.** `git diff --name-only main...ch4-2s-7-work` intersected with the plan's Modified-files list is the true conflict set; recompute after the Ch4 merge.
- **Spec-to-plan trace on Rev 2.** Repeat the decision-by-decision and §9 point-by-point cross-check; on Rev 1 it found eight unmapped spec sections.

### R7. Verified registration inventory (at `3065c91`)

| # | Point | File:line | Task | Fails how if missed | Test that catches it |
|---|---|---|---|---|---|
| 1 | Manifest | `solvers/delivery-teaching-us/manifest.json` | 2 | loud (`readManifest` throws) | `manifest.test.ts` |
| 2 | `version.json` | same dir | 2 | loud (`readVersion` throws) | `index.test.ts` block (S6) |
| 3 | Zod schema + `KNOWN_SCHEMAS` | `modelRegistry.ts:19` | 4 | loud (422 on PATCH) | `registration.test.ts` |
| 4 | `VALID_MODEL_IDS` | `routes/scenarios.ts:92` (enforced `:225`) | 4 | loud (422 on create) | `registration.test.ts` |
| 5 | `PACKAGE_SPECS` | `dataset-schema/src/index.ts:115` | 2 | loud | `index.test.ts` block |
| 6 | `SolveInput` + `buildPayload` | `pmedian.ts:8`, `:173` fallthrough | 4 | **silent** (p-median payload) | `deliveryContract.test.ts` "never emits p_median" |
| 7 | OpenAPI enums ×4 + capability + path | `openapi.yaml:47, 166-172, 1417-1424, 1618-1625, 932-958` | 4, 7 | loud (Zod client rejects) | `registration.test.ts:222-238` gate |
| 8 | Solver dispatcher | `solve.py:1477-1494` | 3 | loud (fd3 dispatch failure) | `test_delivery.py` + registration source gate |
| 9 | `MODEL_IDS` | `dataset-schema/src/index.ts:269` | 2 | loud | `manifest.test.ts:274-280` loop |
| 10 | `objectiveDimension` | `lib/units/src/objective.ts:20` | 8 | **silent** (`opaque`) | `deliveryRegistration.test.tsx` + `objective.test.ts` row |
| 11 | `inputEntriesForModel` explicit case | `Workspace.tsx:1184` (tail `:1222-1231`) | 8 | **silent** (p-median tabs) | `deliveryRegistration.test.tsx` |
| 12 | `defaultInputsForModel` | `Workspace.tsx:125` | 8 | loud (TS exhaustiveness) | same |
| 13 | `CHAPTERS` + `StudioModelType` | `chapters.ts:1`, entries | 8 | loud | `chapters.test.ts`, `Landing.test.tsx:388` (S4) |
| 14 | Precheck dispatcher | `precheck.ts:1368-1387` | 6 | **silent** (`ok:true`) | `precheck.test.ts` + route-level 422 (B6) |
| 15 | Router mount | `routes/index.ts:19-27` | 7 | **silent** (404) | `referenceCosts.test.ts` "reachable" |
| 16 | `buildEffectiveFacilityCityLookup` | `templates.ts:1388-1402` | 12 | **silent** (blank city column) | `templates.test.ts` (B8) |
| 17 | `pMax` both mounts | `Workspace.tsx:3320`, `:4037` | 10 | **silent** (slider offers 50, API 422s) | `OptimizationParametersTab.test.tsx`, `SolveDialog.test.tsx` |
| 18 | `registration.test.ts` SOLVABLE/stubs/count/source gates | `:25, :98, :118, :222-238` | 4 | loud | itself |
| 19 | `routes/dataset.ts` branch | `:14-59` | 5 | loud (400) | `deliveryContract.test.ts` |
| 20 | `isEditableInputTab` allow-list | `Workspace.tsx:2140-2200` | 11 | **silent** (no Save) | new (S1) |
| 21 | Save-suppression rows | `Workspace.tsx:2211-2226` | 9 | silent | new (S1) |
| 22 | Reference-distances query allow-list | `Workspace.tsx:1426` | 11 | n/a for delivery (no distances) | note only |
| 23 | Input-map mode dispatch + read-only | `Workspace.tsx:2929-3004` | 9 | silent (editable map) | `deliveryRegistration.test.tsx` map block |
| 24 | OutputMap / open-warehouses / assignments / flows gates | `Workspace.tsx:3555-3614, 3661-3699, 3747-3793` | 12 | silent (empty output tabs) | `TabCoverage` block (S14) |
| 25 | `services/import.ts` ternaries | `:476, 509, 553-568, 633, 918` | 13 (audit) | n/a (no importable entities) — must be *recorded* as N/A | R7 row |
| 26 | `scenarios.ts` export gate + builders | `:906-926, 931-1206` | 12 | loud or silent per grid — trace | export test (S11) |
| 27 | `e2e_journey.py` `JOURNEYS` | `:620-626` | 13 | loud (exit 1) | itself |
| 28 | Studio band shim `decimals` passthrough | `studio/src/lib/bands.ts:25-37` | 12 | silent (integer %) | `ServiceStatsTab.test.tsx` |
| 29 | `index.test.ts` / `deliveryDataset.test.ts` / `test_datasets.py` | per-model blocks | 2, 5, 3 | silent (zero coverage) | themselves |
| 30 | `Landing.test.tsx:388`, `bundle4`/`bundle6` e2e lab counts | cited | 8, 13 | loud (red suite) | themselves |

Rows 1–18 correspond to spec §9 (renumbered to match this plan's task order); rows 19–30 are the points this review added.
