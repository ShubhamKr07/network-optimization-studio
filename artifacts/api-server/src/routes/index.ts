import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import datasetRouter from "./dataset.js";
import modelsRouter from "./models.js";
import referenceDistancesRouter from "./referenceDistances.js";
import scenariosRouter from "./scenarios.js";
import solveHistoryRouter from "./solveHistory.js";
import landingSummaryRouter from "./landingSummary.js";
import authRouter from "./auth.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(datasetRouter);
router.use(modelsRouter);
router.use(referenceDistancesRouter);
router.use(solveHistoryRouter);
router.use(landingSummaryRouter);
router.use(scenariosRouter);

export default router;
