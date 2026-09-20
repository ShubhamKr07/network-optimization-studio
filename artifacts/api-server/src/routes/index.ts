import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import datasetRouter from "./dataset.js";
import modelsRouter from "./models.js";
import referenceDistancesRouter from "./referenceDistances.js";
import scenariosRouter from "./scenarios.js";
import solveHistoryRouter from "./solveHistory.js";
import landingSummaryRouter from "./landingSummary.js";
import authRouter from "./auth.js";
// Chen-bands-units bundle, Part G / T9 — field-scoped distance-bands PATCH.
// This repo's actual mounting convention is "every router registers here",
// not directly in app.ts (app.ts mounts ONE combined router at /api) — the
// task brief said "mount it in app.ts"; the smallest correct fix per hard
// rule #8 is to follow the established pattern instead.
import distanceBandsRouter from "./distanceBands.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(datasetRouter);
router.use(modelsRouter);
router.use(referenceDistancesRouter);
router.use(solveHistoryRouter);
router.use(landingSummaryRouter);
router.use(distanceBandsRouter);
router.use(scenariosRouter);

export default router;
