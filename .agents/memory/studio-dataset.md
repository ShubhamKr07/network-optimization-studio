---
name: Network Studio dataset — Al's Athletics notebook data
description: The warehouse candidates, customers, and distances embedded in the app
---

# Data source

All data extracted from Chapter_3_Network_Design_Book notebook, function `get_data()`.

# Warehouses (26 cities → string IDs)

Notebook numeric ID → string ID mapping:
1:ALN, 2:ATL, 3:BAL, 4:BOS, 5:CHI, 6:CIN, 7:CMH, 8:DAL, 9:DEN, 10:IND,
11:JAX, 12:KC, 13:LV, 14:LA, 15:MEM, 16:MSP, 17:NSH, 18:MSY, 19:PHX, 20:PIT,
21:RDU, 22:RNO, 23:SFO, 24:SEA, 25:STL, 26:LBB

Warehouse 26 (LBB) = "Lubbock - Current WH" — represents the student's existing warehouse in the case study.

# Customers (200 real US cities)

IDs: C1 (Akron) through C200 (Yonkers). All have real population-based demand values (e.g., C121 New York = 8,459,026).

# Distance table

5200 pre-computed road/airline distances (warehouse numeric ID, customer numeric ID) → integer miles.
Embedded as JSON in solve.py. Not computed from haversine — these are the case study distances.

# Total demand

~78 million units (sum of all 200 customer demands).

# Seed scenarios

IDs 4/5/6: P=2 (557.3mi, CIN+LA), P=3 (382.9mi, BAL+DAL+LA), P=4 (310.1mi, ALN+DAL+IND+LA).
