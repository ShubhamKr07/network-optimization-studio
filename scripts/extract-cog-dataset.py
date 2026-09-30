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


def _col_letters(ref):
    """'AB12' -> 'AB'. Cells carry their own column in `r`; positional reading
    is wrong because xlsx OMITS empty cells, so a blank Zip Code would shift
    every later column silently."""
    return "".join(ch for ch in ref if ch.isalpha())


def sheet_records(z, sheets, sst, name):
    """Return a list of {header: raw-cell-text} dicts, one per data row.

    Keyed by header name via the header row's column letters, never by
    position. The workbook's sheets carry columns this script does not use
    (Customers: Name, Active, Country or Region; Plants: Status too; Demand:
    Customer, Product ID, Product, Time Period ID, Time Period; Distance
    Matrix: Plant, Customer) - reading by name makes them harmless.
    """
    target = sheets[name]
    path = target if target.startswith("xl/") else "xl/" + target.lstrip("/")
    ws = ET.fromstring(z.read(path))

    def cell_value(c):
        t = c.get("t")
        v = c.find("m:v", NS)
        if v is None:
            return None
        if t == "s":
            return sst[int(v.text)]
        return v.text

    rows = list(ws.iter("{%s}row" % M))
    header_by_col = {_col_letters(c.get("r")): cell_value(c) for c in rows[0].findall("m:c", NS)}
    records = []
    for row in rows[1:]:
        rec = {h: None for h in header_by_col.values()}
        for c in row.findall("m:c", NS):
            h = header_by_col.get(_col_letters(c.get("r")))
            if h is not None:
                rec[h] = cell_value(c)
        records.append(rec)
    return records


def zip5(raw):
    """Spec 4.3: ZIPs are strings and keep leading zeros. In THIS workbook every
    ZIP is already a 5-character shared string ('02101' included; 21 of them
    lead with 0, none are numeric-typed), so this is a no-op guard - kept so a
    re-saved workbook whose ZIP column became numeric cannot silently emit
    '2101'."""
    if raw is None:
        return None
    s = str(raw).strip()
    if s.endswith(".0"):
        s = s[:-2]
    return s.zfill(5) if s.isdigit() else s


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

    plants = sheet_records(z, sheets, sst, "Plants")
    customers = sheet_records(z, sheets, sst, "Customers")
    demand = sheet_records(z, sheets, sst, "Demand")
    distances = sheet_records(z, sheets, sst, "Distance Matrix")

    def ident(raw):
        # Numeric id cells arrive as '8' or '8.0' depending on the writer.
        s = str(raw).strip()
        return s[:-2] if s.endswith(".0") else s

    warehouses = {}
    for r in plants:
        wid = "W" + ident(r["ID"])
        warehouses[wid] = {
            "id": wid,
            "city": r["City"],
            "state": r["State"],
            "lat": num(r["Latitude"], 6),
            "lng": num(r["Longitude"], 6),
            "zip": zip5(r["Zip Code"]),
        }

    demand_by_customer = {ident(r["Customer ID"]): float(r["Demand"])
                          for r in demand if r["Demand"] is not None}

    customers_out = {}
    for r in customers:
        raw_id = ident(r["ID"])
        cid = "C" + raw_id
        customers_out[cid] = {
            "id": cid,
            "city": r["City"],
            "state": r["State"],
            "lat": num(r["Latitude"], 6),
            "lng": num(r["Longitude"], 6),
            "zip": zip5(r["Zip Code"]),
            "demand": demand_by_customer[raw_id],
        }

    lanes = {}
    for r in distances:
        key = "W" + ident(r["Plant ID"]) + ",C" + ident(r["Customer ID"])
        if key in lanes:
            raise SystemExit("duplicate lane key: " + key)
        lanes[key] = num(r["Distance"], 4)

    # Fail loud rather than emitting a plausible-but-wrong package.
    assert len(warehouses) == EXPECTED_WAREHOUSES, len(warehouses)
    assert len(customers_out) == EXPECTED_CUSTOMERS, len(customers_out)
    assert len(lanes) == EXPECTED_LANES, len(lanes)
    assert sum(c["demand"] for c in customers_out.values()) == EXPECTED_TOTAL_DEMAND
    missing = [(w, c) for w in warehouses for c in customers_out
               if f"{w},{c}" not in lanes]
    assert not missing, f"{len(missing)} missing lanes, e.g. {missing[:3]}"
    # Spec Gate B: coordinates inside the continental-US box the manifest
    # declares, and ZIPs as 5-character strings.
    for e in list(warehouses.values()) + list(customers_out.values()):
        assert 24 <= e["lat"] <= 50 and -125 <= e["lng"] <= -66, (e["id"], e["lat"], e["lng"])
        assert isinstance(e["zip"], str) and len(e["zip"]) == 5, (e["id"], e["zip"])

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
