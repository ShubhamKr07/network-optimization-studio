import { PostHog } from "posthog-node";

const apiKey = process.env.POSTHOG_API_KEY;
const host = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

const DEV_MISSING_MSG =
  "POSTHOG_API_KEY variable required by PostHog is missing or un-configured, " +
  "this causes events to be silently missed. This error stops appearing once POSTHOG_API_KEY is configured";

if (!apiKey) {
  if (process.env.NODE_ENV !== "production") {
    console.error(DEV_MISSING_MSG);
  }
}

// Singleton shared across all requests. Batches events and flushes
// asynchronously so captures never block request handlers.
export const posthog: PostHog | null = apiKey
  ? new PostHog(apiKey, {
      host,
      enableExceptionAutocapture: true,
    })
  : null;
