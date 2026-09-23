// A3 — the no-orphan proof. Deliberately does NOT mock child_process (unlike
// jobRunner.test.ts / jobRunnerConcurrency.test.ts) — every spawn() call
// here is the REAL Node child_process.spawn against REAL OS processes, and
// jobRunner.ts's process-group kill helpers (killProcessGroup/
// isProcessGroupAlive/terminateProcessGroup) are imported unmocked too. This
// is what actually exercises real PGIDs/signals, not a simulation of them.
//
// `@workspace/db`'s module throws at import time if DATABASE_URL is unset —
// jobRunner.ts imports it. Run this file with a real DATABASE_URL in the
// environment (same as any other api-server test needing a live DB, e.g.
// `DATABASE_URL=postgresql://... pnpm --filter api-server exec vitest run
// src/__tests__/noOrphanProof.test.ts`) — `pg.Pool` never actually issues a
// query in this file (only the process-group helpers are exercised), but a
// STATIC import (below) is hoisted by ES modules above any top-of-file
// `process.env` assignment, so a dummy value set here would arrive too late
// to matter; a real DATABASE_URL supplied by the invoking command is the
// only reliable way to satisfy the module-load-time check.

import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { killProcessGroup, isProcessGroupAlive, terminateProcessGroup } from "../solver/jobRunner.js";

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Spawns a detached bash whose direct child forks a background `sleep`
// grandchild WITHIN THE SAME process group (bash doesn't setsid its own
// background job) — mirrors solve.py spawning CBC as a subprocess from
// inside itself. Returns the group's pid (===bash's own pid, the group
// leader) and the grandchild's real pid, read back over stderr once bash
// has actually forked it.
async function spawnGroupWithGrandchild(): Promise<{ pgid: number; grandchildPid: number }> {
  const child = spawn(
    "bash",
    ["-c", "sleep 60 & child_pid=$!; echo $child_pid >&2; wait $child_pid"],
    { detached: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  const pgid = child.pid;
  if (!pgid) throw new Error("spawn failed to report a pid");

  let stderrBuf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
  });

  const deadline = Date.now() + 5000;
  let grandchildPid = 0;
  while (!grandchildPid && Date.now() < deadline) {
    const match = stderrBuf.match(/(\d+)/);
    if (match) grandchildPid = Number(match[1]);
    else await new Promise((r) => setTimeout(r, 20));
  }
  if (!grandchildPid) throw new Error("never observed the grandchild pid over stderr");
  return { pgid, grandchildPid };
}

describe("A3 — no-orphan proof (real OS process groups, POSIX-only)", () => {
  it("killProcessGroup(SIGKILL) + confirmed death leaves NO survivor — neither the direct child nor its grandchild", async () => {
    const { pgid, grandchildPid } = await spawnGroupWithGrandchild();

    // Both are alive before we touch anything.
    expect(isPidAlive(pgid)).toBe(true);
    expect(isPidAlive(grandchildPid)).toBe(true);
    expect(isProcessGroupAlive(pgid)).toBe(true);

    killProcessGroup(pgid, "SIGKILL");
    const died = await waitFor(() => !isProcessGroupAlive(pgid), 3000);
    expect(died).toBe(true);

    // No survivor process anywhere in the group — this is the actual
    // no-orphan claim, proven against real PIDs, not asserted by
    // construction.
    expect(isPidAlive(pgid)).toBe(false);
    expect(isPidAlive(grandchildPid)).toBe(false);
  }, 15000);

  it("terminateProcessGroup()'s TERM->KILL sequence also leaves no survivor (the real path runJob uses)", async () => {
    const { pgid, grandchildPid } = await spawnGroupWithGrandchild();

    await terminateProcessGroup(pgid);

    expect(isProcessGroupAlive(pgid)).toBe(false);
    expect(isPidAlive(pgid)).toBe(false);
    expect(isPidAlive(grandchildPid)).toBe(false);
  }, 15000);

  it("killing only the DIRECT child (not the group) leaves the grandchild orphaned — the exact risk group-kill closes", async () => {
    const { pgid, grandchildPid } = await spawnGroupWithGrandchild();

    // Positive pid = signal exactly ONE process (bash itself), simulating
    // the pre-A3 child.kill() behavior — proves the risk is real, not
    // hypothetical, before proving terminateProcessGroup() actually closes
    // it (the prior two tests).
    process.kill(pgid, "SIGKILL");
    const bashDied = await waitFor(() => !isPidAlive(pgid), 2000);
    expect(bashDied).toBe(true);

    // The grandchild is now re-parented (orphaned) and STILL RUNNING.
    await new Promise((r) => setTimeout(r, 200));
    expect(isPidAlive(grandchildPid)).toBe(true);

    // Clean up for real — this test's own responsibility, not part of the
    // claim under test.
    process.kill(grandchildPid, "SIGKILL");
    await waitFor(() => !isPidAlive(grandchildPid), 2000);
  }, 15000);

  it("repeated timeouts are leak-free — three consecutive group-kills, zero accumulating survivors", async () => {
    const grandchildPids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { pgid, grandchildPid } = await spawnGroupWithGrandchild();
      grandchildPids.push(grandchildPid);
      await terminateProcessGroup(pgid);
      expect(isProcessGroupAlive(pgid)).toBe(false);
    }
    for (const pid of grandchildPids) {
      expect(isPidAlive(pid)).toBe(false);
    }
  }, 30000);
});

async function waitFor(predicate: () => boolean, maxWaitMs: number): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return predicate();
}
