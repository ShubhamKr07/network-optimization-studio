// SCU-2.P2.1 (B2.5) — pins every descriptor value that RESTATES a validator
// rule to the real validator (services/import.ts's parseAndValidateImport)
// and the input schemas (validateInputsForModel). Fast and pure: this is the
// full entity × model coverage; the real-DB route file covers only the guards.
import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import { IMPORT_ENTITIES, IMPORT_SCHEMAS } from "@workspace/import-schema";
import type { ImportEntity, ImportFieldDescriptor, ModelId } from "@workspace/import-schema";
import { parseAndValidateImport } from "../services/import.js";
import { validateInputsForModel } from "../validation/inputs/index.js";
import { MODEL_INPUTS, exampleCellsFor, latestFields } from "./fixtures/importFixtures.js";

const P = 3;

function errorsFor(entity: ImportEntity, fields: readonly ImportFieldDescriptor[], cells: string[], modelId: ModelId) {
  const csv = Papa.unparse([fields.map(f => f.csvHeader), cells], { newline: "\n" });
  return parseAndValidateImport(entity, csv, {}, P, modelId).errors;
}

const exampleCells = (fields: readonly ImportFieldDescriptor[]) => fields.map(f => f.example);
const isSingleId = (entity: ImportEntity) => latestFields(entity).some(f => f.csvHeader === "id");

// An ADD row: blank id, a fresh display code, status "active" (the only status
// an added customer may have; legal for every facility enum too).
const addRowCells = (fields: readonly ImportFieldDescriptor[]) =>
  fields.map(f => (f.csvHeader === "id" ? "" : f.csvHeader === "display_code" ? "PARITY-1" : f.csvHeader === "status" ? "active" : f.example));

const withCell = (fields: readonly ImportFieldDescriptor[], cells: string[], target: ImportFieldDescriptor, value: string) =>
  cells.map((c, i) => (fields[i] === target ? value : c));

describe("every supported (entity, model) pair: a populated, model-specific example row validates with errors === []", () => {
  let pairs = 0;
  for (const entity of IMPORT_ENTITIES) {
    const schema = IMPORT_SCHEMAS[entity];
    for (const model of schema.models) {
      pairs++;
      for (const version of schema.versions) {
        it(`${entity} v${version.templateVersion} on ${model}`, () => {
          expect(errorsFor(entity, version.fields, exampleCellsFor(entity, version.fields, model), model)).toEqual([]);
        });
      }
    }
  }
  it("covers every supported pair (22 here; 23 once deliveryCosts lands in SCU-2.P2.3)", () => {
    expect(pairs).toBe(IMPORT_ENTITIES.reduce((n, e) => n + IMPORT_SCHEMAS[e].models.length, 0));
    expect(pairs).toBeGreaterThanOrEqual(22);
  });
});

describe("field `models` = the models whose input schema keeps the value (not manifest demandEditable)", () => {
  const cases = [
    { entity: "customers" as const, csvHeader: "demand", key: "customerOverrides", make: (id: string) => ({ id, status: "active", demand: 5 }) },
    { entity: "warehouses" as const, csvHeader: "capacity", key: "warehouseOverrides", make: (id: string) => ({ id, status: "active", capacity: 5 }) },
  ];
  for (const c of cases) {
    const fields = latestFields(c.entity);
    const field = fields.find(f => f.csvHeader === c.csvHeader)!;
    for (const model of IMPORT_SCHEMAS[c.entity].models) {
      const expected = (field.models ?? IMPORT_SCHEMAS[c.entity].models).includes(model);
      it(`${c.entity}.${c.csvHeader} on ${model}: ${expected ? "kept" : "dropped"}`, () => {
        const id = exampleCellsFor(c.entity, fields, model)[1]!; // the id column
        const result = validateInputsForModel(model, { ...MODEL_INPUTS[model], [c.key]: [c.make(id)] });
        expect(result.success).toBe(true);
        const row = (result as unknown as { data: Record<string, Array<Record<string, unknown>>> }).data[c.key]![0]!;
        expect(row[c.csvHeader] === 5).toBe(expected);
      });
    }
  }
});

describe("addModels matches the validator's add mode (blank id)", () => {
  for (const entity of IMPORT_ENTITIES.filter(isSingleId)) {
    for (const model of IMPORT_SCHEMAS[entity].models) {
      const expected = IMPORT_SCHEMAS[entity].addModels.includes(model);
      it(`${entity} on ${model}: add ${expected ? "accepted" : "rejected"}`, () => {
        const fields = latestFields(entity);
        expect(errorsFor(entity, fields, addRowCells(fields), model).length === 0).toBe(expected);
      });
    }
  }
});

describe("requiredForAdd matches the validator", () => {
  for (const entity of IMPORT_ENTITIES.filter(isSingleId)) {
    const fields = latestFields(entity);
    const model = IMPORT_SCHEMAS[entity].addModels[0]!;
    for (const f of fields.filter(f => f.csvHeader !== "id")) {
      it(`${entity}.${f.csvHeader} blank on an add row → ${f.requiredForAdd ? "error" : "accepted"}`, () => {
        expect(errorsFor(entity, fields, withCell(fields, addRowCells(fields), f, ""), model).length > 0).toBe(f.requiredForAdd);
      });
    }
  }
});

describe("requiredForUpdate matches the validator", () => {
  for (const entity of IMPORT_ENTITIES) {
    const fields = latestFields(entity);
    const model = IMPORT_SCHEMAS[entity].models[0]!;
    for (const f of fields.filter(f => f.csvHeader !== "id")) {
      it(`${entity}.${f.csvHeader} blank on an update row → ${f.requiredForUpdate ? "error" : "accepted"}`, () => {
        expect(errorsFor(entity, fields, withCell(fields, exampleCells(fields), f, ""), model).length > 0).toBe(f.requiredForUpdate);
      });
    }
  }
});

describe("numeric bounds and enums match the validator", () => {
  for (const entity of IMPORT_ENTITIES) {
    const fields = latestFields(entity);
    const model = IMPORT_SCHEMAS[entity].models[0]!;
    const at = (f: ImportFieldDescriptor, v: string) => errorsFor(entity, fields, withCell(fields, exampleCells(fields), f, v), model);
    for (const f of fields.filter(f => f.min !== undefined)) {
      it(`${entity}.${f.csvHeader}: ${f.min! - 1} rejected, ${f.min} ${f.exclusiveMin ? "rejected" : "accepted"}`, () => {
        expect(at(f, String(f.min! - 1)).length).toBeGreaterThan(0);
        expect(at(f, String(f.min!)).length > 0).toBe(f.exclusiveMin === true);
      });
    }
    for (const f of fields.filter(f => f.type === "enum")) {
      it(`${entity}.${f.csvHeader}: a non-member is rejected`, () => {
        expect(at(f, "not-a-member").length).toBeGreaterThan(0);
      });
    }
  }
});
