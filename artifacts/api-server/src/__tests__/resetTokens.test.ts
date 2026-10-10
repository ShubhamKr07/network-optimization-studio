import { describe, it, expect, afterEach } from "vitest";
import {
  RESET_TOKEN_TTL_MS,
  generateResetToken,
  hashResetToken,
  resetEmailHtml,
} from "../lib/resetTokens.js";

afterEach(() => {
  delete process.env.APP_BASE_URL;
});

describe("reset tokens", () => {
  it("has a one-hour TTL", () => {
    expect(RESET_TOKEN_TTL_MS).toBe(60 * 60 * 1000);
  });

  it("generates URL-safe tokens with no two alike", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateResetToken()));
    expect(tokens.size).toBe(50);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes to 64 hex chars, stably, and never returns the input", () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetToken(token)).toBe(hashResetToken(token));
    expect(hashResetToken(token)).not.toBe(token);
    expect(hashResetToken(token)).not.toBe(hashResetToken(generateResetToken()));
  });

  it("puts the token in the URL fragment, never the query string", () => {
    const html = resetEmailHtml("TOKEN123");
    expect(html).toContain("https://app.networkdesignbook.com/reset-password#token=TOKEN123");
    expect(html).not.toContain("?token=");
  });

  it("honours APP_BASE_URL", () => {
    process.env.APP_BASE_URL = "http://localhost:5173";
    expect(resetEmailHtml("T")).toContain("http://localhost:5173/reset-password#token=T");
  });

  // Last-token-wins is the defined behaviour, so the copy has to say so —
  // out-of-order delivery is exactly the case this wording exists for.
  it("tells the reader that only the newest link works and that it expires", () => {
    const html = resetEmailHtml("T");
    expect(html).toMatch(/newest link/i);
    expect(html).toMatch(/hour/i);
  });
});
