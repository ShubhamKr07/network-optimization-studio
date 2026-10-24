#!/usr/bin/env python3
"""Build artifacts/studio/public/samples/super-model-sample.json from the Ch9
JADE dataset: e2e_accuracy's Notebook scenario_1 (p=2, wh-11 + wh-14 forced
open), costPerUnit 0, every JADE distance as an override. Solving it must
reproduce 254060828.6157 (tests/test_super.py)."""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DS = os.path.join(ROOT, "solvers", "two-echelon-jade-us", "dataset")
OUT = os.path.join(ROOT, "artifacts", "studio", "public", "samples", "super-model-sample.json")
load = lambda f: json.load(open(os.path.join(DS, f)))
plants, wh, cust, prods = load("plants.json"), load("warehouses.json"), load("customers.json"), load("products.json")
loc = lambda r: {"id": r["id"], "city": r["city"], "state": r["state"], "lat": r["lat"], "lng": r["lng"]}
dist = load("distances.json")
pairs = [(p, w) for p in plants for w in wh] + [(w, c) for w in wh for c in cust]
missing = [f"{a},{b}" for a, b in pairs if f"{a},{b}" not in dist]
assert not missing, f"JADE matrix missing pairs: {missing[:5]}"
doc = {
    "p": 2, "gap": 0, "timeLimitSec": 120, "distanceMethod": "haversine", "circuityFactor": 1.17,
    "transportCosts": {"icTransCost": 0.07, "icMinTrans": 10, "obTransCost": 0.12, "obMinTrans": 10},
    "products": [{"id": k, "name": v["name"]} for k, v in prods.items()],
    "plants": [loc(r) for r in plants.values()],
    "warehouses": [{**loc(r), "status": "forced_open" if r["id"] in ("wh-11", "wh-14") else "active"} for r in wh.values()],
    "customers": [{**loc(r), "status": "active"} for r in cust.values()],
    "plantProducts": [{"plantId": r["plantId"], "productId": r["productId"], "capacity": r["capacity"], "costPerUnit": 0}
                      for r in load("plant_product_capability.json")],
    "demand": [{"customerId": c["id"], "productId": k, "demand": v}
               for c in cust.values() for k, v in c["demands"].items()],
    "distanceOverrides": [{"fromId": a, "toId": b, "miles": dist[f"{a},{b}"]} for a, b in pairs],
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(doc, open(OUT, "w"), indent=1)
print(f"wrote {OUT}: {len(doc['customers'])} customers, {len(doc['distanceOverrides'])} overrides")
