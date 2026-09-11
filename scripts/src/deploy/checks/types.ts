/** Target environment for a smoke run. */
export interface SmokeEnv {
  apiBase: string;
  studioBase: string;
}

/** Shared mutable state across checks (an auth cookie captured by register). */
export interface SmokeCtx {
  fetch: typeof fetch;
  cookieJar: { value: string | null };
}

/** Outcome of one named check. `warn` = soft failure (does not fail the run). */
export interface CheckResult {
  name: string;
  pass: boolean;
  warn?: boolean;
  detail: string;
  ms: number;
}

export type Check = (env: SmokeEnv, ctx: SmokeCtx) => Promise<CheckResult>;

/** Time an async fn, returning its result and elapsed ms. */
export async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

/** Extract the first Set-Cookie header value (Node fetch merges them with ", "). */
export function firstSetCookie(headers: Headers): string | null {
  // Node's undici exposes getSetCookie(); fall back to the merged header.
  const anyH = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyH.getSetCookie === "function") {
    const arr = anyH.getSetCookie();
    return arr.length ? arr[0] : null;
  }
  return headers.get("set-cookie");
}

/** The session cookie name/value pair (for a Cookie request header) from a Set-Cookie string. */
export function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0];
}
