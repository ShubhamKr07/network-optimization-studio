import { type Check, timed } from "./types.js";

/** Extract the first `/assets/*.js` (or module script) src from an index.html string. */
export function findBundleSrc(html: string): string | null {
  const m = html.match(/<script[^>]+src="([^"]+\.js)"/i);
  return m ? m[1] : null;
}

/**
 * The studio bundle must contain the real API host baked at build time (VITE_API_BASE_URL), not the
 * literal placeholder — the R0.6 build-time-vs-runtime split. Guards "frontend points at the wrong /
 * unset API host" after a static rebuild.
 */
export const viteEnvBaked: Check = async (env, ctx) => {
  const name = "vite_env_baked";
  const { value: html, ms: htmlMs } = await timed(async () => {
    const r = await ctx.fetch(`${env.studioBase}/`);
    return r.text();
  });
  const src = findBundleSrc(html);
  if (!src) {
    return { name, pass: false, ms: htmlMs, detail: "no <script src=*.js> found in index.html" };
  }
  const bundleUrl = src.startsWith("http") ? src : `${env.studioBase}${src.startsWith("/") ? "" : "/"}${src}`;
  const { value: js, ms } = await timed(async () => {
    const r = await ctx.fetch(bundleUrl);
    return r.text();
  });
  // Derive the expected API host from the configured apiBase (host only, no scheme noise).
  const apiHost = env.apiBase.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const hasHost = js.includes(apiHost);
  const hasPlaceholder = js.includes("VITE_API_BASE_URL");
  const pass = hasHost && !hasPlaceholder;
  return {
    name,
    pass,
    ms: htmlMs + ms,
    detail: pass
      ? `bundle references ${apiHost}, no placeholder`
      : `bundle host=${hasHost ? "present" : "MISSING"}, placeholder=${hasPlaceholder ? "PRESENT" : "absent"} (${bundleUrl})`,
  };
};
