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

export async function downloadMapAsPng(node: HTMLElement): Promise<void> {
  const blob = await captureMapAsBlob(node);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "output-map.png";
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyMapToClipboard(node: HTMLElement): Promise<"copied" | "downloaded"> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": captureMapAsBlob(node),
      }),
    ]);
    return "copied";
  } catch {
    await downloadMapAsPng(node);
    return "downloaded";
  }
}
