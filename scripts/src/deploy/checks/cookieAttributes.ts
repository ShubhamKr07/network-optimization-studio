import { type Check, timed, firstSetCookie } from "./types.js";

/** A disposable email unique to this run (index varies the local part; no Math.random needed). */
export function disposableEmail(seed: string): string {
  return `smoke+${seed}@example.com`;
}

/**
 * Registering must set a session cookie with `Secure` + `SameSite=None` in production (R0.3) — the
 * exact attributes required for the cookie to be sent on cross-site fetch from nos-studio. Captures
 * the cookie into ctx for the credentialed checks that follow. Guards the "logout/login silently
 * fails cross-site" class.
 */
export const cookieAttributes: Check = async (env, ctx) => {
  const name = "cookie_attributes";
  const email = disposableEmail(`${env.apiBase.replace(/\W+/g, "").slice(-6)}-${process.pid}`);
  const { value: res, ms } = await timed(() =>
    ctx.fetch(`${env.apiBase}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: env.studioBase },
      body: JSON.stringify({ email, password: "smoke-password-123" }),
    }),
  );
  const setCookie = firstSetCookie(res.headers);
  if (setCookie) ctx.cookieJar.value = setCookie.split(";")[0];
  const isProd = env.apiBase.includes("onrender.com");
  const hasSecure = !!setCookie && /;\s*Secure/i.test(setCookie);
  const hasSameSiteNone = !!setCookie && /;\s*SameSite=None/i.test(setCookie);
  // In production both are required; locally (http) Secure+None are correctly absent, so only
  // require that a cookie was set at all.
  const pass = res.ok && !!setCookie && (isProd ? hasSecure && hasSameSiteNone : true);
  return {
    name,
    pass,
    ms,
    detail: pass
      ? isProd
        ? "register set cookie with Secure + SameSite=None"
        : "register set a session cookie (local http: Secure/None not expected)"
      : `register status=${res.status}, cookie=${setCookie ? "present" : "absent"}, Secure=${hasSecure}, SameSite=None=${hasSameSiteNone}`,
  };
};
