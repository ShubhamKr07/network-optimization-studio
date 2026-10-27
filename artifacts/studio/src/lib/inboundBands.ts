import {
  MINE_ROLE, REFINERY_ROLE, PLANT_ROLE, JADE_WAREHOUSE_ROLE, CUSTOMER_ROLE,
} from "@/components/workspace/map/types";

/** DU-4.1 (Q3) — a model offers a second, inbound band editor exactly when its
 *  manifest declares the optional key (lib/integerDemand.ts precedent). */
export function hasInboundBands(inputsSchema: Record<string, unknown> | undefined): boolean {
  return (inputsSchema as { properties?: Record<string, unknown> } | undefined)?.properties?.inboundDistanceBands != null;
}

/** DU-4.1 (Q2) — the two editors' labels, role words from the map's EntityRoleConfig
 *  (same gold-vs-jade ternary OutputMapTab uses for the narrative's source role). */
export function bandLaneLabels(modelId: string): { outbound: string; inbound: string } {
  const gold = modelId === "two-echelon-gold-au";
  const source = gold ? MINE_ROLE.label : PLANT_ROLE.label;
  const facility = gold ? REFINERY_ROLE.label : JADE_WAREHOUSE_ROLE.label;
  return {
    outbound: `Customer-facing lanes (${facility} → ${CUSTOMER_ROLE.label})`,
    inbound: `Inbound lanes (${source} → ${facility})`,
  };
}
