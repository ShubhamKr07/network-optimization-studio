// A1 (SCND Correctness) — deliberately real/unmocked (matches
// jobRunnerRealIntegration.test.ts's convention for anything that shells
// out to a real python3): this module's whole job is to prove real
// artifacts hash deterministically and that an underivable component fails
// closed, so mocking child_process/fs here would test nothing real.
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { computeRecoveryContractIdentity } from "../recoveryContractIdentity.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const SOLVER_DIR = path.join(REPO_ROOT, "artifacts", "api-server", "src", "solver");

const REAL_PATHS = {
  solvePyPath: path.join(SOLVER_DIR, "solve.py"),
  cbcTerminationPyPath: path.join(SOLVER_DIR, "cbc_termination.py"),
  resultEnvelopeTsPath: path.join(SOLVER_DIR, "resultEnvelope.ts"),
  solverProcessMessageTsPath: path.join(SOLVER_DIR, "solverProcessMessage.ts"),
};

describe("computeRecoveryContractIdentity", () => {
  it("returns a full, untruncated 64-hex-character sha256 digest", () => {
    const identity = computeRecoveryContractIdentity(REAL_PATHS);
    expect(identity).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across repeated calls against the same real artifacts", () => {
    const a = computeRecoveryContractIdentity(REAL_PATHS);
    const b = computeRecoveryContractIdentity(REAL_PATHS);
    expect(a).toBe(b);
  });

  // Fail-closed proof #1: a missing/underivable SOURCE artifact (real
  // fs.readFileSync failure, no mocking needed).
  it("fails closed (throws) when a required source artifact does not exist", () => {
    expect(() =>
      computeRecoveryContractIdentity({
        ...REAL_PATHS,
        solvePyPath: path.join(SOLVER_DIR, "does-not-exist-solve.py"),
      }),
    ).toThrow(/could not read required artifact/);
  });

  it("fails closed when cbc_termination.py is missing", () => {
    expect(() =>
      computeRecoveryContractIdentity({
        ...REAL_PATHS,
        cbcTerminationPyPath: path.join(SOLVER_DIR, "does-not-exist-cbc.py"),
      }),
    ).toThrow(/could not read required artifact/);
  });

  it("fails closed when the Node parser/schema modules are missing", () => {
    expect(() =>
      computeRecoveryContractIdentity({
        ...REAL_PATHS,
        resultEnvelopeTsPath: path.join(SOLVER_DIR, "does-not-exist-envelope.ts"),
      }),
    ).toThrow(/could not read required artifact/);
    expect(() =>
      computeRecoveryContractIdentity({
        ...REAL_PATHS,
        solverProcessMessageTsPath: path.join(SOLVER_DIR, "does-not-exist-message.ts"),
      }),
    ).toThrow(/could not read required artifact/);
  });

  // Fail-closed proof #2: an underivable RUNTIME component (the PuLP/CBC
  // probe itself fails to spawn) — a real spawnSync call against a
  // deliberately nonexistent binary, no child_process mocking.
  it("fails closed when the python3 binary used for the PuLP/CBC probe cannot be spawned", () => {
    expect(() =>
      computeRecoveryContractIdentity({
        ...REAL_PATHS,
        pythonBin: "/definitely/not/a/real/python3/binary/xyz",
      }),
    ).toThrow(/RECOVERY_CONTRACT_IDENTITY/);
  });

  // Component sensitivity: changing ANY ONE semantics-bearing artifact's
  // bytes must change the manifest hash. Proven here for the Node-side
  // component (mutating a real file mid-test is safe for the .ts sources
  // via a throwaway temp copy standing in for the real path — never mutate
  // the actual repo file).
  it("changes when a single component's bytes change (component sensitivity)", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "recovery-identity-test-"));
    const fakeEnvelopePath = path.join(tmpDir, "resultEnvelope.ts");
    try {
      writeFileSync(fakeEnvelopePath, "export const A = 1;\n");
      const before = computeRecoveryContractIdentity({ ...REAL_PATHS, resultEnvelopeTsPath: fakeEnvelopePath });

      writeFileSync(fakeEnvelopePath, "export const A = 2;\n");
      const after = computeRecoveryContractIdentity({ ...REAL_PATHS, resultEnvelopeTsPath: fakeEnvelopePath });

      expect(before).not.toBe(after);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Sortedness: component insertion order must not matter — proven here by
  // observing that the SAME set of real artifacts (order is fixed inside
  // the function, not caller-controlled) always yields the same digest
  // across two structurally-identical-but-freshly-constructed input objects.
  it("is insensitive to the caller's key ordering in the inputs object", () => {
    const reordered: typeof REAL_PATHS = {
      solverProcessMessageTsPath: REAL_PATHS.solverProcessMessageTsPath,
      resultEnvelopeTsPath: REAL_PATHS.resultEnvelopeTsPath,
      cbcTerminationPyPath: REAL_PATHS.cbcTerminationPyPath,
      solvePyPath: REAL_PATHS.solvePyPath,
    };
    expect(computeRecoveryContractIdentity(reordered)).toBe(computeRecoveryContractIdentity(REAL_PATHS));
  });
});
