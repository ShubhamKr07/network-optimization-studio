import { join } from "node:path";
import { appendRow } from "../harness/lib/csv.js";
import { metricsDir } from "../harness/lib/derive.js";
import type { Check, CheckResult, SmokeEnv } from "./checks/types.js";
import { freeTierWakeup } from "./checks/freeTierWakeup.js";
import { corsPreflight } from "./checks/corsPreflight.js";
import { postgresTls } from "./checks/postgresTls.js";
import { viteEnvBaked } from "./checks/viteEnvBaked.js";
import { cookieAttributes } from "./checks/cookieAttributes.js";
import { fetchCredentials } from "./checks/fetchCredentials.js";
import { pythonSolverPresent } from "./checks/pythonSolverPresent.js";

export const DEPLOYS_HEADER = ["deployed_at", "service", "sha", "smoke_pass", "failed_checks", "incident", "notes"];

// Current operational defaults — NOT canonical project state. Documented in docs/ops/smoke.md;
// override with --api-base/--studio-base flags or NOS_API_BASE/NOS_STUDIO_BASE env.
const DEFAULTS = {
  production: { apiBase: "https://nos-api-uwf8.onrender.com", studioBase: "https://nos-studio.onrender.com" },
  preview: { apiBase: "https://nos-api-uwf8.onrender.com", studioBase: "https://nos-studio.onrender.com" },
};

export interface SmokeArgs {
  env: "production" | "preview";
  apiBase?: string;
  studioBase?: string;
}

export function parseSmokeArgs(argv: string[]): SmokeArgs {
  const a: SmokeArgs = { env: "production" };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--env": {
        const v = next();
        if (v === "production" || v === "preview") a.env = v;
        break;
      }
      case "--api-base": a.apiBase = next(); break;
      case "--studio-base": a.studioBase = next(); break;
    }
  }
  return a;
}

/** Resolve targets: flags → env vars → live fallback default. */
export function resolveEnv(args: SmokeArgs, envVars: NodeJS.ProcessEnv = process.env): SmokeEnv {
  const d = DEFAULTS[args.env];
  return {
    apiBase: (args.apiBase ?? envVars.NOS_API_BASE ?? d.apiBase).replace(/\/+$/, ""),
    studioBase: (args.studioBase ?? envVars.NOS_STUDIO_BASE ?? d.studioBase).replace(/\/+$/, ""),
  };
}

/** Which service each check exercises (for the per-service deploys.csv rows). */
const SERVICE_OF: Record<string, "nos-api" | "nos-studio"> = {
  free_tier_wakeup: "nos-api",
  cors_preflight: "nos-api",
  postgres_tls: "nos-api",
  cookie_attributes: "nos-api",
  fetch_credentials: "nos-api",
  python_solver_present: "nos-api",
  vite_env_baked: "nos-studio",
};

export interface ServiceRollup {
  service: string;
  smokePass: boolean;
  failedChecks: string[];
}

/** Group results by service; a service passes iff no hard failure (warn is not a failure). */
export function rollupByService(results: CheckResult[]): ServiceRollup[] {
  const map = new Map<string, ServiceRollup>();
  for (const r of results) {
    const service = SERVICE_OF[r.name] ?? "nos-api";
    const entry = map.get(service) ?? { service, smokePass: true, failedChecks: [] };
    const hardFail = !r.pass && !r.warn;
    if (hardFail) {
      entry.smokePass = false;
      entry.failedChecks.push(r.name);
    }
    map.set(service, entry);
  }
  return [...map.values()];
}

export function formatResults(results: CheckResult[]): string {
  return results
    .map((r) => {
      const tag = r.pass ? "PASS" : r.warn ? "WARN" : "FAIL";
      return `  [${tag}] ${r.name} (${r.ms}ms) — ${r.detail}`;
    })
    .join("\n");
}

const ORDERED_CHECKS: Check[] = [
  freeTierWakeup,
  corsPreflight,
  postgresTls,
  viteEnvBaked,
  cookieAttributes, // captures the session cookie
  fetchCredentials, // uses it
  pythonSolverPresent, // uses it
];

async function main() {
  const args = parseSmokeArgs(process.argv.slice(2));
  const env = resolveEnv(args);
  const ctx = { fetch: globalThis.fetch, cookieJar: { value: null as string | null } };
  process.stdout.write(`smoke: env=${args.env} api=${env.apiBase} studio=${env.studioBase}\n`);

  const results: CheckResult[] = [];
  for (const check of ORDERED_CHECKS) {
    try {
      results.push(await check(env, ctx));
    } catch (e) {
      results.push({ name: check.name || "unknown", pass: false, ms: 0, detail: `threw: ${(e as Error).message}` });
    }
  }

  process.stdout.write(formatResults(results) + "\n");

  const deployedAt = new Date().toISOString();
  const rollups = rollupByService(results);
  const file = join(metricsDir(), "deploys.csv");
  for (const r of rollups) {
    appendRow(file, DEPLOYS_HEADER, {
      deployed_at: deployedAt,
      service: r.service,
      sha: "unknown",
      smoke_pass: r.smokePass ? "yes" : "no",
      failed_checks: r.failedChecks.join(";"),
      incident: "",
      notes: results.filter((x) => x.warn).map((x) => `${x.name}:${x.detail}`).join(" | "),
    });
  }

  const anyHardFail = results.some((r) => !r.pass && !r.warn);
  process.stdout.write(`\nsmoke: ${anyHardFail ? "FAIL" : "PASS"} (${results.filter((r) => r.pass).length}/${results.length} checks passed)\n`);
  process.exit(anyHardFail ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
