import { validatePackage, PACKAGE_SPECS } from "@workspace/dataset-schema";
import type { WarehouseCandidate, Customer } from "./dataset.js";

// Chapter 9 — JADE multi-product two-echelon (plant -> warehouse -> customer).
// Boot-time loader for the canonical dataset package, mirroring
// twoEchelonDataset.ts's pattern (validate the on-disk package once via
// @workspace/dataset-schema's PACKAGE_SPECS, then reshape into the shared
// WarehouseCandidate/Customer wire shapes GET /dataset already returns for
// every other model). Unlike two-echelon-gold-au, JADE also has a genuinely
// new plant echelon + product axis + a plant×product capability matrix with
// no existing shared shape to reuse — those get their own local interfaces
// here (mirrored, not re-exported, from the generated OpenAPI Plant/Product/
// PlantProductCapability types so this module has no codegen dependency).

interface JadePlantEntry {
  id: string;
  sourceId: number;
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

interface JadeProductEntry {
  id: string;
  sourceId: number;
  name: string;
}

interface JadeWarehouseEntry {
  id: string;
  sourceId: number;
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
}

interface JadeCustomerEntry extends JadeWarehouseEntry {
  demand: number;
  demands: Record<string, number>;
}

interface JadeCapabilityEntry {
  plantId: string;
  productId: string;
  capacity: number;
}

const spec = PACKAGE_SPECS.find((s) => s.modelId === "two-echelon-jade-us")!;
const pkg = validatePackage(spec) as {
  "plants.json": Record<string, JadePlantEntry>;
  "products.json": Record<string, JadeProductEntry>;
  "warehouses.json": Record<string, JadeWarehouseEntry>;
  "customers.json": Record<string, JadeCustomerEntry>;
  "plant_product_capability.json": JadeCapabilityEntry[];
};

export interface Plant {
  id: string;
  sourceId?: number;
  name?: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

export interface Product {
  id: string;
  sourceId?: number;
  name: string;
}

export interface PlantProductCapability {
  plantId: string;
  productId: string;
  capacity: number;
}

export const JADE_PLANTS: Plant[] = Object.values(pkg["plants.json"]).map((p) => ({
  id: p.id,
  sourceId: p.sourceId,
  name: p.name,
  city: p.city,
  state: p.state,
  lat: p.lat,
  lng: p.lng,
}));

export const JADE_PRODUCTS: Product[] = Object.values(pkg["products.json"]).map((p) => ({
  id: p.id,
  sourceId: p.sourceId,
  name: p.name,
}));

export const JADE_WAREHOUSES: WarehouseCandidate[] = Object.values(pkg["warehouses.json"]).map((w) => ({
  id: w.id,
  sourceId: w.sourceId,
  name: w.name,
  city: w.city,
  state: w.state,
  lat: w.lat,
  lng: w.lng,
  zip: w.zip,
}));

export const JADE_CUSTOMERS: Customer[] = Object.values(pkg["customers.json"]).map((c) => ({
  id: c.id,
  sourceId: c.sourceId,
  name: c.name,
  city: c.city,
  state: c.state,
  lat: c.lat,
  lng: c.lng,
  demand: c.demand,
  demands: c.demands,
  zip: c.zip,
}));

export const JADE_PLANT_PRODUCT_CAPABILITIES: PlantProductCapability[] = pkg["plant_product_capability.json"];
