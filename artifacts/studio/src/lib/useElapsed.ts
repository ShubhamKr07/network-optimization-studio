import { useEffect, useMemo, useState } from "react";

// jade B9 — spec §9 (Requirement #8, running solve clock). Distinguishes
// **queued** time (queuedAt→startedAt) from **active solving** time
// (startedAt→now) using the timestamps already present on the polled
// `GET solve-job` response (`SolveJob.queuedAt`/`startedAt`/`finishedAt`,
// `SolveJobStatus`), ticking ~1s while the job is `queued`/`running` and
// freezing once it reaches a terminal state (`succeeded`/`failed`) — an
// infeasible result still arrives as `status:"succeeded"` (the solver never
// throws), so "terminal" is a job-lifecycle concept, not an
// optimal/infeasible one.
//
// All four inputs are OPTIONAL and default to `undefined` — with no
// `queuedAt`, the hook returns `label: null` so the caller renders nothing
// timing-related (Studio/Workspace call sites that never pass these props are
// unaffected).

export type ElapsedJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface UseElapsedOptions {
  queuedAt?: Date | string | number | null;
  startedAt?: Date | string | number | null;
  finishedAt?: Date | string | number | null;
  status?: ElapsedJobStatus;
}

export interface UseElapsedResult {
  /** `"Queued Xs"` before `startedAt` is known, `"Queued Xs · Solving Ys"`
   * once it is. `null` when there's nothing to time (`queuedAt` absent). */
  label: string | null;
  queuedSec: number | null;
  /** `null` until `startedAt` is present. */
  activeSec: number | null;
  /** `true` once `status` is a terminal state — the displayed numbers are
   * frozen (the tick interval has stopped). */
  frozen: boolean;
}

const TICK_MS = 1000;

function toMs(value: Date | string | number | null | undefined): number | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function elapsedSec(fromMs: number, toMsValue: number): number {
  return Math.max(0, Math.round((toMsValue - fromMs) / 1000));
}

export function useElapsed({ queuedAt, startedAt, finishedAt, status }: UseElapsedOptions): UseElapsedResult {
  const isTerminal = status === "succeeded" || status === "failed";
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second while the job is still queued/running. Stops
  // (no-op) once terminal — the values are frozen at whatever `finishedAt`
  // (or the last tick, if `finishedAt` hasn't arrived yet) computed.
  useEffect(() => {
    if (isTerminal) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [isTerminal]);

  return useMemo(() => {
    const queuedMs = toMs(queuedAt);
    if (queuedMs == null) {
      return { label: null, queuedSec: null, activeSec: null, frozen: isTerminal };
    }

    const startedMs = toMs(startedAt);
    const finishedMs = toMs(finishedAt);
    const endMs = isTerminal ? finishedMs ?? now : now;

    if (startedMs == null) {
      const queuedSec = elapsedSec(queuedMs, endMs);
      return { label: `Queued ${queuedSec}s`, queuedSec, activeSec: null, frozen: isTerminal };
    }

    const queuedSec = elapsedSec(queuedMs, startedMs);
    const activeSec = elapsedSec(startedMs, endMs);
    return {
      label: `Queued ${queuedSec}s · Solving ${activeSec}s`,
      queuedSec,
      activeSec,
      frozen: isTerminal,
    };
  }, [queuedAt, startedAt, finishedAt, isTerminal, now]);
}
