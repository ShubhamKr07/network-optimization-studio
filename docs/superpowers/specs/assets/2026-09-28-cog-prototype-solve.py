#!/usr/bin/env python3
"""Design-time oracle for the delivery-teaching-us LP (spec §4.3 / §12.5).

Standalone and shares no code with solve.py or scripts/extract-cog-dataset.py
— that is what makes it an oracle: it re-derives the two §8.1 goldens from the
raw xlsx via its own xlsx parsing and its own LP formulation.

Usage:
  python3 docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py \
      --xlsx attached_assets/COG-Model-Data-3DC-3WH.xlsx [--json-out /tmp/ch5x/goldens.json]
"""
import argparse
import hashlib
import json
import os
import sys
import time
import xml.etree.ElementTree as ET
import zipfile

import pulp

EXPECTED_XLSX_SHA256 = "0b8feeba841d55cdbc3c9b852413e0fbc80cb1dc06b7531ef3503a9e42be28c3"

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"m": M, "r": R}


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--json-out", default=None,
                    help="optional path to write the two scenario results as JSON")
    args = ap.parse_args()

    actual = sha256_of(args.xlsx)
    if actual != EXPECTED_XLSX_SHA256:
        raise SystemExit(
            f"source sha256 mismatch\n  expected {EXPECTED_XLSX_SHA256}\n  actual   {actual}")

    XLSX = args.xlsx
    z = zipfile.ZipFile(XLSX)
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    sh = {s.get('name'): rels[s.get('{%s}id' % R)] for s in wb.find('m:sheets', NS)}
    sst = [''.join(t.text or '' for t in si.iter('{%s}t' % M)) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]

    def cv(c):
        t = c.get('t')
        v = c.find('m:v', NS)
        return sst[int(v.text)] if t == 's' else (v.text if v is not None else None)

    def rows(n):
        tgt = sh[n]
        path = tgt if tgt.startswith('xl/') else 'xl/' + tgt.lstrip('/')
        return [[cv(c) for c in r.findall('m:c', NS)] for r in ET.fromstring(z.read(path)).iter('{%s}row' % M)]

    Cs = rows('Customers'); Ps = rows('Plants'); Ds = rows('Demand'); Xs = rows('Distance Matrix')
    ch, ph, dh = Cs[0], Ps[0], Ds[0]
    cust = [r[ch.index('ID')] for r in Cs[1:]]
    cname = {r[ch.index('ID')]: r[ch.index('Name')] for r in Cs[1:]}
    plant = [r[ph.index('ID')] for r in Ps[1:]]
    pname = {r[ph.index('ID')]: r[ph.index('Name')] for r in Ps[1:]}
    dem = {r[dh.index('Customer ID')]: float(r[dh.index('Demand')]) for r in Ds[1:]}
    xh = Xs[0]
    dist = {(r[xh.index('Plant ID')], r[xh.index('Customer ID')]): float(r[xh.index('Distance')]) for r in Xs[1:]}
    TOTAL = sum(dem[c] for c in cust)

    def run(label, P, adjust, thr=800.0, cpm=1.0, cpmo=10.0,
            demand_overrides=None, excluded=None, forced_open=None, inactive=None,
            binary_assign=True, gap=0.0, tl=600):
        cust_active = [c for c in cust if c not in (excluded or set())]
        dem_eff = dict(dem)
        for cid, v in (demand_overrides or {}).items():
            dem_eff[cid] = v
        total_active = sum(dem_eff[c] for c in cust_active) or 1.0

        cost = {k: v for k, v in dist.items()}          # cost seeded == distance
        if adjust:
            ec = {k: v * (cpm if dist[k] <= thr else cpmo) for k, v in cost.items()}
        else:
            ec = dict(cost)
        t0 = time.time()
        prob = pulp.LpProblem("delivery", pulp.LpMinimize)
        cat = 'Binary' if binary_assign else 'Continuous'
        y = pulp.LpVariable.dicts("A", [(w, c) for w in plant for c in cust_active], 0, 1, cat=cat)
        o = pulp.LpVariable.dicts("O", plant, 0, 1, cat='Binary')
        prob += pulp.lpSum(ec[(w, c)] * dem_eff[c] * y[(w, c)] for w in plant for c in cust_active)
        for c in cust_active:
            prob += pulp.lpSum(y[(w, c)] for w in plant) == 1
        prob += pulp.lpSum(o[w] for w in plant) <= P
        for w in plant:
            for c in cust_active:
                prob += y[(w, c)] <= o[w]
        # bounds, mirroring the solver:
        for w in plant:
            if w in (forced_open or set()):
                prob += o[w] >= 1
            if w in (inactive or set()):
                prob += o[w] <= 0
        build = time.time() - t0
        t1 = time.time()
        prob.solve(pulp.PULP_CBC_CMD(msg=0, gapRel=gap, timeLimit=tl))
        solve_t = time.time() - t1
        status = pulp.LpStatus[prob.status]
        print(f"\n=== {label}  P={P} adjust={adjust} assign={cat}")
        print(f"  status            : {status}")
        print(f"  customersActive   : {len(cust_active)} / {len(cust)}")
        if status != "Optimal":
            print(f"  build {build:.1f}s  solve {solve_t:.1f}s  total {build + solve_t:.1f}s")
            return dict(label=label, status=status)
        obj = pulp.value(prob.objective)
        opened = sorted([w for w in plant if o[w].varValue and o[w].varValue > 0.5], key=lambda w: int(w))
        dw = 0.0; band = {b: 0.0 for b in (400, 800, 1200, 1600)}
        for w in plant:
            for c in cust_active:
                v = y[(w, c)].varValue
                if v and v > 0.5:
                    d = dist[(w, c)]; dw += d * dem_eff[c]
                    for b in band:
                        if d <= b:
                            band[b] += dem_eff[c]
        print(f"  objective         : {obj:,.4f}")
        print(f"  open DCs          : {[(w, pname[w]) for w in opened]}")
        print(f"  weightedAvgDist   : {dw / total_active:,.4f} mi")
        print(f"  bandCoverage %    : " + ", ".join(f"{b}:{band[b] * 100 / total_active:.2f}" for b in sorted(band)))
        print(f"  build {build:.1f}s  solve {solve_t:.1f}s  total {build + solve_t:.1f}s")
        return dict(label=label, status=status, obj=obj, opened=opened, wad=dw / total_active,
                    bands={b: band[b] * 100 / total_active for b in band},
                    customersActive=len(cust_active), build=build, solve=solve_t)

    print(f"plants={len(plant)} customers={len(cust)} lanes={len(dist)} totalDemand={TOTAL:,.0f}")
    res = []
    res.append(run("Scenario 1 (base, $1/mi)", 3, False))
    res.append(run("Scenario 2 (adjusted 1/10 @800)", 3, True))

    # G1: demand override on a customer NOT co-located with any warehouse (C10, Riverside,
    # min distance to any warehouse 59.2 mi) so both the objective and the weighted average
    # are forced to move -- a discriminating golden for override plumbing.
    res.append(run("G1 demand override: C10 -> 20,000,000", 3, False,
                   demand_overrides={"10": 20_000_000}))
    # G1b: the original co-located case (C1/W1 both Los Angeles, distance 0). Kept as a
    # documented dataset property, but its objective is deliberately non-discriminating --
    # see the caveat in the §14.6 caption. Must NOT be used as the sole override-plumbing test.
    res.append(run("G1b demand override (co-located, non-discriminating): C1 -> 20,000,000", 3, False,
                   demand_overrides={"1": 20_000_000}))
    res.append(run("G2 exclusion: drop C1", 3, False, excluded={"1"}))
    res.append(run("G3 forced_open > P: pin 4 with P=3", 3, False,
                   forced_open={"6", "43", "45", "60"}))
    res.append(run("G4 all inactive", 3, False, inactive=set(plant)))
    # G5 vs G2: same customer (C1), zero-demand (still assigned) vs excluded (removed).
    # Measures whether the plan's "leaves the denominator / stays in it" distinction produces
    # an observable metric difference, or only an assignment-count difference.
    res.append(run("G5 zero-demand, not excluded: C1 -> 0", 3, False,
                   demand_overrides={"1": 0}))
    # G2b / G5b: same comparison on a non-co-located customer (C10), so the conclusion is not
    # an artifact of C1's zero-distance property.
    res.append(run("G2b exclusion: drop C10", 3, False, excluded={"10"}))
    res.append(run("G5b zero-demand, not excluded: C10 -> 0", 3, False,
                   demand_overrides={"10": 0}))

    if args.json_out:
        out_dir = os.path.dirname(args.json_out)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        json.dump(res, open(args.json_out, "w"), indent=1)


if __name__ == "__main__":
    main()
