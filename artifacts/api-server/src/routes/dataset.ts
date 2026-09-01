import { Router } from "express";
import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";
import { TRANSPORT_COAL_WAREHOUSES, TRANSPORT_COAL_CUSTOMERS } from "../data/transportCoalDataset.js";
import { GOLD_WAREHOUSES, GOLD_CUSTOMERS } from "../data/twoEchelonDataset.js";
import { BRAZIL_DATASET_WAREHOUSES, BRAZIL_DATASET_CUSTOMERS } from "../data/brazilDataset.js";

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
  res.status(400).json({ error: `Unknown modelId: ${modelId}` });
});

export default router;
