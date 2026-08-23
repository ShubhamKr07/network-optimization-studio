# Spike: Copy Output Map to Clipboard — Library Choice + Fallback Behavior

**Status:** Decision made. Research-only spike per SCN v0.3 Phase C plan Task 5 (source plan's C4.1) — no production code in this change. Implementation is a separate task, C4.2, to be planned once this doc lands.

**Scope:** `OutputMapTab.tsx`'s `react-leaflet` map (tile layer + warehouse/customer markers + polylines) needs a "Copy map to clipboard" action that puts a PNG image on the system clipboard, with a "Download PNG" fallback for any browser/path where the clipboard image write doesn't work.

## Decision

**Use `html-to-image`, pinned `^1.11.13`** (the current `latest` dist-tag as of this spike; `package.json` should record `"html-to-image": "^1.11.13"` to match this repo's existing frontend-dependency pinning convention — see `leaflet`/`react-leaflet` in `artifacts/studio/package.json`, both caret-pinned, not exact-pinned).

Reject `leaflet-image`.

## Investigation: `html-to-image` vs `leaflet-image`

| | `html-to-image` | `leaflet-image` |
|---|---|---|
| Latest version | `1.11.13` | `0.4.0` |
| Last npm publish | 2025-04-19 (~16 months before this spike) | 2016-12-09 (published to npm as `0.4.0` on 2016-12-05 per its own commit log; npm registry metadata says "over a year ago" but the actual commit history, checked directly, is 9+ years stale) |
| Last real GitHub commit | Repo `pushed_at` 2026-05-28 (active) | Last actual commit `2017-01-26` ("Adding bsd-2-clause license") — the repo's `pushed_at` timestamp (2026-04-13) is stale GitHub metadata noise unrelated to any real commit; verified by reading the commit log directly, not just the repo summary field |
| Open issues | 202 (active project, normal for its popularity) | 51, several structurally relevant and unresolved for years — notably **"polylines don't show in image"**, directly on point for this spike (we need to capture polylines/routes, not just tiles+markers) |
| Weekly downloads (npm API, live) | 6,118,749 | 9,833 |
| Dependencies | **0** (confirmed by unpacking the real npm tarball and reading `package.json`) | 1 (`d3-queue`) |
| Bundle size | UMD `dist/html-to-image.js` is 20.5 KB unminified-ish / **~6.7 KB gzipped** (measured directly: `gzip -c dist/html-to-image.js \| wc -c` → 6729 bytes) | Not independently measured — moot given the maintenance/correctness findings below |
| Approach | Clones the target DOM subtree, inlines computed styles, fetches and inlines every external image/background-image as a base64 data URI, serializes to an SVG `<foreignObject>`, draws that onto a `<canvas>`. Because every image is fetched and inlined as a data URI *before* the canvas draw, the resulting canvas is never cross-origin-tainted regardless of the original `<img>` tag's `crossorigin` attribute — the only requirement is that the image server's response allows a CORS `fetch()` (`Access-Control-Allow-Origin`), which is a server-side property, not a Leaflet/react-leaflet configuration concern. | Walks Leaflet's internal `map._layers` and manually replays each layer (tiles via a proxy/canvas trick, markers, vectors) onto a canvas using pre-`react-leaflet`-era direct Leaflet internals access — brittle by construction against any Leaflet/react-leaflet version drift, and exactly the kind of internals-poking that an actively-unmaintained-since-2017 library cannot have kept working against Leaflet 1.9.x (this repo's pinned `leaflet` version) even if it once worked against the Leaflet version current in 2016. |
| Works against `react-leaflet`'s DOM | Yes, by construction — `html-to-image` operates on whatever real DOM node it's given, and react-leaflet renders genuine Leaflet DOM (Leaflet itself, not a React-virtual-DOM reimplementation) into the container `react-leaflet` mounts. No react-leaflet-specific code path is needed; the same capture call works whether the map was built with vanilla Leaflet or react-leaflet. | Unclear/unverified — `leaflet-image` was written before react-leaflet existed and accesses Leaflet's internal layer registry directly; no react-leaflet-specific testing or reports exist in either direction in the (now 9-year-stale) issue tracker. |
| CORS handling for our actual tile provider | **Verified directly**: `OutputMapTab`'s `NetworkMap.tsx` uses CartoDB's tile CDN (`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`, `NetworkMap.tsx:396`). A live `curl -I` against that CDN confirms `access-control-allow-origin: *` on tile responses — `html-to-image`'s internal `fetch()`-based image-embedding step can pull every tile cross-origin with no proxy and no canvas-tainting. This is the specific, concrete fact that de-risks the known upstream GitHub issue (`bubkoo/html-to-image#196`, "Capturing a Leaflet map doesn't show its tiles") for *this* app — that report doesn't state which tile provider was in use, and plenty of tile providers (bare OpenStreetMap's own `tile.openstreetmap.org`, in particular) do **not** send `Access-Control-Allow-Origin`, which would reproduce exactly that failure. Our provider isn't one of them. | Same known-broken polyline-rendering issue noted above; no equivalent CORS story to check since the whole approach is being rejected on maintenance/correctness grounds first. |

**Net:** `leaflet-image` is unmaintained (last real commit 2017), has a directly-relevant unresolved bug (polylines not rendering — the exact "routes" layer this feature needs to capture), and works by poking Leaflet internals in a way nothing has verified against react-leaflet or modern Leaflet at all. `html-to-image` is actively maintained, has zero dependencies, is tiny (~6.7 KB gzipped), is framework-agnostic by construction (so react-leaflet compatibility isn't even a distinct risk), and this app's specific tile provider is independently confirmed CORS-friendly for it.

## Investigation: async Clipboard API `ClipboardItem` support + Safari user-activation timing

**Support matrix** (MDN `browser-compat-data`, `api/ClipboardItem.json` and `api/Clipboard.json`, read directly from the canonical source rather than a summarized table):

- `Clipboard.write()`: Chrome 76+, Edge 79+, Firefox 127+, **Safari 13.1+** (desktop and iOS, mirrored).
- `ClipboardItem` constructor accepting **a `Promise` resolving to a `Blob`** as an item's value (not just a raw `Blob`): Safari 13.1+ (from initial support), Firefox 127+, Chrome 98–132 with a documented partial-implementation caveat, Chrome 133+ unconditionally.

**The real constraint — confirmed from MDN's Clipboard API overview and Google's own `web.dev` async-clipboard guide, which explicitly cites WebKit bug #222262:**

> "Safari (WebKit) treats user activation differently than Chromium (Blink)... For Safari, run all asynchronous operations in a promise whose result you assign to the `ClipboardItem`."

Concretely, per MDN's Clipboard API overview: **Firefox and Safari do not support the Permissions API's `clipboard-write` permission at all** (unlike Chrome/Edge, which can obtain a persistent grant so timing stops mattering after the first grant). For Firefox/Safari, every `write()` call must happen within **transient user activation** — i.e., synchronously enough after the triggering click that the browser still considers the call "caused by" that click. There is no persistent opt-out of this requirement in either browser.

This means the naive implementation —

```js
async function onCopyClick() {
  const blob = await htmlToImage.toBlob(mapNode); // tile fetch + canvas draw: can take 500ms-2s+
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); // FAILS on Safari: activation already expired
}
```

— is exactly the failure mode WebKit bug #222262 describes: by the time `toBlob()` resolves (image capture is not instant — it fetches every tile image, inlines it, then draws to canvas), Safari's transient-activation window has already lapsed, and the subsequent `clipboard.write()` call is rejected (typically a `NotAllowedError`) even though it's a completely normal-looking click handler.

## Determination: eager/synchronous-enough capture is REQUIRED

**Yes** — `C4.2`'s implementation must call `navigator.clipboard.write([...])` **synchronously inside the click handler**, and pass the async capture work as a `Promise<Blob>` *value inside* the `ClipboardItem` constructor, not `await` it beforehand:

```js
function onCopyClick() {
  navigator.clipboard.write([
    new ClipboardItem({
      "image/png": htmlToImage.toBlob(mapNode).then(blob => {
        if (!blob) throw new Error("capture failed");
        return blob;
      }),
    }),
  ]).then(
    () => showToast("Map copied to clipboard"),
    () => downloadPngFallback(mapNode), // covers Safari activation failures, permission denials, and any other write() rejection
  );
}
```

This is a real implementation-shape constraint for `C4.2`, not a nice-to-know: writing it as `await capture(); await clipboard.write(blob)` will work in Chrome/Edge (which can hold a persistent `clipboard-write` grant) but will intermittently or consistently fail in Safari depending on how long the capture takes — and per DD (this repo's cross-browser support expectations for a small pilot deployment), Safari failing silently/intermittently is not acceptable. The `ClipboardItem`-with-a-`Promise`-value form is supported everywhere `ClipboardItem` itself is supported (Safari 13.1+, Firefox 127+, Chrome 98+ partial / 133+ full), so it has no downside versus the naive form on the browsers where the naive form does work — there's no reason for `C4.2` to implement both code paths.

## Fallback behavior (for browsers/paths where clipboard image-write isn't usable)

Per the source plan's C4.1 ("PNG-download fallback where clipboard write is unsupported"), the exact fallback is:

1. **Feature-detect first, don't try-and-catch as the primary gate for UI affordance**: if `navigator.clipboard?.write` or `window.ClipboardItem` is `undefined` (e.g., Firefox < 127, any non-secure-context page — `http://`, or a browser with the API entirely absent), the "Copy to clipboard" button is not offered at all; only "Download PNG" is shown. This is a static capability check done once at render time, not per-click.
2. **Runtime failure fallback**: if `navigator.clipboard.write(...)` rejects for any reason (Safari transient-activation expiry despite the eager-call pattern above, a user permission denial, an `htmlToImage.toBlob()` failure/`null` result, any other `NotAllowedError`/`SecurityError`), the click handler catches the rejection and automatically falls through to the same PNG-download code path used by the explicit "Download PNG" button — i.e., **on failure, the click doesn't just show an error, it does the one useful fallback action for the user** (triggers a `<a download>` blob-URL download of the same captured PNG, reusing the same `htmlToImage.toBlob()` result rather than re-capturing).
3. **Both paths share one capture call.** "Copy to clipboard" and "Download PNG" are not two independent capture implementations — `htmlToImage.toBlob(mapNode, options)` is the single source of the PNG `Blob` for both; "Download" wraps it in `URL.createObjectURL` + a synthetic anchor click, "Copy" wraps it in the `ClipboardItem`-with-Promise pattern above. This also means the download fallback path is exercised by both the explicit button and the copy-failure fallback, so it only needs one test, not two.

## Not chosen / explicitly out of scope for this spike

- Safari's older `document.execCommand("copy")` text-only fallback is not applicable — this is an image, not text, and that API is deprecated in favor of the async Clipboard API this doc already covers.
- No investigation was done into copying an SVG/vector representation instead of a raster PNG — the source plan's C4.1 explicitly asks for a raster image capture, not a vector export.
- `html-to-image`'s exact `Options` (pixel ratio, `filter` for excluding UI chrome like the layer-toggle checkboxes from the capture, `backgroundColor`) are an implementation detail for `C4.2`, not decided here — this spike's scope is library choice + the clipboard-timing shape, per the plan's Step 3 instruction.
