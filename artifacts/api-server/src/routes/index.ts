import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import datasetRouter from "./dataset.js";
import modelsRouter from "./models.js";
import referenceDistancesRouter from "./referenceDistances.js";
import referenceCostsRouter from "./referenceCosts.js";
import scenariosRouter from "./scenarios.js";
import solveHistoryRouter from "./solveHistory.js";
import landingSummaryRouter from "./landingSummary.js";
import authRouter from "./auth.js";
// TEMPORARY (PWR-FU5a) -- remove with routes/diag.ts once the proxy hop count is known.
import diagRouter from "./diag.js";
// Chen-bands-units bundle, Part G / T9 — field-scoped distance-bands PATCH.
// This repo's actual mounting convention is "every router registers here",
// not directly in app.ts (app.ts mounts ONE combined router at /api) — the
// task brief said "mount it in app.ts"; the smallest correct fix per hard
// rule #8 is to follow the established pattern instead.
import distanceBandsRouter from "./distanceBands.js";
// COSM-4 — POST /api/feedback. Registered here, not in app.ts, for the same
// reason as above. It belongs in the auth-required group (after
// landingSummary, before scenarios) because it calls `router.use(requireAuth)`
// exactly like its neighbours, so any router placed after it must already
// require auth — which, from solveHistory onward, they all do.
import feedbackRouter from "./feedback.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(diagRouter);
router.use(authRouter);
router.use(datasetRouter);
router.use(modelsRouter);
router.use(referenceDistancesRouter);
router.use(referenceCostsRouter);
router.use(solveHistoryRouter);
router.use(landingSummaryRouter);
router.use(feedbackRouter);
router.use(distanceBandsRouter);
router.use(scenariosRouter);

export default router;
