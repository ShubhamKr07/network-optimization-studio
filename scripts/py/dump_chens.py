#!/usr/bin/env python3
"""Slice `get_data()` out of the Chen's Cosmetics notebook and dump it as JSON.

The notebook (`ChensCosmeticsV1 Step 3.ipynb`) is an EXTERNAL attached file — its
path is passed at runtime via `--notebook`, never baked into this script.

The `get_data()` cell defines four dict literals:
  warehouses       {numeric_id: (name, city, country, lat, lng)}
  customers        {numeric_id: (name, city, country, lat, lng)}
  customer_demands {numeric_id: int}
  distance         {(warehouse_id, customer_id): km}   # integer TUPLE keys

We AST-parse the cell (no exec of notebook code) and `ast.literal_eval` each of
those four assignment values, then print:
  {"warehouses": {...}, "customers": {...}, "customer_demands": {...},
   "distance": {"w,c": km}}
`distance` tuple keys are stringified as "w,c" so the result is JSON-serialisable.
"""
import argparse
import ast
import json
import sys

WANTED = ("warehouses", "customers", "customer_demands", "distance")


def die(msg: str) -> None:
    print(f"dump_chens.py: {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Dump Chen's Cosmetics get_data() as JSON")
    parser.add_argument("--notebook", required=True, help="path to 'ChensCosmeticsV1 Step 3.ipynb'")
    args = parser.parse_args()

    try:
        with open(args.notebook, "r", encoding="utf-8") as fh:
            nb = json.load(fh)
    except FileNotFoundError:
        die(f"notebook not found: {args.notebook}")
    except OSError as exc:
        die(f"cannot read notebook {args.notebook}: {exc}")
    except json.JSONDecodeError as exc:
        die(f"notebook is not valid JSON ({args.notebook}): {exc}")

    # Find the code cell that defines get_data().
    src = None
    for cell in nb.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        text = "".join(cell.get("source", []))
        if "def get_data" in text:
            src = text
            break
    if src is None:
        die("no code cell defining `def get_data` found in notebook")

    try:
        module = ast.parse(src)
    except SyntaxError as exc:
        die(f"could not parse get_data cell: {exc}")

    func = next(
        (n for n in ast.walk(module)
         if isinstance(n, ast.FunctionDef) and n.name == "get_data"),
        None,
    )
    if func is None:
        die("parsed cell but found no `get_data` function definition")

    # `distance` is assigned TWICE in get_data(): first a raw-km dict literal,
    # then reassigned to a `{... * 1.17 ...}` comprehension applying the circuity
    # factor. Per D8 we store RAW km (×1.17 lives in the solver), so we take only
    # dict-LITERAL assignments and keep the FIRST occurrence per name — which
    # naturally selects the raw distance and skips every DictComp reassignment.
    values = {}
    for node in func.body:
        if not isinstance(node, ast.Assign):
            continue
        if not isinstance(node.value, ast.Dict):
            continue
        for target in node.targets:
            if (
                isinstance(target, ast.Name)
                and target.id in WANTED
                and target.id not in values
            ):
                try:
                    values[target.id] = ast.literal_eval(node.value)
                except (ValueError, SyntaxError) as exc:
                    die(f"could not literal-eval `{target.id}`: {exc}")

    missing = [k for k in WANTED if k not in values]
    if missing:
        die(f"get_data() is missing expected assignments: {', '.join(missing)}")

    # JSON-serialise. warehouses/customers keys are ints -> stringify; distance
    # keys are (w, c) int tuples -> "w,c" strings.
    def keyed(d):
        return {str(k): v for k, v in d.items()}

    distance = {f"{w},{c}": km for (w, c), km in values["distance"].items()}

    out = {
        "warehouses": keyed(values["warehouses"]),
        "customers": keyed(values["customers"]),
        "customer_demands": keyed(values["customer_demands"]),
        "distance": distance,
    }
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
