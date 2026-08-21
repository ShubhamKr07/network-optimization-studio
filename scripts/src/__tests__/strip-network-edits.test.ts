import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  pool: { end: vi.fn() },
  scenariosTable: { id: "id", userId: "user_id", modelId: "model_id", inputs: "inputs", inputsUpdatedAt: "inputs_updated_at" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ col, vals })),
}));

// Chainable drizzle mock — same pattern as artifacts/api-server's
// routes.test.ts. `.select()...where()` resolves to `rows`; `.update()...where()`
// resolves once `set`/`where` are chained (result value is irrelevant here).
function makeChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "update", "set"].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(returnValue).then(resolve);
  return chain;
}

import { run, hasNetworkEdits, stripNetworkEdits, NETWORK_EDIT_KEYS } from "../strip-network-edits.js";

const OLD_SCENARIO = {
  id: 1,
  userId: "user-a",
  modelId: "p-median-us",
  inputs: { p: 3, capacityMode: "none", distanceBands: [200, 400], gap: 0, timeLimitSec: 60 },
};

const EDITED_SCENARIO = {
  id: 2,
  userId: "user-a",
  modelId: "p-median-us",
  inputs: {
    p: 3,
    capacityMode: "none",
    distanceBands: [200, 400],
    gap: 0,
    timeLimitSec: 60,
    addedWarehouses: [{ id: "WH-NEW", city: "Reno", state: "NV", lat: 1, lng: 2, status: "active" }],
    addedCustomers: [{ id: "CUST-NEW", city: "Fresno", lat: 3, lng: 4, demand: 100 }],
    distanceOverrides: [{ fromId: "A", toId: "B", distance: 50 }],
  },
};

const PARTIALLY_EDITED_SCENARIO = {
  id: 3,
  userId: "user-b",
  modelId: "p-median-us",
  inputs: {
    p: 4,
    capacityMode: "none",
    distanceBands: [200, 400],
    gap: 0,
    timeLimitSec: 60,
    distanceOverrides: [{ fromId: "X", toId: "Y", distance: 10 }],
  },
};

describe("strip-network-edits — pure helpers", () => {
  it("hasNetworkEdits is false for an old scenario with none of the three keys", () => {
    expect(hasNetworkEdits(OLD_SCENARIO.inputs)).toBe(false);
  });

  it("hasNetworkEdits is true when at least one of the three keys is present", () => {
    expect(hasNetworkEdits(PARTIALLY_EDITED_SCENARIO.inputs)).toBe(true);
  });

  it("stripNetworkEdits removes exactly the three keys and preserves everything else", () => {
    const stripped = stripNetworkEdits(EDITED_SCENARIO.inputs);
    for (const key of NETWORK_EDIT_KEYS) {
      expect(stripped).not.toHaveProperty(key);
    }
    expect(stripped).toMatchObject({ p: 3, capacityMode: "none", distanceBands: [200, 400], gap: 0, timeLimitSec: 60 });
  });

  it("stripNetworkEdits is a no-op (returns an equivalent object) on inputs with none of the keys", () => {
    const stripped = stripNetworkEdits(OLD_SCENARIO.inputs);
    expect(stripped).toEqual(OLD_SCENARIO.inputs);
  });
});

describe("strip-network-edits — run()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("--dry-run reports the affected count without writing", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([OLD_SCENARIO, EDITED_SCENARIO, PARTIALLY_EDITED_SCENARIO]));

    const summary = await run({ dryRun: true });

    expect(summary.affectedCount).toBe(2);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("dry-run count is broken down per user/model", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([EDITED_SCENARIO, PARTIALLY_EDITED_SCENARIO]));

    const summary = await run({ dryRun: true });

    expect(summary.byUserModel.get("user-a / p-median-us")).toBe(1);
    expect(summary.byUserModel.get("user-b / p-median-us")).toBe(1);
  });

  it("a real run strips the three keys and bumps inputsUpdatedAt only for affected scenarios", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([OLD_SCENARIO, EDITED_SCENARIO, PARTIALLY_EDITED_SCENARIO]));
    const updateChain = makeChain(undefined);
    mockDb.update.mockReturnValue(updateChain);

    const summary = await run({ dryRun: false });

    expect(summary.affectedCount).toBe(2);
    // Exactly 2 update calls — one per affected scenario, none for OLD_SCENARIO.
    expect(mockDb.update).toHaveBeenCalledTimes(2);
    const setCalls = (updateChain.set as ReturnType<typeof vi.fn>).mock.calls;
    expect(setCalls).toHaveLength(2);
    for (const [payload] of setCalls) {
      for (const key of NETWORK_EDIT_KEYS) {
        expect(payload.inputs).not.toHaveProperty(key);
      }
      expect(payload.inputsUpdatedAt).toBeInstanceOf(Date);
    }
  });

  it("a scenario with none of the three keys is untouched (no update call for it)", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([OLD_SCENARIO]));

    await run({ dryRun: false });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("running twice is a no-op the second time (idempotent)", async () => {
    // First run: EDITED_SCENARIO gets stripped.
    mockDb.select.mockReturnValueOnce(makeChain([EDITED_SCENARIO]));
    const updateChain = makeChain(undefined);
    mockDb.update.mockReturnValue(updateChain);
    const first = await run({ dryRun: false });
    expect(first.affectedCount).toBe(1);

    // Second run: simulate the DB now reflecting the stripped result — the
    // row's `inputs` no longer has any of the three keys.
    vi.clearAllMocks();
    const strippedRow = { ...EDITED_SCENARIO, inputs: stripNetworkEdits(EDITED_SCENARIO.inputs) };
    mockDb.select.mockReturnValueOnce(makeChain([strippedRow]));

    const second = await run({ dryRun: false });

    expect(second.affectedCount).toBe(0);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
