import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import datasetRouter from "./dataset.js";
import scenariosRouter from "./scenarios.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(datasetRouter);
router.use(scenariosRouter);

export default router;
