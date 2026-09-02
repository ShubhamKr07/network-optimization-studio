import { describe, it, expect } from "vitest";
import {
  WAREHOUSE_ROLE,
  CUSTOMER_ROLE,
  MINE_ROLE,
  STATION_ROLE,
  REFINERY_ROLE,
  type EntityRoleConfig,
} from "@/components/workspace/map/types";

// T8 (Bundle 2.2, A3) — `EntityRoleConfig.supportsExclusion` is a SEPARATE
// semantic flag from `hasStatus` (facility open/close status). Optional,
// default false: every role other than CUSTOMER_ROLE must resolve to
// `false` (either explicitly unset, or explicitly `false`) so a new role
// added later can never accidentally acquire Active/Excluded just by
// omitting the field.
const ALL_ROLES: { name: string; role: EntityRoleConfig; expectSupportsExclusion: boolean }[] = [
  { name: "WAREHOUSE_ROLE", role: WAREHOUSE_ROLE, expectSupportsExclusion: false },
  { name: "CUSTOMER_ROLE", role: CUSTOMER_ROLE, expectSupportsExclusion: true },
  { name: "MINE_ROLE", role: MINE_ROLE, expectSupportsExclusion: false },
  { name: "STATION_ROLE", role: STATION_ROLE, expectSupportsExclusion: false },
  { name: "REFINERY_ROLE", role: REFINERY_ROLE, expectSupportsExclusion: false },
];

describe("EntityRoleConfig.supportsExclusion (T8, Bundle 2.2, A3)", () => {
  it.each(ALL_ROLES)("$name resolves supportsExclusion=$expectSupportsExclusion (default false)", ({ role, expectSupportsExclusion }) => {
    expect(role.supportsExclusion ?? false).toBe(expectSupportsExclusion);
  });

  it("only CUSTOMER_ROLE is true — every other role is falsy", () => {
    const trueRoles = ALL_ROLES.filter(r => (r.role.supportsExclusion ?? false) === true).map(r => r.name);
    expect(trueRoles).toEqual(["CUSTOMER_ROLE"]);
  });

  it("supportsExclusion is distinct from hasStatus — CUSTOMER_ROLE/STATION_ROLE both have hasStatus:false, but only CUSTOMER_ROLE supports exclusion", () => {
    expect(CUSTOMER_ROLE.hasStatus).toBe(false);
    expect(STATION_ROLE.hasStatus).toBe(false);
    expect(CUSTOMER_ROLE.supportsExclusion).toBe(true);
    expect(STATION_ROLE.supportsExclusion ?? false).toBe(false);
  });
});
