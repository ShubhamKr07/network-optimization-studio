import { logger } from "./logger.js";

// Resend's REST API, called with native fetch (Node 26). No SDK: this is one
// POST, and the SDK's retries/idempotency/templates buy nothing for a single
// transactional send. If email needs grow, the SDK drops in behind this exact
// signature.
const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "noreply@app.networkdesignbook.com";

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? DEFAULT_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

/**
 * Boot-time visibility for password-reset config. Never throws or exits: reset
 * is not core, and an API that refuses to boot over a missing email key would
 * turn a degraded feature into an outage. /auth/forgot-password answers 200
 * regardless (anti-enumeration), so without this the gap is invisible until a
 * student needs a reset.
 */
export function warnOnMissingEmailConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.RESEND_API_KEY) {
    logger.error(
      { variable: "RESEND_API_KEY" },
      "RESEND_API_KEY is not set: password-reset emails will fail silently (students are told a link is on its way) until it is set",
    );
  }
  for (const [variable, fallback] of [["EMAIL_FROM", DEFAULT_FROM], ["APP_BASE_URL", "https://app.networkdesignbook.com"]]) {
    if (!env[variable]) logger.warn({ variable }, `${variable} is not set: using built-in default ${fallback}`);
  }
}
