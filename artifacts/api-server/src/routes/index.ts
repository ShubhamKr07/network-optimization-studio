import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import datasetRouter from "./dataset.js";
import scenariosRouter from "./scenarios.js";
import progressRouter from "./progress.js";
import authRouter from "./auth.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(datasetRouter);
router.use(scenariosRouter);
router.use(progressRouter);

export default router;
