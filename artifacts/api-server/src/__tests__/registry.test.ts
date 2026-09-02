import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import express from "express";
import { SOLVERS_ROOT } from "@workspace/dataset-schema";
import request from "supertest";
import modelsRouter from "../routes/models.js";
import { listModels, getManifest, validateInputs } from "../registry/modelRegistry.js";

// A minimal standalone app for the /api/models route — avoids pulling in
// the full app.ts (and therefore @workspace/db, which needs DATABASE_URL)
// for a route that has no DB dependency at all.
const testApp = express();
testApp.use("/api", modelsRouter);

describe("modelRegistry", () => {
  it("listModels() returns the four known models", () => {
    const ids = listModels().map(m => m.id).sort();
    expect(ids).toEqual(["p-median-brazil", "p-median-us", "transport-coal", "two-echelon-gold-au"]);
  });

  it("omits datasetDir (server-internal) from the public listing", () => {
    const model = listModels().find(m => m.id === "p-median-us")!;
    expect(model).not.toHaveProperty("datasetDir");
  });

  it("getManifest returns undefined for an unknown model", () => {
    expect(getManifest("nonexistent-model")).toBeUndefined();
  });

  it("validateInputs still validates p-median-us inputs correctly", () => {
    const result = validateInputs("p-median-us", {
      p: 3, capacityMode: "none", distanceBands: [200], gap: 0, timeLimitSec: 120,
    });
    expect(result.success).toBe(true);
  });
});

describe("GET /api/models", () => {
  it("returns 200 with the four known models, unauthenticated", async () => {
    const res = await request(testApp).get("/api/models");
    expect(res.status).toBe(200);
    const ids = res.body.map((m: { id: string }) => m.id).sort();
    expect(ids).toEqual(["p-median-brazil", "p-median-us", "transport-coal", "two-echelon-gold-au"]);
  });

  // R5 (Workspace UX bundle) — every model must always report a
  // distanceUnit, defaulting absent manifests to "mi" at the public
  // boundary. Bundle 2 (B2-T1) relabels two-echelon-gold-au "km" -> "mi":
  // its base numbers are geographically miles (the source notebook's own
  // mislabel), zero data/objective change.
  it("returns the correct distanceUnit per model", () => {
    const byId: Record<string, string> = Object.fromEntries(
      listModels().map(m => [m.id, m.distanceUnit]),
    );
    expect(byId["p-median-us"]).toBe("mi");
    expect(byId["p-median-brazil"]).toBe("mi");
    expect(byId["transport-coal"]).toBe("mi");
    expect(byId["two-echelon-gold-au"]).toBe("mi");
  });

  // Bundle 2 (B2-T1) — supportsFacilityStatus gates R3 (status paint) and
  // R7 (hide-closed) capability-driven, never on modelId.
  it("returns the correct supportsFacilityStatus per model", () => {
    const byId: Record<string, boolean> = Object.fromEntries(
      listModels().map(m => [m.id, m.capabilities.supportsFacilityStatus]),
    );
    expect(byId["p-median-us"]).toBe(true);
    expect(byId["p-median-brazil"]).toBe(true);
    expect(byId["two-echelon-gold-au"]).toBe(true);
    expect(byId["transport-coal"]).toBe(false);
  });

  // Bundle 2.2 (B2.2-T2) — supportsReferenceDistances gates the
  // reference-distances endpoint/UI, never modelId directly. Only
  // p-median-us today.
  it("returns the correct supportsReferenceDistances per model", () => {
    const byId: Record<string, boolean> = Object.fromEntries(
      listModels().map(m => [m.id, m.capabilities.supportsReferenceDistances]),
    );
    expect(byId["p-median-us"]).toBe(true);
    expect(byId["p-median-brazil"]).toBe(false);
    expect(byId["two-echelon-gold-au"]).toBe(false);
    expect(byId["transport-coal"]).toBe(false);
  });

  // Bundle 2.2 (B2.2-T2) — supportsAddedCustomerExclusion gates A3's
  // added-customer Active/Excluded control + solve payload/precheck
  // exclusion, never modelId directly. p-median-brazil is explicitly false
  // (its solver applies no customer exclusion even though base-customer
  // status is still allowed there).
  it("returns the correct supportsAddedCustomerExclusion per model", () => {
    const byId: Record<string, boolean> = Object.fromEntries(
      listModels().map(m => [m.id, m.capabilities.supportsAddedCustomerExclusion]),
    );
    expect(byId["p-median-us"]).toBe(true);
    expect(byId["two-echelon-gold-au"]).toBe(true);
    expect(byId["p-median-brazil"]).toBe(false);
  });
});

// DoD (G1.2, literal test from the plan): adding a fourth manifest+dataset
// directory with zero code changes makes GET /api/models return it.
describe("adding a fourth model directory (DoD)", () => {
  const fourthDir = path.join(SOLVERS_ROOT, "p-median-us-copy");

  beforeAll(() => {
    fs.mkdirSync(fourthDir, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(SOLVERS_ROOT, "p-median-us", "manifest.json"), "utf8"));
    manifest.id = "p-median-us-copy";
    manifest.name = "Copy for DoD test";
    manifest.datasetDir = "solvers/p-median-us-copy/dataset";
    fs.writeFileSync(path.join(fourthDir, "manifest.json"), JSON.stringify(manifest));
  });

  afterAll(() => {
    fs.rmSync(fourthDir, { recursive: true, force: true });
  });

  it("appears in listModels() after a fresh registry scan, with zero code changes", async () => {
    vi.resetModules();
    const fresh = await import("../registry/modelRegistry.js");
    const ids = fresh.listModels().map(m => m.id);
    expect(ids).toContain("p-median-us-copy");
  });
});
