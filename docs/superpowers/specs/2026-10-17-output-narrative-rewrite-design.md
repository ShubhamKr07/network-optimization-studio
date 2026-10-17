# Output Map narrative rewrite — design (quick-fixes)

Supersedes the SCU-1.9 narrative text (`artifacts/studio/src/lib/resultNarrative.ts`). Presentation only: no solver, server, OpenAPI or schema change — every number below is already in the solve envelope.

## User-locked decisions (2026-10-17)

1. **Wording per objective.** Ch 3 (`p-median-us`) and Ch 4's min-distance step use the user's example as written. Ch 4's coverage step: "These N sites put X% of your demand within D, the most any N sites can cover", then the average and farthest-customer sentences.
2. **Band sentence = the distance band holding the LARGEST share of demand** (user, 2026-10-17, superseding the earlier "smallest non-zero band" rule). Computed from the same exclusive rows Service Stats shows (`computeExclusiveBandCoverage` over the active band lens, so it follows band edits), including the overflow row. Ties go to the lowest band (same rule as the residual). Phrase: "The largest share of your demand, 35%, is 400–800 miles away" / overflow: "…is more than 1,600 miles away". Two-echelon: outbound (warehouse/refinery → customer) leg only. **Exception:** Ch 4's coverage step keeps its objective sentence — "These N sites put X% of your demand within D (high-service distance), the most any N sites can cover" — and has no separate band sentence. Because the largest band always holds demand, the "0% band" fallback is moot.
3. **Old content replaced entirely** — the "Objective: … solved in Xs" line, the every-band list and the "How to read this map" paragraph are removed.
4. **Names: always `City, ST`** (city names are not unique in the datasets).
5. **Numbers:** distances whole with grouping, unit-aware (`1,139 miles` / `1,833 km`); money in $M to 1 dp (`$191.2M`; under $1M → `$812K`); per-ton cost whole dollars (`$124`); percentages whole, except `delivery-teaching-us` at 2 dp (matches Service Stats).
6. **Other five models** (Ch 3 p-median-us, Ch 5 transport-coal, Ch 5 Brazil, Ch 5 delivery, Ch 10 gold-au): example paragraph drafted from a real local solve and approved by the user before coding.
7. **Extras, all four:** name the farthest customer (`City, ST`); compare to the previous run when the result history has one; plain wording for failed / time-limited runs (no status codes); a one-clause tie-in to what the model optimised.
8. **2–3 sentences; every number matches the Service Stats / Solution Summary tabs** (same source field; display rounding only). Two-echelon may run to 4 (user's Ch 9 example). Extras are folded into existing sentences, not appended.

9. **Brazil regions (user, 2026-10-17):** a region is named by region only, dropping " Region" and the state code — "the farthest region, Acre, is 1,699 miles away" (the live identity renders "Acre Region, AC"). Warehouses stay "City, ST".
10. **Brazil infeasible, single-source capacity (user, 2026-10-17):** "No plan meets these settings: São Paulo needs 29M units, more than any single warehouse can supply (20M). Turn Single-source off so its demand can be split between warehouses." Built from the known solve.py message shape; any other infeasibility reason is quoted verbatim.
11. **Ch 4 coverage compare (user, 2026-10-17):** the "points more/less" parenthetical appears only when the previous coverage run used the same high-service distance, and compares the displayed whole percentages.

## User's reference examples

- Ch 4 (min-distance / Ch 3): "Open Baltimore, Dallas and Los Angeles. A typical unit ships about 383 miles from the warehouse to the customer, and these three sites give the shortest overall shipping distance of any three. About 56% of your demand is within 400 miles, and the farthest customer is 1,139 miles away."
- Ch 9: "Open Louisville, Nassau-Suffolk and Phoenix. The total transportation cost is $191.2M, about $124 per ton. Roughly $103.5M of that is plant-to-warehouse and $87.8M is warehouse-to-customer. Outbound, customers are 470 miles from their warehouse on average, 52% are within 400 miles, and the farthest is 1,315 miles away."

## Source fields (solve.py envelope)

Open sites: `details.openWarehouseIds` / `metrics.openFacilityIds` → city/state via the dataset. Average: `metrics.weightedAvgDistance` (two-echelon outbound: `metrics.avgDistanceByLeg[warehouse_to_customer]`). Within-D %: live `computeExclusiveBandCoverage` cumulative up to D (Ch 4 coverage: `details.coveragePct`). Farthest: max-distance service edge. Ch 9 cost: `objective`, `metrics.inboundCost`, `metrics.outboundCost`, per ton = objective / `metrics.totalDemand`.

## Open items

- Drafts for all seven models approved by the user 2026-10-17, with the band-sentence change in decision 2. Approved wording (numbers are from default-input local solves, `scratchpad/narrative-data/SUMMARY.md`; the band clause is shown in the approved new form):
  - Ch 3 p-median-us: "Open Baltimore, MD, Dallas, TX and Los Angeles, CA. A typical unit ships about 383 miles from the warehouse to the customer, and these three sites give the shortest overall shipping distance of any three. The largest share of your demand, 35%, is 400–800 miles away, and the farthest customer, Seattle, WA, is 1,139 miles away."
  - Ch 4 coverage: "Open Dallas, TX, Los Angeles, CA and Pittsburgh, PA. These three sites put 70% of your demand within 450 miles, the most any three sites can cover. A typical unit ships about 395 miles, and the farthest customer, Miami, FL, is 1,197 miles away."
  - Ch 4 min-distance: same template as Ch 3.
  - Ch 5 transport-coal: "Coal ships from all four mines, Pikeville, KY, Rock Springs, WY, Clarion, PA and Council Bluffs, IA, each at full capacity, to 15 power stations. A typical ton travels about 562 miles, the fewest total ton-miles that meet every station's demand. The largest share of the coal, N%, moves A–B miles, and the longest lane, Council Bluffs, IA to Phoenix, AZ, is 1,304 miles." ("each at full capacity" only when every used mine is at 100% utilization; "all four" only when every mine ships.)
  - Ch 5 Brazil infeasible: "No plan meets these settings: <infeasibilityReason, plain>." Feasible: "Open seven warehouses: <City, ST list>. A typical unit ships about 184 miles, the shortest overall shipping distance of any seven. <largest band>, and the farthest region, Acre, is 1,699 miles away."
  - Ch 5 delivery: "Open Los Angeles, CA, New York, NY and Louisville, KY. A typical delivery travels about 423 miles, and these three sites give the shortest overall delivery distance of any three. <largest band, 2 dp>, and the farthest customer, McAllen, TX, is 1,301 miles away." (cost_adjusted mode: "the lowest overall delivery cost" instead.)
  - Ch 9 JADE: "Open Baltimore, MD, Las Vegas, NV and Louisville, KY. The total transportation cost is $182.0M, about $118 per ton, the lowest possible with three warehouses. Roughly $101.5M of that is plant-to-warehouse and $80.5M is warehouse-to-customer. Outbound, customers are 431 miles from their warehouse on average, the largest share (N%) is A–B miles away, and the farthest, McAllen, TX, is 1,301 miles away."
  - Ch 10 gold-au: "Refine at Cunnamulla, QLD; Daggar Hills stays closed. Ore travels about 1,465 miles from the Kalgoorlie, WA mine to the refinery, and gold about 688 miles on to customers, the fewest truckload-miles possible. <largest outbound band>, and the farthest customer, Cairns, QLD, is 909 miles away."
  - Compare to last run (when the result history has an earlier solve of the same objective): a parenthetical on the headline number — "(41 miles shorter than your previous run)" / Ch 9 "($6.3M less than your previous run)" / Ch 4 coverage "(3 points more than your previous run)".
  - Failed / no-incumbent runs: plain sentence, no status codes ("The solver stopped at its time limit before finding a plan." / "No plan meets these settings: …").
- Pre-existing, flagged to the user, not in scope: p-median-brazil's default inputs (Single-source on, 20M capacity) are infeasible.
- "Compare to last run" needs the previous result from the result-history stepper; data path to be confirmed.
