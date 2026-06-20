---
name: P-Median solver utilization computation
description: How warehouse utilization % is computed to stay meaningful even without a binding capacity constraint
---

# Utilization computation rule

`capacityForUtil = uniformCapacity if (uniformCapacity != null && uniformCapacity < TOTAL_DEMAND) else (TOTAL_DEMAND / numOpenWarehouses)`

**Why:** Default seed capacity (50M) is far larger than synthetic total demand (~250K). Using raw uniformCapacity gives 0% utilization. Using avgDemandPerWH gives 70-100% which is meaningful for students.

**How to apply:** In `artifacts/api-server/src/solver/pmedian.ts`, utilization row near end of `solve()` function. Cap at 100% with `Math.min(100, ...)`.
