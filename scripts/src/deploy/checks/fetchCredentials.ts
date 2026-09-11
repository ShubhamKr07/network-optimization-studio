import { type Check, timed } from "./types.js";

/**
 * The cookie captured at register must authenticate a follow-up request (GET /api/auth/user → 200).
 * Proves the credentialed round-trip works end-to-end (R0.4 customFetch credentials:"include").
 */
export const fetchCredentials: Check = async (env, ctx) => {
  const name = "fetch_credentials";
  if (!ctx.cookieJar.value) {
    return { name, pass: false, ms: 0, detail: "no session cookie captured (cookie_attributes must run first)" };
  }
  const { value: res, ms } = await timed(() =>
    ctx.fetch(`${env.apiBase}/api/auth/user`, {
      headers: { Cookie: ctx.cookieJar.value as string, Origin: env.studioBase },
    }),
  );
  const pass = res.status === 200;
  return {
    name,
    pass,
    ms,
    detail: pass ? "authenticated GET /api/auth/user returned 200" : `expected 200, got ${res.status}`,
  };
};
