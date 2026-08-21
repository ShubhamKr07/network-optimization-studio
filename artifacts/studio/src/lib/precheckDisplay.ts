// SCN v0.3 Phase B, task B5.2 — parses B2.1's precheck error messages
// (services/precheck.ts's `PrecheckResult.errors`, free-text `message` by
// design — see openapi.yaml's `PrecheckError` schema) to drive per-row
// warning chips on newly-added warehouses/customers in WarehousesTab.tsx/
// CustomersTab.tsx, without needing a structured per-id response shape from
// the server. This is a NICE-TO-HAVE early warning only — B2.1's own
// endpoint (called again, fresh, on Solve) remains the authoritative gate;
// nothing here blocks anything.
//
// The message formats parsed below are exactly precheck.ts's own literal
// template strings:
//   completeness:   `${whId} missing distances to ${n} customer(s): ${csv}`
//   id_collision:   `Added warehouse id '${id}' ...` / `Added customer id '${id}' ...`
// If precheck.ts's wording ever changes, these parsers silently stop
// matching (return null/0) rather than throwing — same "degrade quietly"
// posture as every other precheck-adjacent client-side helper in this repo.

export interface PrecheckErrorLike {
  code: string;
  message: string;
}

/**
 * How many customers a given (base or added) warehouse is missing a
 * distance to, per B2.1's completeness check — null when there's no
 * completeness finding for this id at all (as opposed to 0, which
 * precheck.ts never actually emits — it only ever reports non-empty
 * "missing" lists).
 */
export function completenessCountForWarehouse(
  errors: readonly PrecheckErrorLike[],
  warehouseId: string,
): number | null {
  const prefix = `${warehouseId} missing distances to `;
  const hit = errors.find((e) => e.code === "completeness" && e.message.startsWith(prefix));
  if (!hit) return null;
  const match = hit.message.match(/^\S+ missing distances to (\d+) customer/);
  return match ? Number(match[1]) : null;
}

/**
 * How many DIFFERENT warehouses are missing a route to this customer — the
 * reverse direction of completenessCountForWarehouse. Unlike the
 * warehouse-side lookup (one message per warehouse, exact prefix match), a
 * given customer id can appear in the trailing "missing" list of several
 * different warehouses' messages, so this counts occurrences across all of
 * them rather than matching a single message.
 */
export function completenessCountForCustomer(
  errors: readonly PrecheckErrorLike[],
  customerId: string,
): number {
  let count = 0;
  for (const e of errors) {
    if (e.code !== "completeness") continue;
    const idx = e.message.indexOf(": ");
    if (idx === -1) continue;
    const ids = e.message
      .slice(idx + 2)
      .split(",")
      .map((s) => s.trim());
    if (ids.includes(customerId)) count += 1;
  }
  return count;
}

/** The full id_collision message for this added warehouse id, or null. */
export function idCollisionMessageForWarehouse(
  errors: readonly PrecheckErrorLike[],
  warehouseId: string,
): string | null {
  const needle = `Added warehouse id '${warehouseId}'`;
  const hit = errors.find((e) => e.code === "id_collision" && e.message.includes(needle));
  return hit ? hit.message : null;
}

/** The full id_collision message for this added customer id, or null. */
export function idCollisionMessageForCustomer(
  errors: readonly PrecheckErrorLike[],
  customerId: string,
): string | null {
  const needle = `Added customer id '${customerId}'`;
  const hit = errors.find((e) => e.code === "id_collision" && e.message.includes(needle));
  return hit ? hit.message : null;
}
