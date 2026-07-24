import { Router } from "express";
import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";
import { TRANSPORT_COAL_WAREHOUSES, TRANSPORT_COAL_CUSTOMERS } from "../data/transportCoalDataset.js";

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
  res.status(400).json({ error: `Unknown modelId: ${modelId}` });
});

export default router;
