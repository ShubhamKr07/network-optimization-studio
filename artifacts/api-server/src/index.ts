import "./instrument"; // MUST be first — instruments modules imported below
import * as Sentry from "@sentry/node";
import app from "./app";
import { logger } from "./lib/logger";
import {
  initDispatcherForBoot,
  scheduleLegacyCleanupAfterDrainGate,
  drainForShutdown,
  parsePositiveIntEnv,
} from "./solver/jobRunner.js";
import { posthog } from "./lib/posthog.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// A2 (SCND Correctness) — Phase 1 boot recovery: pre-listen, NO gate. Reads
// this process generation's claim_generation once from the durable Postgres
// sequence, runs the first recurring-dispatcher-scan iteration over
// non-legacy queued rows, and starts the recurring scheduler. Postgres
// unreachable here THROWS (propagated, never swallowed) — since this runs
// before app.listen, an unreachable DB makes boot FAIL CLOSED: the process
// never starts serving with no dispatcher running.
//
// This replaces the old reapStuckJobs()-before-listen, which used to mark
// EVERY "running" row failed unconditionally — on Render's zero-downtime
// rolling deploys (no disk attached, render.yaml) the booting instance used
// to fail the STILL-LIVE old instance's in-flight solves (plan A2; review
// A-R17/A-R26 — a live defect in every deploy before this change).
//
// Fail-closed boots MUST say why in the captured (pino/stdout) log stream:
// an uncaught rejection from this top-level await prints only to stderr,
// which some platforms (Render) drop from their queryable log stream, so a
// crashed boot shows up as a silent "exited early" with no cause. Log the
// full error via pino first, then re-fail closed.
try {
  await initDispatcherForBoot();
} catch (err) {
  logger.error({ err }, "[boot] initDispatcherForBoot failed — boot aborting (fail-closed)");
  await Sentry.close(2000).catch(() => {});
  process.exit(1);
}

// A2 — Phase 2: asynchronous, one-shot, off the request path. Null-lease/
// historical-row cleanup is scheduled to run once 180s (A14a's shutdown
// budget + margin) have elapsed since THIS process's own boot — the
// earliest safe proxy for "the prior revision has had the platform's
// drain window." Readiness (app.listen below) never waits on this.
scheduleLegacyCleanupAfterDrainGate();

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// A2 — SIGTERM/SIGINT drain (replaces the old immediate process.exit(0),
// which orphaned CBC children and stranded process-local queued jobs on
// every deploy). Allocation mirrors A14's stated shutdown budget: an
// in-flight-solve grace period, then A3's whole-process-group cancel
// (TERM->KILL) plus a bounded wait for verified group death. Env-overridable
// only for test speed — production always uses these defaults.
const DEFAULT_DRAIN_GRACE_MS = 60_000;
const DRAIN_GRACE_MS = parsePositiveIntEnv(process.env.SOLVE_DRAIN_GRACE_MS, DEFAULT_DRAIN_GRACE_MS);
const DEFAULT_FORCE_DRAIN_GRACE_MS = 15_000;
const FORCE_DRAIN_GRACE_MS = parsePositiveIntEnv(process.env.SOLVE_FORCE_DRAIN_GRACE_MS, DEFAULT_FORCE_DRAIN_GRACE_MS);

let shuttingDown = false;

async function shutdown(source: "sigterm" | "sigint"): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  // Stop admitting new inbound connections — existing in-flight requests
  // are allowed to finish; no new ones are accepted.
  server.close();

  // Stop claiming new work + stop the recurring scan, wait for in-flight
  // solves to finish naturally (their own owner-heartbeat loops keep
  // renewing the lease throughout) or force-cancel via A3's supervisor.
  await drainForShutdown(source, { graceMs: DRAIN_GRACE_MS, forceGraceMs: FORCE_DRAIN_GRACE_MS });

  // Flush any queued PostHog events and Sentry errors before the process
  // exits so they are not lost.
  await posthog?.shutdown();
  await Sentry.close(2000);
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("sigterm");
});
process.on("SIGINT", () => {
  void shutdown("sigint");
});
