import { Router } from "express";
import { getManifest } from "../registry/modelRegistry.js";
import { getReferenceCosts } from "../data/referenceCosts.js";

// Chapter 5 (modified) - GET /models/:id/reference-costs, the cost-side mirror
// of reference-distances. Unauthenticated + model-scoped, like /dataset and
// /models, so there is no owner and no 404-vs-403 concern here. Immutable base
// matrix: never merged with a scenario's own laneCostOverrides.
const router = Router();

router.get("/models/:id/reference-costs", (req, res) => {
  const modelId = req.params.id;
  const manifest = getManifest(modelId);
  if (!manifest || !manifest.capabilities.supportsReferenceCosts) {
    res.status(422).json({ error: `Model ${modelId} does not support reference costs` });
    return;
  }

  const data = getReferenceCosts(modelId);
  if (!data) {
    res.status(422).json({ error: `Model ${modelId} does not support reference costs` });
    return;
  }

  res.set("ETag", data.etag);
  res.set("Cache-Control", "public, max-age=0, must-revalidate");

  if (req.headers["if-none-match"] === data.etag) {
    res.status(304).end();
    return;
  }

  res.json({ pairs: data.pairs, distanceUnit: manifest.distanceUnit ?? "mi" });
});

export default router;
