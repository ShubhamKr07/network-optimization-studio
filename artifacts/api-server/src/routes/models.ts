import { Router } from "express";
import { listModels } from "../registry/modelRegistry.js";

const router = Router();

router.get("/models", (_req, res) => {
  res.json(listModels());
});

export default router;
