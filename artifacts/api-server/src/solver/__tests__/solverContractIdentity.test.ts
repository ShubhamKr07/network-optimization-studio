// A6 (SCND Correctness) — deliberately real/unmocked, mirroring
// recoveryContractIdentity.test.ts's own convention: this module's whole
// job is to prove the composite manifest+version hash is a real,
// deterministic combination of A1's real (unmocked) artifact hashing, so
// mocking anything here would test nothing real.
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { computeRecoveryContractIdentity } from "../recoveryContractIdentity.js";
import { computeSolverContractIdentity, SOLVER_CONTRACT_VERSION } from "../solverContractIdentity.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const SOLVER_DIR = path.join(REPO_ROOT, "artifacts", "api-server", "src", "solver");

const REAL_PATHS = {
  solvePyPath: path.join(SOLVER_DIR, "solve.py"),
  cbcTerminationPyPath: path.join(SOLVER_DIR, "cbc_termination.py"),
  resultEnvelopeTsPath: path.join(SOLVER_DIR, "resultEnvelope.ts"),
  solverProcessMessageTsPath: path.join(SOLVER_DIR, "solverProcessMessage.ts"),
};

describe("SOLVER_CONTRACT_VERSION", () => {
  it("starts at 1", () => {
    expect(SOLVER_CONTRACT_VERSION).toBe(1);
  });

  it("is a positive integer", () => {
    expect(Number.isInteger(SOLVER_CONTRACT_VERSION)).toBe(true);
    expect(SOLVER_CONTRACT_VERSION).toBeGreaterThan(0);
  });
});

describe("computeSolverContractIdentity", () => {
  it("returns a full, untruncated 64-hex-character sha256 digest", () => {
    const identity = computeSolverContractIdentity(REAL_PATHS);
    expect(identity).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across repeated calls against the same real artifacts", () => {
    const a = computeSolverContractIdentity(REAL_PATHS);
    const b = computeSolverContractIdentity(REAL_PATHS);
    expect(a).toBe(b);
  });

  // "One manifest, two consumers, two different final hashes" — the
  // composite identity must never accidentally equal A1's own recovery
  // identity (that would mean the SOLVER_CONTRACT_VERSION component wasn't
  // actually folded in).
  it("differs from A1's own RECOVERY_CONTRACT_IDENTITY for the same real artifacts", () => {
    const recovery = computeRecoveryContractIdentity(REAL_PATHS);
    const composite = computeSolverContractIdentity(REAL_PATHS);
    expect(composite).not.toBe(recovery);
  });

  // Fail-closed: this wrapper introduces no new failure mode — it inherits
  // computeRecoveryContractIdentity's own fail-closed behavior for an
  // unreadable source artifact (real fs.readFileSync failure, no mocking).
  it("fails closed (throws) when a required source artifact does not exist", () => {
    expect(() =>
      computeSolverContractIdentity({
        ...REAL_PATHS,
        solvePyPath: path.join(SOLVER_DIR, "does-not-exist-solve.py"),
      }),
    ).toThrow(/could not read required artifact/);
  });

  it("fails closed when the PuLP/CBC runtime probe cannot be spawned", () => {
    expect(() =>
      computeSolverContractIdentity({
        ...REAL_PATHS,
        pythonBin: "/definitely/not/a/real/python3/binary/xyz",
      }),
    ).toThrow(/RECOVERY_CONTRACT_IDENTITY/);
  });

  // Component sensitivity #1 — a change in any underlying recovery-identity
  // component (proven here via a throwaway temp file standing in for the
  // real resultEnvelope.ts path, matching recoveryContractIdentity.test.ts's
  // own pattern) changes the composite identity too — the version component
  // doesn't shadow or dampen sensitivity to the base manifest.
  it("changes when a single underlying recovery-manifest component's bytes change", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "solver-contract-identity-test-"));
    const fakeEnvelopePath = path.join(tmpDir, "resultEnvelope.ts");
    try {
      writeFileSync(fakeEnvelopePath, "export const A = 1;\n");
      const before = computeSolverContractIdentity({ ...REAL_PATHS, resultEnvelopeTsPath: fakeEnvelopePath });

      writeFileSync(fakeEnvelopePath, "export const A = 2;\n");
      const after = computeSolverContractIdentity({ ...REAL_PATHS, resultEnvelopeTsPath: fakeEnvelopePath });

      expect(before).not.toBe(after);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Component sensitivity #2 — parser-only change (resultEnvelope.ts OR
  // solverProcessMessage.ts) invalidates the composite identity even though
  // solve.py itself is untouched. This is the EXACT drift the G-cache
  // artifact's "What A6 changes" section names (B1, f215832, was a
  // parser-only change) — the old SOLVER_CODE_HASH-only cache key could
  // never detect this; the composite identity must.
  it("changes when solverProcessMessage.ts changes even though solve.py is untouched (the documented parser-drift case)", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "solver-contract-identity-parser-test-"));
    const fakeMessagePath = path.join(tmpDir, "solverProcessMessage.ts");
    try {
      writeFileSync(fakeMessagePath, "export const PARSER_VERSION = 1;\n");
      const before = computeSolverContractIdentity({ ...REAL_PATHS, solverProcessMessageTsPath: fakeMessagePath });

      writeFileSync(fakeMessagePath, "export const PARSER_VERSION = 2;\n");
      const after = computeSolverContractIdentity({ ...REAL_PATHS, solverProcessMessageTsPath: fakeMessagePath });

      expect(before).not.toBe(after);
      // solve.py itself was never touched in either call above — proving
      // the invalidation came purely from the parser component.
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Component sensitivity #3 — SOLVER_CONTRACT_VERSION itself. A bump
  // invalidates the whole cache by construction, per the G-cache artifact's
  // Decision 2, EVEN WITH EVERY OTHER COMPONENT (solve.py, cbc_termination.py,
  // parsers, dataset, PuLP, CBC) held byte-identical — proven here via the
  // test-only version-override parameter rather than mutating the exported
  // constant.
  it("changes when SOLVER_CONTRACT_VERSION bumps, with every other component held identical", () => {
    const v1 = computeSolverContractIdentity(REAL_PATHS, 1);
    const v2 = computeSolverContractIdentity(REAL_PATHS, 2);
    expect(v1).not.toBe(v2);
  });

  it("defaults to the real exported SOLVER_CONTRACT_VERSION when no override is given", () => {
    expect(computeSolverContractIdentity(REAL_PATHS)).toBe(computeSolverContractIdentity(REAL_PATHS, SOLVER_CONTRACT_VERSION));
  });

  // Stability — the converse of the bump test: the SAME version (and every
  // other component identical) must always produce the SAME key, not just
  // "a different key on a version change."
  it("is stable across repeated calls at a fixed version override", () => {
    const a = computeSolverContractIdentity(REAL_PATHS, 7);
    const b = computeSolverContractIdentity(REAL_PATHS, 7);
    expect(a).toBe(b);
  });

  // Sortedness/order-insensitivity is inherited from computeRecoveryContractIdentity
  // (already proven directly in recoveryContractIdentity.test.ts) — reconfirmed
  // here at this module's own boundary since it's the thing jobRunner.ts
  // actually calls.
  it("is insensitive to the caller's key ordering in the inputs object", () => {
    const reordered: typeof REAL_PATHS = {
      solverProcessMessageTsPath: REAL_PATHS.solverProcessMessageTsPath,
      resultEnvelopeTsPath: REAL_PATHS.resultEnvelopeTsPath,
      cbcTerminationPyPath: REAL_PATHS.cbcTerminationPyPath,
      solvePyPath: REAL_PATHS.solvePyPath,
    };
    expect(computeSolverContractIdentity(reordered)).toBe(computeSolverContractIdentity(REAL_PATHS));
  });
});
