import { toBlob } from "html-to-image";

// C4.2 — implements the eager-capture pattern the spike (docs/superpowers/
// specs/2026-08-24-copy-map-clipboard-spike.md) found is REQUIRED for
// Safari/Firefox correctness (WebKit bug #222262): navigator.clipboard.write
// must be called synchronously inside the triggering click handler, with the
// async capture passed as an unawaited Promise<Blob> value inside the
// ClipboardItem constructor — not awaited beforehand. Do not "simplify" this
// to `await capture(); await clipboard.write(...)` — that form only fails on
// Safari, so it will look correct in a Chrome-only local check.

export async function captureMapAsBlob(node: HTMLElement): Promise<Blob> {
  const blob = await toBlob(node);
  if (!blob) throw new Error("capture failed");
  return blob;
}

export function isClipboardImageWriteSupported(): boolean {
  return (
    typeof navigator.clipboard?.write === "function" &&
    typeof (globalThis as { ClipboardItem?: unknown }).ClipboardItem === "function"
  );
}

function downloadBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "output-map.png";
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadMapAsPng(node: HTMLElement): Promise<void> {
  const blob = await captureMapAsBlob(node);
  downloadBlob(blob);
}

// The fallback reuses the SAME capture (blobPromise) the copy attempt already
// started, rather than re-running toBlob() a second time — a Safari
// transient-activation failure (the exact case this function's eager-write
// shape exists for) would otherwise make the user wait through a second full
// capture before the download even starts.
export async function copyMapToClipboard(node: HTMLElement): Promise<"copied" | "downloaded"> {
  const blobPromise = captureMapAsBlob(node);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": blobPromise,
      }),
    ]);
    return "copied";
  } catch {
    downloadBlob(await blobPromise);
    return "downloaded";
  }
}
