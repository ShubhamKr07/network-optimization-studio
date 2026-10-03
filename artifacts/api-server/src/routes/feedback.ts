import { Router, type IRouter } from "express";
import { db, feedbackTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
// Generated from openapi.yaml by Orval. The exported Zod schema is
// PascalCase `SubmitFeedbackBody` (the brief predicted a camelCase
// `submitFeedbackBody`, which does not exist) — same convention as
// `RegisterUserBody`/`LoginUserBody` in routes/auth.ts:5-13. The companion
// `submitFeedbackBodyBodyMax` constant IS camelCase and is the generated
// upper bound, imported here so the human-readable message cannot drift from
// the contract — exactly how auth.ts sources registerUserBodyPasswordMax.
import { SubmitFeedbackBody, submitFeedbackBodyBodyMax } from "@workspace/api-zod";

const router: IRouter = Router();

const FEEDBACK_RATE_LIMIT = 5;
const FEEDBACK_RATE_WINDOW_MS = 60 * 1000;

// COSM-4 — keyed by authenticated user id, NOT req.ip. This app sets no
// Express `trust proxy` policy and Render terminates TLS at its load
// balancer, so req.ip is the proxy's address: an IP key would collapse into
// one shared bucket and let a single abuser block every user. The key is
// transient — it lives only in this map, ages out with the window, and is
// never written to the database.
// In-memory and single-instance, so it does not survive a restart and is not
// shared across instances. Acceptable for a feedback box behind auth.
const attempts = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  // Lazy prune: without this, a dormant user id stays in the map until the
  // process restarts, because the branch below only replaces an expired
  // entry when THAT SAME user submits again. The spec says entries age out
  // with the window; this is what makes that literally true.
  for (const [key, e] of attempts) {
    if (now - e.windowStart > FEEDBACK_RATE_WINDOW_MS) attempts.delete(key);
  }
  const entry = attempts.get(userId);
  if (!entry) {
    attempts.set(userId, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > FEEDBACK_RATE_LIMIT;
}

/** Test-only: the map above otherwise persists for the process lifetime. */
export function resetFeedbackRateLimiterForTests(): void {
  attempts.clear();
}

router.use(requireAuth);

// NOTE: never log `body` here, and never log this request alongside user
// context — doing so would reconstruct exactly the attribution the schema
// deliberately omits.
router.post("/feedback", async (req, res) => {
  // Trim FIRST, then validate against the generated contract schema: the
  // OpenAPI minLength/maxLength are defined post-trim, so validating the raw
  // body would accept "   " and reject a 4000-char body with trailing space.
  const raw: unknown = (req.body as { body?: unknown } | undefined)?.body;
  const trimmed = typeof raw === "string" ? raw.trim() : raw;

  // Contract-first: the generated Zod validator is the single source of the
  // length rule, so openapi.yaml and this route cannot drift. Precedent:
  // routes/auth.ts:5-13 imports generated validators and safeParses at :92.
  const parsed = SubmitFeedbackBody.safeParse({ body: trimmed });
  if (!parsed.success) {
    res.status(400).json({ error: `Feedback must be between 1 and ${submitFeedbackBodyBodyMax} characters.` });
    return;
  }
  const body = parsed.data.body;

  // Checked AFTER validation so a malformed request cannot consume quota.
  if (isRateLimited(req.userId!)) {
    res.setHeader("Retry-After", String(Math.ceil(FEEDBACK_RATE_WINDOW_MS / 1000)));
    res.status(429).json({ error: "Too many submissions, try again shortly" });
    return;
  }

  try {
    await db.insert(feedbackTable).values({ body });
  } catch {
    // COSM-4 — swallow the original error deliberately: drizzle's
    // DrizzleQueryError embeds the failed query's params in its own message,
    // so re-throwing or logging it would carry the feedback body into
    // pino, Sentry and PostHog. lib/sentry.ts's scrubber does not touch
    // exception messages, so this catch is the only thing standing between
    // the body and a third-party error tracker.
    res.status(500).json({ error: "Could not store feedback." });
    return;
  }
  res.status(204).end();
});

export default router;
