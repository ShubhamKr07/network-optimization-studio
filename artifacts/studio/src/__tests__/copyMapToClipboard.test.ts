import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as htmlToImage from "html-to-image";
import {
  captureMapAsBlob,
  copyMapToClipboard,
  downloadMapAsPng,
  isClipboardImageWriteSupported,
} from "@/lib/copyMapToClipboard";

vi.mock("html-to-image", () => ({ toBlob: vi.fn() }));

// jsdom does not implement URL.createObjectURL/revokeObjectURL at all, so
// vi.spyOn (which requires the property to already exist as a function)
// throws "does not exist" without this. Stub them once at module load so the
// per-test vi.spyOn(URL, ...) calls below have something to wrap.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = vi.fn();
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = vi.fn();
}

function makeBlob(): Blob {
  return new Blob(["fake-png-bytes"], { type: "image/png" });
}

describe("captureMapAsBlob", () => {
  it("resolves with the blob html-to-image produces", async () => {
    const blob = makeBlob();
    vi.mocked(htmlToImage.toBlob).mockResolvedValue(blob);
    const node = document.createElement("div");
    await expect(captureMapAsBlob(node)).resolves.toBe(blob);
  });

  it("throws when html-to-image resolves null", async () => {
    vi.mocked(htmlToImage.toBlob).mockResolvedValue(null);
    const node = document.createElement("div");
    await expect(captureMapAsBlob(node)).rejects.toThrow("capture failed");
  });
});

describe("copyMapToClipboard", () => {
  let writeSpy: ReturnType<typeof vi.fn>;
  let clipboardItemCtorCalls: unknown[];

  beforeEach(() => {
    writeSpy = vi.fn().mockResolvedValue(undefined);
    clipboardItemCtorCalls = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { write: writeSpy },
      configurable: true,
    });
    (globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem = class {
      constructor(items: unknown) {
        clipboardItemCtorCalls.push(items);
      }
    };
    vi.mocked(htmlToImage.toBlob).mockResolvedValue(makeBlob());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;
  });

  it("calls navigator.clipboard.write synchronously — before the capture promise resolves, not after an await", async () => {
    const node = document.createElement("div");
    const promise = copyMapToClipboard(node);
    // If the implementation awaited the capture before calling write(), this
    // assertion would fail here — write() must already have been called by
    // this point, in the same microtask as the copyMapToClipboard() call.
    expect(writeSpy).toHaveBeenCalledTimes(1);
    await promise;
  });

  it("resolves 'copied' when clipboard.write succeeds", async () => {
    const node = document.createElement("div");
    await expect(copyMapToClipboard(node)).resolves.toBe("copied");
  });

  it("falls through to a download (resolves 'downloaded') when clipboard.write rejects", async () => {
    writeSpy.mockRejectedValue(new Error("NotAllowedError"));
    const node = document.createElement("div");
    document.body.appendChild(node);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await expect(copyMapToClipboard(node)).resolves.toBe("downloaded");
    expect(clickSpy).toHaveBeenCalled();
    document.body.removeChild(node);
  });
});

describe("downloadMapAsPng", () => {
  it("creates an object URL and clicks a synthetic download anchor", async () => {
    vi.mocked(htmlToImage.toBlob).mockResolvedValue(makeBlob());
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const node = document.createElement("div");

    await downloadMapAsPng(node);

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:fake-url");
  });
});

describe("isClipboardImageWriteSupported", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;
  });

  it("returns true when both navigator.clipboard.write and window.ClipboardItem exist", () => {
    Object.defineProperty(navigator, "clipboard", { value: { write: vi.fn() }, configurable: true });
    (globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem = class {};
    expect(isClipboardImageWriteSupported()).toBe(true);
  });

  it("returns false when ClipboardItem is missing", () => {
    Object.defineProperty(navigator, "clipboard", { value: { write: vi.fn() }, configurable: true });
    delete (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;
    expect(isClipboardImageWriteSupported()).toBe(false);
  });
});
