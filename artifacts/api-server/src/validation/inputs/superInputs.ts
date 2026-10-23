import { z } from "zod";
import { JADE_RATE_MAX, JADE_MIN_CHARGE_MAX, JADE_TEXTBOOK_TRANSPORT_COSTS } from "./jadeInputs.js";

export const SUPER_CAPS = { products: 10, plants: 20, warehouses: 50, customers: 500, whCustProd: 50_000 } as const;

const id = z.string().trim().min(1);
const num = z.number().finite();   // every numeric field rejects NaN/±Infinity
const loc = { id, name: z.string().trim().min(1), city: z.string().optional(), state: z.string().optional(),
  lat: num.min(-90).max(90), lng: num.min(-180).max(180) };

const transportCosts = z.object({
  icTransCost: num.min(0).max(JADE_RATE_MAX), icMinTrans: num.min(0).max(JADE_MIN_CHARGE_MAX),
  obTransCost: num.min(0).max(JADE_RATE_MAX), obMinTrans: num.min(0).max(JADE_MIN_CHARGE_MAX),
});

/** The one composite-key encoding for (plantId, productId), (customerId, productId), (fromId, toId).
 *  JSON.stringify([a, b]) is injective for any two strings; `${a}|${b}` was not ("a"+"b|c" == "a|b"+"c"). */
export const pairKey = (a: string, b: string): string => JSON.stringify([a, b]);

export const superTableSchemas = {
  products: z.array(z.object({ id, name: z.string().trim().min(1) })).max(SUPER_CAPS.products),
  plants: z.array(z.object(loc)).max(SUPER_CAPS.plants),
  warehouses: z.array(z.object({ ...loc, status: z.enum(["active", "forced_open", "inactive"]).default("active") })).max(SUPER_CAPS.warehouses),
  customers: z.array(z.object({ ...loc, status: z.enum(["active", "excluded"]).default("active") })).max(SUPER_CAPS.customers),
  plantProducts: z.array(z.object({ plantId: id, productId: id, capacity: num.min(0), costPerUnit: num.min(0) })),
  demand: z.array(z.object({ customerId: id, productId: id, demand: num.min(0) })),
  distanceOverrides: z.array(z.object({ fromId: id, toId: id, miles: num.min(0) })),   // num is .finite(): ±Infinity rejected; 0 allowed (co-located pairs, as Ch9)
};

// spec §3.2 / §8 — server-written by POST /network/road-distances only. Never part of the network document.
export const roadDistancesSchema = z.object({
  fetchedAt: z.string().datetime(),
  profile: z.literal("driving-hgv"),
  coords: z.record(z.string(), z.tuple([num, num])),          // [lat, lng] each location had when fetched (D8)
  pairs: z.array(z.object({ fromId: id, toId: id, miles: num.min(0) })),
});
export type RoadDistances = z.infer<typeof roadDistancesSchema>;

export const superParamSchemas = {
  p: z.number().int().min(1),
  gap: num.min(0),
  timeLimitSec: z.number().int().min(1),
  transportCosts,
  distanceMethod: z.enum(["haversine", "circuity", "road"]),
  circuityFactor: num.min(1).max(3),
};

export const superInputsSchema = z.object({
  ...superParamSchemas,
  products: superTableSchemas.products.default([]),
  plants: superTableSchemas.plants.default([]),
  warehouses: superTableSchemas.warehouses.default([]),
  customers: superTableSchemas.customers.default([]),
  plantProducts: superTableSchemas.plantProducts.default([]),
  demand: superTableSchemas.demand.default([]),
  distanceOverrides: superTableSchemas.distanceOverrides.default([]),
  roadDistances: roadDistancesSchema.optional(),
}).superRefine((v, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const dupes = (rows: { key: string; label?: string; path: (string | number)[] }[], what: string) => {
    const seen = new Set<string>();
    for (const r of rows) { if (seen.has(r.key)) issue(r.path, `Duplicate ${what} "${r.label ?? r.key}"`); seen.add(r.key); }
  };
  dupes([...v.plants.map((r, i) => ({ key: r.id, path: ["plants", i, "id"] })),
         ...v.warehouses.map((r, i) => ({ key: r.id, path: ["warehouses", i, "id"] })),
         ...v.customers.map((r, i) => ({ key: r.id, path: ["customers", i, "id"] }))], "location id");
  dupes(v.products.map((r, i) => ({ key: r.id, path: ["products", i, "id"] })), "product id");
  dupes(v.plantProducts.map((r, i) => ({ key: pairKey(r.plantId, r.productId), label: `${r.plantId} / ${r.productId}`, path: ["plantProducts", i] })), "plant-product row");
  dupes(v.demand.map((r, i) => ({ key: pairKey(r.customerId, r.productId), label: `${r.customerId} / ${r.productId}`, path: ["demand", i] })), "demand row");
  dupes(v.distanceOverrides.map((r, i) => ({ key: pairKey(r.fromId, r.toId), label: `${r.fromId} → ${r.toId}`, path: ["distanceOverrides", i] })), "distance override");
  const P = new Set(v.plants.map(r => r.id)), W = new Set(v.warehouses.map(r => r.id)),
        C = new Set(v.customers.map(r => r.id)), K = new Set(v.products.map(r => r.id));
  v.plantProducts.forEach((r, i) => {
    if (!P.has(r.plantId)) issue(["plantProducts", i, "plantId"], `Unknown plant "${r.plantId}"`);
    if (!K.has(r.productId)) issue(["plantProducts", i, "productId"], `Unknown product "${r.productId}"`);
  });
  v.demand.forEach((r, i) => {
    if (!C.has(r.customerId)) issue(["demand", i, "customerId"], `Unknown customer "${r.customerId}"`);
    if (!K.has(r.productId)) issue(["demand", i, "productId"], `Unknown product "${r.productId}"`);
  });
  v.distanceOverrides.forEach((r, i) => {
    const ok = (P.has(r.fromId) && W.has(r.toId)) || (W.has(r.fromId) && C.has(r.toId));
    if (!ok) issue(["distanceOverrides", i], `"${r.fromId}" → "${r.toId}" is not a plant→warehouse or warehouse→customer pair`);
  });
  if (v.warehouses.length * v.customers.length * v.products.length > SUPER_CAPS.whCustProd)
    issue(["warehouses"], `warehouses × customers × products exceeds ${SUPER_CAPS.whCustProd.toLocaleString("en-US")}`);
});

export type SuperInputs = z.infer<typeof superInputsSchema>;

export const SUPER_DEFAULT_INPUTS = {
  p: 1, gap: 0, timeLimitSec: 120, transportCosts: { ...JADE_TEXTBOOK_TRANSPORT_COSTS },
  distanceMethod: "haversine", circuityFactor: 1.17,
  products: [], plants: [], warehouses: [], customers: [], plantProducts: [], demand: [], distanceOverrides: [],
} satisfies z.input<typeof superInputsSchema>;
