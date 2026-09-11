import { type Check, timed } from "./types.js";

/**
 * A CORS preflight (OPTIONS) from the studio origin must echo that exact origin back and allow
 * credentials — the R0.2 allowlist + credentialed-fetch contract. Guards the "open CORS" and
 * "cookie never sent cross-site" silent-failure classes.
 */
export const corsPreflight: Check = async (env, ctx) => {
  const name = "cors_preflight";
  const { value: res, ms } = await timed(() =>
    ctx.fetch(`${env.apiBase}/api/healthz`, {
      method: "OPTIONS",
      headers: {
        Origin: env.studioBase,
        "Access-Control-Request-Method": "GET",
      },
    }),
  );
  const allowOrigin = res.headers.get("access-control-allow-origin");
  const allowCreds = res.headers.get("access-control-allow-credentials");
  const pass = allowOrigin === env.studioBase && allowCreds === "true";
  return {
    name,
    pass,
    ms,
    detail: pass
      ? `allow-origin echoes ${env.studioBase}, allow-credentials=true`
      : `expected allow-origin=${env.studioBase} + allow-credentials=true; got origin=${allowOrigin}, creds=${allowCreds}`,
  };
};
