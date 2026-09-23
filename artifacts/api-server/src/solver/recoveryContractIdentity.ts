import { readFileSync } from "fs";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { PACKAGE_SPECS, computeSha256, readVersion } from "@workspace/dataset-schema";

// A1 (SCND Correctness) — RECOVERY_CONTRACT_IDENTITY (§2.10/§34, Q73-Q84,
// review A-R40/A-R49). NOT the same thing as jobRunner.ts's
// `SOLVER_CODE_HASH`: that hashes only solve.py, truncated to 12 hex
// characters, and exists purely as the (unchanged, until A6) result-cache
// key. This module computes a SEPARATE, FULLER identity whose only job is
// recovery correctness — "can a row queued under one runtime generation be
// safely executed/claimed under a DIFFERENT one" — covering every
// semantics-bearing artifact:
//   - solve.py, cbc_termination.py (Python solve/termination-classification
//     logic)
//   - the Node result parser/schema modules (resultEnvelope.ts,
//     solverProcessMessage.ts)
//   - every model package's dataset bytes + version.json (via
//     @workspace/dataset-schema's own PACKAGE_SPECS/computeSha256/readVersion
//     — the same primitives jobRunner.ts's computeInputsHash already uses)
//   - PuLP's installed version
//   - a RUNTIME-DERIVED CBC build identity (the actual CBC binary PuLP will
//     invoke, hashed — not just "the pinned version string", since P0R.1
//     found the real CBC build differs by architecture even under an
//     identical PuLP version, e.g. 2.10.3 x64 vs 2.10.10 linux/arm64)
//
// Manifest shape: a SORTED, LENGTH-FRAMED list of {name, value} components,
// hashed to a FULL, UNTRUNCATED sha256 hex digest (64 characters) — never
// truncated, unlike SOLVER_CODE_HASH. Length-framing (rather than a plain
// joined string) means no delimiter collision between any two components'
// names/values can ever produce identical framed bytes for two logically
// different manifests.
//
// Fail-closed (never defaulted/skipped): every step here either succeeds or
// throws. jobRunner.ts calls this ONCE, eagerly, at module load — mirroring
// SOLVER_CODE_HASH's own top-level pattern — so an underivable component
// (a missing artifact, or a PuLP/CBC runtime probe that fails) crashes that
// module's import, and therefore server boot (jobRunner.ts is imported
// synchronously during app wiring), rather than silently persisting jobs
// under an unknown/absent identity.
//
// Scope (decided, A-R49): this identity governs RECOVERY only (A2 recomputes
// + compares it at claim time). The solve-result CACHE key is UNCHANGED and
// stays on SOLVER_CODE_HASH until A6 adopts this same manifest as the cache
// key per §2.10 — this module changes zero cache hit rates and zero compute
// on its own.

export interface RecoveryComponent {
  name: string;
  value: string;
}

export interface RecoveryIdentityInputs {
  solvePyPath: string;
  cbcTerminationPyPath: string;
  resultEnvelopeTsPath: string;
  solverProcessMessageTsPath: string;
  /** Overridable for tests only — real code always uses "python3". */
  pythonBin?: string;
}

function sha256File(filePath: string): string {
  let bytes: Buffer;
  try {
    bytes = readFileSync(filePath);
  } catch (err) {
    throw new Error(
      `RECOVERY_CONTRACT_IDENTITY: could not read required artifact "${filePath}" (fail-closed): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

interface PulpCbcProbeResult {
  pulpVersion: string;
  cbcPath: string;
}

// A single-line Python probe: import pulp, report its version and the real
// path to the CBC executable PULP_CBC_CMD will actually invoke on THIS
// instance. Run via spawnSync (never spawn) — this is a one-shot boot-time
// probe, not a request-path call (the "no blocking spawnSync on the request
// path" rule this codebase otherwise holds to, per CLAUDE.md's G3.1 gotcha,
// does not apply here).
const PULP_CBC_PROBE_SCRIPT =
  "import json,sys\n" +
  "try:\n" +
  "    import pulp\n" +
  "    solver = pulp.PULP_CBC_CMD()\n" +
  "    print(json.dumps({'pulpVersion': pulp.__version__, 'cbcPath': solver.path}))\n" +
  "except Exception as e:\n" +
  "    print(json.dumps({'error': str(e)}))\n" +
  "    sys.exit(1)\n";

function probePulpAndCbc(pythonBin: string): PulpCbcProbeResult {
  const result = spawnSync(pythonBin, ["-c", PULP_CBC_PROBE_SCRIPT], { encoding: "utf8" });

  if (result.error) {
    throw new Error(
      `RECOVERY_CONTRACT_IDENTITY: failed to spawn "${pythonBin}" to probe PuLP/CBC (fail-closed): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `RECOVERY_CONTRACT_IDENTITY: PuLP/CBC probe exited ${result.status} (fail-closed): ${
        (result.stderr || result.stdout || "").trim()
      }`,
    );
  }

  let parsed: { pulpVersion?: unknown; cbcPath?: unknown; error?: unknown };
  try {
    parsed = JSON.parse((result.stdout ?? "").trim());
  } catch (err) {
    throw new Error(
      `RECOVERY_CONTRACT_IDENTITY: unparseable PuLP/CBC probe output (fail-closed): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (typeof parsed.pulpVersion !== "string" || typeof parsed.cbcPath !== "string") {
    throw new Error(
      `RECOVERY_CONTRACT_IDENTITY: PuLP/CBC probe did not report a version + executable path (fail-closed): ${
        typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed)
      }`,
    );
  }
  return { pulpVersion: parsed.pulpVersion, cbcPath: parsed.cbcPath };
}

function datasetComponents(): RecoveryComponent[] {
  return PACKAGE_SPECS.map((spec) => ({
    name: `dataset:${spec.modelId}`,
    value: `${computeSha256(spec)}:${readVersion(spec.modelId).version}`,
  }));
}

// Sorted + length-framed byte manifest -> ready to hash. Sorting first
// means component insertion order never affects the result; length-framing
// each name/value pair means no separator-collision ambiguity.
function frameComponents(components: RecoveryComponent[]): Buffer {
  const sorted = [...components].sort((a, b) => a.name.localeCompare(b.name));
  const parts: Buffer[] = [];
  for (const { name, value } of sorted) {
    const nameBuf = Buffer.from(name, "utf8");
    const valueBuf = Buffer.from(value, "utf8");
    parts.push(Buffer.from(`${nameBuf.length}:`, "utf8"));
    parts.push(nameBuf);
    parts.push(Buffer.from(`${valueBuf.length}:`, "utf8"));
    parts.push(valueBuf);
  }
  return Buffer.concat(parts);
}

/**
 * Computes the full RECOVERY_CONTRACT_IDENTITY manifest hash. Pure given its
 * inputs (no caching) — callers that want a "computed once at boot" constant
 * should call this exactly once and hold the result, matching
 * jobRunner.ts's SOLVER_CODE_HASH pattern.
 */
export function computeRecoveryContractIdentity(inputs: RecoveryIdentityInputs): string {
  const { pulpVersion, cbcPath } = probePulpAndCbc(inputs.pythonBin ?? "python3");

  const components: RecoveryComponent[] = [
    { name: "solve.py", value: sha256File(inputs.solvePyPath) },
    { name: "cbc_termination.py", value: sha256File(inputs.cbcTerminationPyPath) },
    { name: "resultEnvelope.ts", value: sha256File(inputs.resultEnvelopeTsPath) },
    { name: "solverProcessMessage.ts", value: sha256File(inputs.solverProcessMessageTsPath) },
    { name: "pulpVersion", value: pulpVersion },
    { name: "cbcBuildIdentity", value: sha256File(cbcPath) },
    ...datasetComponents(),
  ];

  return crypto.createHash("sha256").update(frameComponents(components)).digest("hex");
}
