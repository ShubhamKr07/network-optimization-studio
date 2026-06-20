import { Router } from "express";
import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";

const router = Router();

router.get("/dataset", (_req, res) => {
  res.json({ warehouses: WAREHOUSES, customers: CUSTOMERS });
});

export default router;
