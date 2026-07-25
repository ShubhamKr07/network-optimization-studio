import { PostHog } from "posthog-node";

const apiKey = process.env.POSTHOG_API_KEY;
const host = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

let _posthog: PostHog | null = null;

if (apiKey) {
  _posthog = new PostHog(apiKey, {
    host,
    enableExceptionAutocapture: true,
  });
} else if (process.env.NODE_ENV !== "production") {
  console.warn(
    "POSTHOG_API_KEY variable required by PostHog is missing or un-configured, " +
      "this causes events to be silently missed. This error stops appearing once POSTHOG_API_KEY is configured",
  );
}

export const posthog: PostHog | null = _posthog;
