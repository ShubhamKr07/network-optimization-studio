import { Router } from "express";
import { getManifest } from "../registry/modelRegistry.js";
import { getReferenceDistances } from "../data/referenceDistances.js";

// Bundle 2.2 (B2.2-T2, B3 backend) — GET /models/:id/reference-distances.
// Unauthenticated + model-scoped (matches how /dataset and /models are
// mounted, both ownerless — no user_id, no 404-vs-403 anti-enumeration
// concern here at all). Immutable base×base matrix, DD-1: never merged with
// scenario-local overrides.
//
// The app disables Express's automatic weak ETags globally
// (app.set("etag", false) in app.ts) because this is a stateful JSON API,
// not cacheable content in general — this route is the one deliberate
// exception, so it sets its own explicit ETag + revalidation headers rather
// than relying on the framework default.
const router = Router();

router.get("/models/:id/reference-distances", (req, res) => {
  const modelId = req.params.id;
  const manifest = getManifest(modelId);
  if (!manifest || !manifest.capabilities.supportsReferenceDistances) {
    res.status(422).json({ error: `Model ${modelId} does not support reference distances` });
    return;
  }

  const data = getReferenceDistances(modelId);
  if (!data) {
    // Capability says yes but no builder registered — treat the same as
    // unsupported rather than 500ing; this is a registration gap, not a
    // client error, but there's no 5xx in this endpoint's documented
    // contract and this branch should be unreachable once every
    // capability:true model has a builder.
    res.status(422).json({ error: `Model ${modelId} does not support reference distances` });
    return;
  }

  res.set("ETag", data.etag);
  res.set("Cache-Control", "public, max-age=0, must-revalidate");

  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch === data.etag) {
    res.status(304).end();
    return;
  }

  res.json({
    pairs: data.pairs,
    distanceUnit: manifest.distanceUnit ?? "mi",
  });
});

export default router;
