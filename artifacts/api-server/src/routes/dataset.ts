import { Router } from "express";
import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";
import { TRANSPORT_COAL_WAREHOUSES, TRANSPORT_COAL_CUSTOMERS } from "../data/transportCoalDataset.js";
import { GOLD_WAREHOUSES, GOLD_CUSTOMERS } from "../data/twoEchelonDataset.js";
import { BRAZIL_DATASET_WAREHOUSES, BRAZIL_DATASET_CUSTOMERS } from "../data/brazilDataset.js";
import { JADE_WAREHOUSES, JADE_CUSTOMERS, JADE_PLANTS, JADE_PRODUCTS, JADE_PLANT_PRODUCT_CAPABILITIES } from "../data/jadeDataset.js";
import { getManifest } from "../registry/modelRegistry.js";

const router = Router();

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
    res.json({ warehouses: GOLD_WAREHOUSES, customers: GOLD_CUSTOMERS });
    return;
  }
  if (modelId === "p-median-brazil") {
    res.json({ warehouses: BRAZIL_DATASET_WAREHOUSES, customers: BRAZIL_DATASET_CUSTOMERS });
    return;
  }
  if (modelId === "two-echelon-jade-us") {
    // Chapter 9 (jade-T10) — the extra plant echelon/product axis/capability
    // matrix fields are gated on the manifest capability, never on modelId
    // again inside this branch, so a future plant/product-bearing model
    // gets the same fields for free without another hardcoded check here.
    const manifest = getManifest(modelId);
    const response: {
      warehouses: typeof JADE_WAREHOUSES;
      customers: typeof JADE_CUSTOMERS;
      plants?: typeof JADE_PLANTS;
      products?: typeof JADE_PRODUCTS;
      plantProductCapabilities?: typeof JADE_PLANT_PRODUCT_CAPABILITIES;
    } = { warehouses: JADE_WAREHOUSES, customers: JADE_CUSTOMERS };
    if (manifest?.capabilities.supportsPlantProductCapability) {
      response.plants = JADE_PLANTS;
      response.products = JADE_PRODUCTS;
      response.plantProductCapabilities = JADE_PLANT_PRODUCT_CAPABILITIES;
    }
    res.json(response);
    return;
  }
  res.status(400).json({ error: `Unknown modelId: ${modelId}` });
});

export default router;
