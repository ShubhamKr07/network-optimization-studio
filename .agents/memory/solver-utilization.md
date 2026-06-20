---
name: P-Median solver utilization computation
description: How warehouse utilization % is computed to stay meaningful even without a binding capacity constraint
---

# Utilization computation rule

When capacity is non-binding (uniformCapacity far exceeds total demand), use TOTAL_DEMAND divided by the number of open warehouses as the denominator. This gives 70-100% utilization for balanced networks instead of near-0%.

**Why:** Default seed capacity is far larger than synthetic total demand. Students would see 0% utilization for every warehouse, making the metric meaningless.

**How to apply:** In the solver's utilization section, check if uniformCapacity < TOTAL_DEMAND before using it as the denominator. Fall back to avgDemandPerWH = TOTAL_DEMAND / numOpenWarehouses. Cap at 100%.

# Frontend display note

Utilization values returned from the API are already integers in the range 0-100 (percent). Do NOT multiply by 100 again when displaying in the UI — this is an easy mistake to make since some fractional metrics use the 0.0-1.0 convention.
