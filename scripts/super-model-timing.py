#!/usr/bin/env python3
"""Timed CBC run of solve_super at the D1 size caps. Usage: [warehouses customers]
(default 50 200 = 100,000 W*C*K with 10 products; 50 100 = 50,000). 20 plants,
10 products, p=10. Seeded, so reruns solve the same network. Prints status,
runTimeSec, achievedGap."""
import os, random, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "artifacts", "api-server", "src", "solver"))
from solve import solve_super

NP, NK = 20, 10
NW, NC = (int(a) for a in sys.argv[1:3]) if len(sys.argv) > 2 else (50, 200)
random.seed(1)
pt = lambda: {"lat": random.uniform(25, 49), "lng": random.uniform(-124, -67)}
products = [{"id": f"k{i}", "name": f"k{i}"} for i in range(NK)]
demand = [{"customerId": f"c{i}", "productId": k["id"], "demand": random.randint(1, 100)}
          for i in range(NC) for k in products]
cap = 2 * sum(d["demand"] for d in demand) / NP
inp = {
    "p": 10, "gap": 0.01, "timeLimitSec": 120, "distanceMethod": "haversine", "circuityFactor": 1.17,
    "transportCosts": {"icTransCost": 0.07, "icMinTrans": 10, "obTransCost": 0.12, "obMinTrans": 10},
    "products": products,
    "plants": [{"id": f"p{i}", "name": f"p{i}", **pt()} for i in range(NP)],
    "warehouses": [{"id": f"w{i}", "name": f"w{i}", "status": "active", **pt()} for i in range(NW)],
    "customers": [{"id": f"c{i}", "name": f"c{i}", "status": "active", **pt()} for i in range(NC)],
    "plantProducts": [{"plantId": f"p{i}", "productId": k["id"], "capacity": cap, "costPerUnit": 0}
                      for i in range(NP) for k in products],
    "demand": demand, "distanceOverrides": [],
}
r = solve_super(inp)
print(f"status={r['status']} termination={r['terminationReason']} "
      f"runTimeSec={r['runTimeSec']} achievedGap={r['achievedGap']}")
