import { createHash, randomBytes } from "node:crypto";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const DEFAULT_BASE_URL = "https://app.networkdesignbook.com";

export const resetEmailSubject = "Reset your Network Design Labs password";

/** 32 bytes of CSPRNG output, base64url so it is safe in a URL fragment. */
export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256, not argon2. A slow KDF defends low-entropy secrets against
 * offline guessing; this secret is 32 random bytes, so there is nothing to
 * guess and the cost would land on every confirm request.
 */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function resetEmailHtml(token: string): string {
  const base = process.env.APP_BASE_URL ?? DEFAULT_BASE_URL;
  // Fragment, not query string: a fragment is never sent to the server, so
  // the token stays out of Render and Cloudflare access logs.
  const link = `${base}/reset-password#token=${token}`;
  return [
    "<p>Someone asked to reset the password for this Network Design Labs account.</p>",
    `<p><a href="${link}">Set a new password</a></p>`,
    "<p>The link works for one hour and can be used once. If you asked more than once, only the newest link works.</p>",
    "<p>If this wasn't you, ignore this email — nothing has changed.</p>",
  ].join("\n");
}
