import { Router } from "express";
import { z } from "zod";
import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";
import { TRANSPORT_COAL_WAREHOUSES, TRANSPORT_COAL_CUSTOMERS } from "../data/transportCoalDataset.js";
import { PACKAGE_SPECS, validatePackage, GoldMineEntry, RefineryEntry, GoldCustomerEntry } from "@workspace/dataset-schema";

const router = Router();

// Two-echelon dataset is loaded once at module init (same pattern as the
// other models' imported datasets). mines + refineries map onto the
// `warehouses` shape the frontend's NetworkMap consumes; customers map
// directly. This keeps the dataset endpoint's contract uniform across
// every model — the frontend never branches on model id to pick a dataset
// shape, only on result.edges.leg to color edges.
let GOLD_WAREHOUSES: { id: string; city: string; state: string; lat: number; lng: number }[] | null = null;
let GOLD_CUSTOMERS: { id: string; city: string; state: string; lat: number; lng: number; demand: number }[] | null = null;
try {
  const spec = PACKAGE_SPECS.find((s) => s.modelId === "two-echelon-gold-au");
  if (spec) {
    const pkg = validatePackage(spec) as {
      "mines.json": Record<string, z.infer<typeof GoldMineEntry>>;
      "refineries.json": Record<string, z.infer<typeof RefineryEntry>>;
      "customers.json": Record<string, z.infer<typeof GoldCustomerEntry>>;
    };
    GOLD_WAREHOUSES = [
      ...Object.values(pkg["mines.json"]),
      ...Object.values(pkg["refineries.json"]),
    ].map((e) => ({ id: e.id, city: e.city, state: e.state, lat: e.lat, lng: e.lng }));
    GOLD_CUSTOMERS = Object.values(pkg["customers.json"]).map((c) => ({
      id: c.id, city: c.city, state: c.state, lat: c.lat, lng: c.lng, demand: c.demand,
    }));
  }
} catch (err) {
  console.error("[dataset] failed to load two-echelon-gold-au package:", err instanceof Error ? err.message : err);
}

router.get("/dataset", (req, res) => {
  const modelId = (req.query.modelId as string | undefined) ?? "p-median-us";
  if (modelId === "p-median-us") {
    res.json({ warehouses: WAREHOUSES, customers: CUSTOMERS });
    return;
  }
  if (modelId === "transport-coal") {
    res.json({ warehouses: TRANSPORT_COAL_WAREHOUSES, customers: TRANSPORT_COAL_CUSTOMERS });
    return;
  }
  if (modelId === "two-echelon-gold-au") {
    if (!GOLD_WAREHOUSES || !GOLD_CUSTOMERS) {
      res.status(500).json({ error: "Two-echelon dataset failed to load at boot" });
      return;
    }
    res.json({ warehouses: GOLD_WAREHOUSES, customers: GOLD_CUSTOMERS });
    return;
  }
  res.status(400).json({ error: `Unknown modelId: ${modelId}` });
});

export default router;
