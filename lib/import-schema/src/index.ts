/**
 * @workspace/import-schema — SCND upgrades B2.5. The single source of every
 * importable input entity's FILE LAYOUT: CSV header ↔ JSON key, value type,
 * required-ness for add/update rows, enum values, numeric bounds, unit family,
 * an example, and which models the entity (or field) applies to. Shared by the
 * api-server's importer/exporter and the studio's upload/download UI.
 *
 * Validation RULES stay in artifacts/api-server/src/services/import.ts. Every
 * descriptor value that restates a rule (requiredFor*, min, enum, addModels,
 * models) is pinned to the real validator / route guards by api-server's
 * importSchemaParity.test.ts and importSchemaRouteParity.test.ts, so this file
 * cannot drift from what the server actually does without a red test.
 */

import Papa from "papaparse";

/** Input-entity template version (every non-distance entity, and distance v1). */
export const TEMPLATE_VERSION = 1;
/** v2 of the unit-bearing entities (distances, legDistances, laneCosts): adds a `unit` column. */
export const DISTANCE_TEMPLATE_VERSION = 2;
/** Max data rows per import (CSV data lines or JSON document.rows). */
export const MAX_IMPORT_ROWS = 20_000;
/** 2 MB — the server's express.json limit AND the client's file-size guard. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export const MODEL_IDS = [
  "p-median-us",
  "p-median-brazil",
  "transport-coal",
  "two-echelon-gold-au",
  "two-echelon-jade-us",
  "max-coverage-us",
  "delivery-teaching-us",
] as const;
export type ModelId = (typeof MODEL_IDS)[number];

/** Same order as the OpenAPI ImportEntity enum (importSchemaContract.test.ts pins the two). */
export const IMPORT_ENTITIES = [
  "warehouses",
  "customers",
  "mines",
  "stations",
  "refineries",
  "distances",
  "laneCosts",
  "legDistances",
  "plants",
  "plantCapabilities",
  "deliveryCosts",
] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export type ImportFieldType = "string" | "number" | "boolean" | "enum";

export interface ImportFieldDescriptor {
  readonly csvHeader: string;
  readonly jsonKey: string;
  readonly type: ImportFieldType;
  /** A blank CSV cell / JSON null is legal in at least one mode. Always !(requiredForAdd && requiredForUpdate). */
  readonly nullable: boolean;
  /** Must be non-blank on an ADD row (blank `id`). */
  readonly requiredForAdd: boolean;
  /** Must be non-blank on an UPDATE row (non-blank `id`), and on every row of a pair entity. */
  readonly requiredForUpdate: boolean;
  readonly enum?: readonly string[];
  readonly min?: number;
  /** true → the value must be strictly greater than `min`. */
  readonly exclusiveMin?: true;
  readonly unitFamily?: "distance";
  /** JSON only: when the row omits this key, the envelope's key supplies it. */
  readonly envelopeKey?: "templateVersion" | "unit";
  /** CSV cell text; "" means blank. */
  readonly example: string;
  /** Models whose importer persists this field; omitted = every model of the entity. */
  readonly models?: readonly ModelId[];
}

export interface ImportTemplateVersion {
  readonly templateVersion: number;
  readonly fields: readonly ImportFieldDescriptor[];
}

export interface ImportEntitySchema {
  readonly models: readonly ModelId[];
  /** Models where a blank `id` adds a new entity (the blank-id = add-mode rule). [] for pair entities. */
  readonly addModels: readonly ModelId[];
  /** Oldest first; the last one is what export emits. CSV header matching is exact. */
  readonly versions: readonly ImportTemplateVersion[];
  /** Keys a JSON export row carries that import accepts and ignores. */
  readonly exportOnlyJsonKeys: readonly string[];
}

/** The JSON export envelope, accepted back unchanged by POST /import with format "json". */
export interface ImportJsonDocument {
  templateVersion: number;
  entity: ImportEntity;
  unit?: "km" | "mi";
  rows: Record<string, unknown>[];
}

type FieldSpec = Omit<ImportFieldDescriptor, "jsonKey" | "nullable">;

function field(spec: FieldSpec): ImportFieldDescriptor {
  return {
    ...spec,
    jsonKey: spec.csvHeader.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()),
    nullable: !(spec.requiredForAdd && spec.requiredForUpdate),
  };
}

const ALWAYS = { requiredForAdd: true, requiredForUpdate: true } as const;
const ADD_ONLY = { requiredForAdd: true, requiredForUpdate: false } as const;
const OPTIONAL = { requiredForAdd: false, requiredForUpdate: false } as const;

const FACILITY_STATUSES = ["active", "forced_open", "inactive"] as const;
const CUSTOMER_STATUSES = ["active", "excluded"] as const;

const templateVersionField = (templateVersion: number) =>
  field({ csvHeader: "template_version", type: "number", ...ALWAYS, envelopeKey: "templateVersion", example: String(templateVersion) });

const UNIT_FIELD = field({ csvHeader: "unit", type: "enum", ...ALWAYS, enum: ["km", "mi"], envelopeKey: "unit", example: "mi" });

/** template_version, id, display_code, city, state, lat, lng, then the entity's own tail columns. */
function singleIdFields(example: { id: string; city: string; state: string; lat: string; lng: string }, tail: ImportFieldDescriptor[]): ImportFieldDescriptor[] {
  return [
    templateVersionField(TEMPLATE_VERSION),
    // Blank id = ADD (the server mints the uid); non-blank = UPDATE of a base or added entity.
    field({ csvHeader: "id", type: "string", requiredForAdd: false, requiredForUpdate: true, example: example.id }),
    field({ csvHeader: "display_code", type: "string", ...OPTIONAL, example: "" }),
    field({ csvHeader: "city", type: "string", ...ADD_ONLY, example: example.city }),
    field({ csvHeader: "state", type: "string", ...ADD_ONLY, example: example.state }),
    field({ csvHeader: "lat", type: "number", ...ADD_ONLY, example: example.lat }),
    field({ csvHeader: "lng", type: "number", ...ADD_ONLY, example: example.lng }),
    ...tail,
  ];
}

/** v1 (template_version, from_id, to_id, value) and, when unit-bearing, v2 (… unit …). */
function pairVersions(fromId: string, toId: string, value: ImportFieldDescriptor, unitBearing: boolean): ImportTemplateVersion[] {
  const pair = [
    field({ csvHeader: "from_id", type: "string", ...ALWAYS, example: fromId }),
    field({ csvHeader: "to_id", type: "string", ...ALWAYS, example: toId }),
  ];
  const v1: ImportTemplateVersion = { templateVersion: TEMPLATE_VERSION, fields: [templateVersionField(TEMPLATE_VERSION), ...pair, value] };
  if (!unitBearing) return [v1];
  return [v1, { templateVersion: DISTANCE_TEMPLATE_VERSION, fields: [templateVersionField(DISTANCE_TEMPLATE_VERSION), UNIT_FIELD, ...pair, value] }];
}

const distanceValue = (example: string) =>
  field({ csvHeader: "distance", type: "number", ...ALWAYS, min: 0, exclusiveMin: true, unitFamily: "distance", example });

export const IMPORT_SCHEMAS: Readonly<Record<ImportEntity, ImportEntitySchema>> = {
  warehouses: {
    models: ["p-median-us", "p-median-brazil", "two-echelon-jade-us", "max-coverage-us", "delivery-teaching-us"],
    addModels: ["p-median-us", "p-median-brazil", "two-echelon-jade-us", "max-coverage-us"],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: singleIdFields({ id: "ALN", city: "Allentown", state: "PA", lat: "40.602812", lng: "-75.470433" }, [
        field({ csvHeader: "capacity", type: "number", ...OPTIONAL, min: 0, example: "", models: ["p-median-us", "p-median-brazil"] }),
        field({ csvHeader: "status", type: "enum", ...ALWAYS, enum: FACILITY_STATUSES, example: "forced_open" }),
      ]),
    }],
    exportOnlyJsonKeys: ["overridden"],
  },
  customers: {
    models: ["p-median-us", "p-median-brazil", "two-echelon-gold-au", "two-echelon-jade-us", "max-coverage-us", "delivery-teaching-us"],
    addModels: ["p-median-us", "p-median-brazil", "two-echelon-gold-au", "max-coverage-us"],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: singleIdFields({ id: "C1", city: "Akron", state: "OH", lat: "41.08", lng: "-81.52" }, [
        // JADE's per-product demand is not a CSV/JSON concern: its scalar demand is read-only (routes drop it).
        field({ csvHeader: "demand", type: "number", ...ADD_ONLY, min: 0, example: "205375", models: ["p-median-us", "p-median-brazil", "two-echelon-gold-au", "max-coverage-us", "delivery-teaching-us"] }),
        field({ csvHeader: "status", type: "enum", ...ALWAYS, enum: CUSTOMER_STATUSES, example: "active" }),
      ]),
    }],
    exportOnlyJsonKeys: ["overridden"],
  },
  mines: {
    models: ["transport-coal"],
    addModels: ["transport-coal"],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: singleIdFields({ id: "KY", city: "Pikeville", state: "KY", lat: "37.54", lng: "-82.75" }, [
        field({ csvHeader: "capacity", type: "number", ...OPTIONAL, min: 0, example: "25000000" }),
      ]),
    }],
    exportOnlyJsonKeys: ["overridden"],
  },
  stations: {
    models: ["transport-coal"],
    addModels: ["transport-coal"],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: singleIdFields({ id: "LAX", city: "Los Angeles", state: "CA", lat: "33.974044", lng: "-118.248849" }, [
        field({ csvHeader: "demand", type: "number", ...ADD_ONLY, min: 0, example: "8000000" }),
      ]),
    }],
    exportOnlyJsonKeys: ["overridden"],
  },
  refineries: {
    models: ["two-echelon-gold-au"],
    addModels: ["two-echelon-gold-au"],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: singleIdFields({ id: "cunnamulla", city: "Cunnamulla", state: "QLD", lat: "-28.0716", lng: "145.6695" }, [
        field({ csvHeader: "status", type: "enum", ...ALWAYS, enum: FACILITY_STATUSES, example: "forced_open" }),
      ]),
    }],
    exportOnlyJsonKeys: [],
  },
  distances: {
    models: ["p-median-us", "p-median-brazil", "max-coverage-us"],
    addModels: [],
    versions: pairVersions("ALN", "C1", distanceValue("123.4"), true),
    exportOnlyJsonKeys: ["overridden"],
  },
  laneCosts: {
    models: ["transport-coal"],
    addModels: [],
    // transport-coal's lane "cost" IS a geographic distance, so it converts under unit= (templates.ts:1171-1191).
    versions: pairVersions("KY", "LAX", field({ csvHeader: "cost", type: "number", ...ALWAYS, min: 0, exclusiveMin: true, unitFamily: "distance", example: "2100" }), true),
    exportOnlyJsonKeys: ["overridden"],
  },
  legDistances: {
    models: ["two-echelon-gold-au", "two-echelon-jade-us"],
    addModels: [],
    versions: pairVersions("kalgoorlie", "cunnamulla", distanceValue("1500"), true),
    exportOnlyJsonKeys: ["overridden"],
  },
  deliveryCosts: {
    models: ["delivery-teaching-us"],
    addModels: [],
    // D1: sparse overrides of inputs.laneCostOverrides. cost = BILLABLE MILES, never
    // unit-converted: v1 only and no unitFamily (unlike laneCosts).
    versions: pairVersions("W8", "C269", field({ csvHeader: "cost", type: "number", ...ALWAYS, min: 0, example: "1047.7157" }), false),
    exportOnlyJsonKeys: [],
  },
  plants: {
    models: ["two-echelon-jade-us"],
    addModels: ["two-echelon-jade-us"],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: singleIdFields({ id: "plant-1", city: "Ashland", state: "KY", lat: "38.448338", lng: "-82.66621175" }, []),
    }],
    exportOnlyJsonKeys: [],
  },
  plantCapabilities: {
    models: ["two-echelon-jade-us"],
    addModels: [],
    versions: [{
      templateVersion: TEMPLATE_VERSION,
      fields: [
        templateVersionField(TEMPLATE_VERSION),
        field({ csvHeader: "plant_id", type: "string", ...ALWAYS, example: "plant-1" }),
        field({ csvHeader: "product_id", type: "string", ...ALWAYS, example: "product-2" }),
        field({ csvHeader: "enabled", type: "boolean", ...ALWAYS, example: "true" }),
      ],
    }],
    exportOnlyJsonKeys: ["overridden"],
  },
};

export function isImportEntity(value: unknown): value is ImportEntity {
  return typeof value === "string" && (IMPORT_ENTITIES as readonly string[]).includes(value);
}

export function findTemplateVersion(entity: ImportEntity, templateVersion: number): ImportTemplateVersion | undefined {
  return IMPORT_SCHEMAS[entity].versions.find(v => v.templateVersion === templateVersion);
}

export function csvColumns(entity: ImportEntity, templateVersion: number): string[] {
  const version = findTemplateVersion(entity, templateVersion);
  if (!version) throw new Error(`import-schema: ${entity} has no template version ${templateVersion}`);
  return version.fields.map(f => f.csvHeader);
}

function latestVersion(entity: ImportEntity): ImportTemplateVersion {
  const versions = IMPORT_SCHEMAS[entity].versions;
  return versions[versions.length - 1]!;
}

/** Papa.unparse, so an example containing a comma/quote/newline is still valid CSV. */
export function exampleCsv(entity: ImportEntity): string {
  const { fields } = latestVersion(entity);
  return Papa.unparse([fields.map(f => f.csvHeader), fields.map(f => f.example)], { newline: "\n" }) + "\n";
}

export function exampleJsonDocument(entity: ImportEntity): ImportJsonDocument {
  const { templateVersion, fields } = latestVersion(entity);
  const row: Record<string, unknown> = {};
  let unit: "km" | "mi" | undefined;
  for (const f of fields) {
    if (f.envelopeKey === "unit") { unit = f.example as "km" | "mi"; continue; }
    if (f.envelopeKey === "templateVersion") continue; // the envelope carries it
    row[f.jsonKey] = f.example === "" ? null
      : f.type === "number" ? Number(f.example)
      : f.type === "boolean" ? f.example === "true"
      : f.example;
  }
  return { templateVersion, entity, ...(unit ? { unit } : {}), rows: [row] };
}
