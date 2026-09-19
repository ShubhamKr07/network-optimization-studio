import { describe, it, expect } from "vitest";
import { parseLedger, correlate, promotableCommands, type LedgerEvent } from "../harness/lib/permissionLedger.js";

function line(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}

function prompted(toolUseId: string, at: string, command: string, permissionMode = "default", sessionId = "s1"): string {
  return line({ at, sessionId, toolUseId, event: "prompted", command, permissionMode });
}

function executed(toolUseId: string, at: string, permissionMode = "default", sessionId = "s1"): string {
  return line({ at, sessionId, toolUseId, event: "executed", permissionMode });
}

describe("parseLedger", () => {
  it("parses prompted and executed lines", () => {
    const jsonl = [prompted("t1", "2026-09-14T10:00:00.000Z", "git push origin main"), executed("t1", "2026-09-14T10:00:01.000Z")].join(
      "\n",
    );
    const events = parseLedger(jsonl);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("prompted");
    expect(events[0].command).toBe("git push origin main");
    expect(events[1].event).toBe("executed");
    expect(events[1].command).toBeUndefined();
  });

  it("skips malformed / unrecognized lines without throwing", () => {
    const jsonl = ["not json", line({ event: "something_else" }), prompted("t1", "2026-09-14T10:00:00.000Z", "ls")].join("\n");
    const events = parseLedger(jsonl);
    expect(events).toHaveLength(1);
    expect(events[0].toolUseId).toBe("t1");
  });

  it("filters by window", () => {
    const jsonl = [
      prompted("t1", "2026-09-10T00:00:00.000Z", "a"),
      prompted("t2", "2026-09-14T10:00:00.000Z", "b"),
    ].join("\n");
    const events = parseLedger(jsonl, { start: "2026-09-14T00:00:00.000Z", end: "2026-09-15T00:00:00.000Z" });
    expect(events).toHaveLength(1);
    expect(events[0].toolUseId).toBe("t2");
  });

  it("returns [] for empty input", () => {
    expect(parseLedger("")).toEqual([]);
  });
});

describe("correlate — provenance matrix (T0-confirmed)", () => {
  it("prompted + executed (non-bypass) -> prompted_and_executed", () => {
    const events = parseLedger(
      [prompted("t1", "2026-09-14T10:00:00.000Z", "git log -1"), executed("t1", "2026-09-14T10:00:01.000Z")].join("\n"),
    );
    const records = correlate(events);
    expect(records).toHaveLength(1);
    expect(records[0].provenance).toBe("prompted_and_executed");
    expect(records[0].command).toBe("git log -1");
    expect(records[0].commandDigest).toHaveLength(64);
  });

  it("prompted only (no executed) -> prompted_and_denied", () => {
    const events = parseLedger([prompted("t1", "2026-09-14T10:00:00.000Z", "git push --force")].join("\n"));
    const records = correlate(events);
    expect(records).toHaveLength(1);
    expect(records[0].provenance).toBe("prompted_and_denied");
    expect(records[0].command).toBe("git push --force");
  });

  it("executed only (no prompted) -> auto_no_prompt", () => {
    const events = parseLedger([executed("t1", "2026-09-14T10:00:01.000Z")].join("\n"));
    const records = correlate(events);
    expect(records).toHaveLength(1);
    expect(records[0].provenance).toBe("auto_no_prompt");
    // No PermissionRequest ever fired for this tool_use_id, so the full command was never
    // captured by either hook -- there is genuinely nothing to recover here.
    expect(records[0].command).toBe("");
  });

  it("bypassPermissions mode -> bypass, even if both events are present", () => {
    const events = parseLedger(
      [
        prompted("t1", "2026-09-14T10:00:00.000Z", "rm -rf /tmp/x", "bypassPermissions"),
        executed("t1", "2026-09-14T10:00:01.000Z", "bypassPermissions"),
      ].join("\n"),
    );
    const records = correlate(events);
    expect(records[0].provenance).toBe("bypass");
  });

  it("an event with no toolUseId cannot be correlated -> unknown", () => {
    const events: LedgerEvent[] = [
      { at: "2026-09-14T10:00:00.000Z", sessionId: "s1", toolUseId: "", event: "prompted", command: "x", permissionMode: "default" },
    ];
    const records = correlate(events);
    expect(records).toHaveLength(1);
    expect(records[0].provenance).toBe("unknown");
  });

  it("dedupes: two identical prompted+executed pairs for the same toolUseId still yield ONE record", () => {
    const events = parseLedger(
      [
        prompted("t1", "2026-09-14T10:00:00.000Z", "git log -1"),
        prompted("t1", "2026-09-14T10:00:00.500Z", "git log -1"), // duplicate hook fire
        executed("t1", "2026-09-14T10:00:01.000Z"),
        executed("t1", "2026-09-14T10:00:01.500Z"), // duplicate hook fire
      ].join("\n"),
    );
    const records = correlate(events);
    expect(records).toHaveLength(1);
    expect(records[0].provenance).toBe("prompted_and_executed");
  });

  it("correlates multiple distinct toolUseIds independently", () => {
    const events = parseLedger(
      [
        prompted("t1", "2026-09-14T10:00:00.000Z", "git log -1"),
        executed("t1", "2026-09-14T10:00:01.000Z"),
        prompted("t2", "2026-09-14T10:05:00.000Z", "git push --force"),
      ].join("\n"),
    );
    const records = correlate(events);
    expect(records).toHaveLength(2);
    const byId = Object.fromEntries(records.map((r) => [r.toolUseId, r]));
    expect(byId["t1"].provenance).toBe("prompted_and_executed");
    expect(byId["t2"].provenance).toBe("prompted_and_denied");
  });
});

describe("promotableCommands", () => {
  it("returns only prompted_and_executed records, with the full command retained", () => {
    const events = parseLedger(
      [
        prompted("t1", "2026-09-14T10:00:00.000Z", "git log -1"),
        executed("t1", "2026-09-14T10:00:01.000Z"),
        prompted("t2", "2026-09-14T10:05:00.000Z", "git push --force"),
        executed("t3", "2026-09-14T10:06:00.000Z"),
      ].join("\n"),
    );
    const records = correlate(events);
    const promotable = promotableCommands(records);
    expect(promotable).toHaveLength(1);
    expect(promotable[0].toolUseId).toBe("t1");
    expect(promotable[0].command).toBe("git log -1");
  });
});
