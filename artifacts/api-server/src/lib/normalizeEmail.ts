/**
 * Email is a case-insensitive identity in this app, so exactly one spelling of
 * an address may ever reach the database or a WHERE clause.
 *
 * Why this exists at all: `users.email` carries a plain `unique()` constraint,
 * which Postgres evaluates byte-wise. Without normalization `Foo@x.com` and
 * `foo@x.com` are two different accounts that can both register, and the
 * student who signs up with one casing and logs in with another is simply
 * locked out — the lookup finds nothing and returns the same generic 401 as a
 * wrong password, so the failure is invisible from the outside.
 *
 * `toLowerCase()` rather than `toLocaleLowerCase()` is deliberate: the latter
 * is locale-sensitive (Turkish dotless ı being the classic trap), which would
 * make an account's canonical form depend on the server's locale.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Applies {@link normalizeEmail} to a request body's `email` before it reaches
 * the Zod validator.
 *
 * Order matters: the generated schemas validate `email` with `.email()`, which
 * REJECTS a leading or trailing space outright. Normalizing after validation
 * would therefore never see the whitespace case at all — a pasted
 * " student@example.com " would 400 (register) or 401 (login) before any
 * trimming happened. Hence: normalize the raw body, then parse.
 *
 * Returns the body untouched when it isn't an object or carries no string
 * `email`, leaving the "missing/!malformed field" verdict to the validator
 * where it belongs.
 */
export function withNormalizedEmail(body: unknown): unknown {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (typeof record.email !== "string") return body;
  return { ...record, email: normalizeEmail(record.email) };
}
